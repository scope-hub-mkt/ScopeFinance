import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * O contrato de entrada do CRM Scope System — §3 do plano de implementação.
 *
 * ⚖️ **Uma origem, uma rota, um formato.** Este módulo não reaproveita o
 * envelope da Dashboard (`lib/integracao/contrato.ts`) de propósito: dois
 * formatos no mesmo handler significam que a falha de um derruba o outro, e o
 * dado de negócio morre junto com o de monitoramento. É a mesma lição do §0.1,
 * que custou a este projeto uma integração inteira apontada para o domínio
 * errado.
 *
 * Puro: nada aqui toca banco, rede ou `process.env`. As decisões que dependem
 * do que já existe no cadastro — vincular, criar ou recusar — são de quem
 * chama, porque só quem tem banco pode tomá-las.
 */

// ════════════════════════════════════════════════════════════════════
//  Autenticação — §3.2
// ════════════════════════════════════════════════════════════════════

/** Janela de tolerância do timestamp, contra replay. */
export const JANELA_CRM_S = 300;

export type VereditoCrm = { ok: true } | { ok: false; motivo: string; status: 401 | 503 };

function comparaConstante(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** `X-Scope-Signature-256` = HMAC_SHA256(segredo, "{timestamp}.{corpo}"). */
export function assinarCrm(segredo: string, timestamp: number, corpoBruto: string): string {
  return `sha256=${createHmac("sha256", segredo).update(`${timestamp}.${corpoBruto}`).digest("hex")}`;
}

/**
 * Confere uma entrega do CRM.
 *
 * ⚖️ **Duas credenciais aceitas, e a ordem é a preferência do §3.2.**
 *
 *   1. **HMAC** (`X-Scope-Signature-256`) — é o padrão da casa, o mesmo
 *      envelope que os outros sistemas da Scope já usam, e prova que o corpo
 *      não foi alterado no caminho.
 *   2. **Token em header** (`x-scope-crm-token`) — aceitável **se e somente
 *      se** o emissor não souber assinar.
 *
 * ⚠️ **Por que os dois, e não só o HMAC.** Medido em 28/08/2026: o painel do
 * CRM Scope System **não expõe configuração de saída nenhuma** — `/api/webhook*`
 * e `/api/integration` respondem 404. Hoje quem chama esta rota é um vigia
 * nosso, que assina HMAC sem esforço. Amanhã, se o CRM ganhar saída, é bem
 * provável que ela saiba mandar um header e não saiba assinar. Aceitar o token
 * agora é o que faz esse dia ser **cadastro**, não deploy (`ESTADO §8.9`).
 *
 * ⛔ O token só vale se `CRM_WEBHOOK_TOKEN` estiver definido. Ausente, a única
 * porta é o HMAC — nenhum caminho fica aberto por omissão.
 */
export function autenticarCrm(
  segredos: { hmac: string | null; token: string | null },
  headers: Headers,
  corpoBruto: string,
  agoraS: number = Math.floor(Date.now() / 1000)
): VereditoCrm {
  if (!segredos.hmac && !segredos.token) {
    return {
      ok: false,
      status: 503,
      motivo:
        "Entrada do CRM não provisionada: defina CRM_WEBHOOK_SECRET (HMAC) ou " +
        "CRM_WEBHOOK_TOKEN (header) no ambiente do ScopeFinance.",
    };
  }

  const token = headers.get("x-scope-crm-token");
  if (token && segredos.token) {
    if (comparaConstante(segredos.token, token.trim())) return { ok: true };
    return { ok: false, status: 401, motivo: "x-scope-crm-token não confere" };
  }

  const assinatura = headers.get("x-scope-signature-256");
  if (!assinatura) {
    return {
      ok: false,
      status: 401,
      motivo: "sem X-Scope-Signature-256 nem x-scope-crm-token válido",
    };
  }
  if (!segredos.hmac) {
    return { ok: false, status: 503, motivo: "CRM_WEBHOOK_SECRET não definido neste ambiente" };
  }

  const ts = Number(headers.get("x-scope-timestamp"));
  if (!Number.isFinite(ts)) {
    return { ok: false, status: 401, motivo: "header X-Scope-Timestamp ausente ou inválido" };
  }
  // O timestamp entra no material assinado, não só num header próprio: é o que
  // faz reenviar um corpo antigo com timestamp novo invalidar a assinatura.
  if (Math.abs(agoraS - ts) > JANELA_CRM_S) {
    return {
      ok: false,
      status: 401,
      motivo: `timestamp fora da janela de ${JANELA_CRM_S}s (proteção contra replay)`,
    };
  }
  if (!comparaConstante(assinarCrm(segredos.hmac, ts, corpoBruto), assinatura)) {
    return { ok: false, status: 401, motivo: "assinatura não confere com o segredo cadastrado" };
  }
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════
//  O payload — §3.3
// ════════════════════════════════════════════════════════════════════

export interface PayloadCrm {
  evento: string;
  id_externo_crm: string;
  ocorrido_em: string | null;
  funil: { nome: string | null; coluna: string | null };
  contato: { nome: string; telefone: string; email: string | null };
  empresa: { razao_social: string | null; cnpj: string | null };
  documento: string | null;
  negocio: {
    braco: string | null;
    servico_id: string | null;
    servico_nome: string | null;
    valor: number | null;
    vendedor_id: string | null;
  };
}

export type LeituraPayload =
  | { ok: true; payload: PayloadCrm }
  | { ok: false; campos: string[]; motivo: string };

const txt = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s === "" ? null : s;
};

/** Só dígitos — a mesma normalização dos quatro sistemas (§2.2). */
export function normalizarDocumento(v: unknown): string | null {
  const s = typeof v === "string" ? v.replace(/\D/g, "") : "";
  return s || null;
}

/**
 * Lê e valida o corpo vindo do CRM.
 *
 * **Três campos são obrigatórios, e só três** (§3.3):
 *
 *   `id_externo_crm` → sem ele não há anti-reprocessamento, e o mesmo card
 *      entregue duas vezes viraria dois clientes.
 *   `contato.nome`     → um cliente sem nome não é cadastro, é linha.
 *   `contato.telefone` → é o único canal que o CRM garante ter.
 *
 * ⛔ **`documento` NÃO é obrigatório**, e essa é a decisão do §2.3: sem ele o
 * cliente nasce **provisório** em vez de ser recusado. Recusar faria o
 * comercial perder o cadastro; aceitar sem marcar faria o financeiro emitir
 * nota contra uma identidade que ninguém conferiu. O estado provisório é o que
 * resolve os dois.
 */
export function lerPayloadCrm(bruto: unknown): LeituraPayload {
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) {
    return { ok: false, campos: [], motivo: "corpo não é um objeto JSON" };
  }
  const c = bruto as Record<string, unknown>;
  const contato = (c.contato ?? {}) as Record<string, unknown>;
  const empresa = (c.empresa ?? {}) as Record<string, unknown>;
  const negocio = (c.negocio ?? {}) as Record<string, unknown>;
  const funil = (c.funil ?? {}) as Record<string, unknown>;

  const faltando: string[] = [];
  const idExterno = txt(c.id_externo_crm);
  const nome = txt(contato.nome);
  const telefone = txt(contato.telefone);
  if (!idExterno) faltando.push("id_externo_crm");
  if (!nome) faltando.push("contato.nome");
  if (!telefone) faltando.push("contato.telefone");

  if (faltando.length) {
    return {
      ok: false,
      campos: faltando,
      motivo: `campo obrigatório ausente: ${faltando.join(", ")}`,
    };
  }

  // O documento pode vir no campo raiz ou dentro de `empresa.cnpj`. Aceitar os
  // dois é o que permite ao emissor mudar de ideia sem quebrar o contrato —
  // e `documento_principal` prefere CNPJ de qualquer forma (§2.2).
  const documento = normalizarDocumento(c.documento) ?? normalizarDocumento(empresa.cnpj);

  const valorBruto = negocio.valor;
  const valor =
    typeof valorBruto === "number" && Number.isFinite(valorBruto)
      ? valorBruto
      : typeof valorBruto === "string" && valorBruto.trim() !== "" && Number.isFinite(Number(valorBruto))
        ? Number(valorBruto)
        : null;

  return {
    ok: true,
    payload: {
      evento: txt(c.evento) ?? "lead.convertido",
      id_externo_crm: idExterno as string,
      ocorrido_em: txt(c.ocorrido_em),
      funil: { nome: txt(funil.nome), coluna: txt(funil.coluna) },
      contato: { nome: nome as string, telefone: telefone as string, email: txt(contato.email) },
      empresa: { razao_social: txt(empresa.razao_social), cnpj: normalizarDocumento(empresa.cnpj) },
      documento,
      negocio: {
        braco: txt(negocio.braco)?.toLowerCase() ?? null,
        servico_id: txt(negocio.servico_id),
        servico_nome: txt(negocio.servico_nome),
        valor,
        vendedor_id: txt(negocio.vendedor_id),
      },
    },
  };
}

// ════════════════════════════════════════════════════════════════════
//  O gatilho — §RN-02
// ════════════════════════════════════════════════════════════════════

/**
 * A coluna que dispara a integração, normalizada.
 *
 * ⚖️ `RN-02` do board: o lead entra no funil de pré-venda, mas é **apenas no
 * pós-venda, na coluna `Validação Contratual`**, que o dado vai para o
 * financeiro. Card em qualquer outra coluna é recebido e **ignorado de
 * propósito** — a resposta é `200`, porque recusar faria o emissor tratar
 * como falha algo que é o comportamento correto.
 *
 * ⛔ Ligar qualquer coluna criaria cliente a partir de prospect, que é o
 * defeito que o gatilho existe para evitar (`ESTADO §5.1`: das 38 negociações
 * do CRM, só 12 estão `WON`).
 */
export const COLUNA_GATILHO = "validacao-contratual";

/** `"Validação Contratual"` e `"validacao-contratual"` são a mesma coluna. */
export function normalizarColuna(v: string | null): string {
  if (!v) return "";
  return (
    v
      .normalize("NFD")
      // `\p{Diacritic}` e nao uma classe de intervalo literal, de proposito: a
      // classe literal contem caracteres combinantes INVISIVEIS no arquivo, e
      // qualquer editor que renormalize o texto os apaga sem que o diff mostre
      // nada. A coluna deixaria de casar e nenhuma linha teria "mudado".
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
  );
}

export function ehGatilho(coluna: string | null): boolean {
  return normalizarColuna(coluna) === COLUNA_GATILHO;
}

// ════════════════════════════════════════════════════════════════════
//  O cliente que o payload descreve
// ════════════════════════════════════════════════════════════════════

/**
 * Traduz o payload em linha de `clientes`.
 *
 * 📐 **`status_cadastro` sai daqui** porque é função só do documento (§2.3):
 * com documento válido, `efetivo`; sem, `provisorio`. O terceiro estado —
 * `em_conflito` — **não** pode ser decidido aqui: ele depende do que já existe
 * no banco, e essa consulta é de quem chama.
 */
export function clienteDoCrm(p: PayloadCrm): Record<string, unknown> {
  const ehPj = p.documento?.length === 14;
  return {
    nome: p.contato.nome,
    ...(ehPj ? { cnpj: p.documento } : p.documento ? { cpf: p.documento } : {}),
    ...(p.empresa.razao_social ? { razao_social: p.empresa.razao_social } : {}),
    email: p.contato.email,
    tel: p.contato.telefone,
    crm_id: p.id_externo_crm,
    origem: "crm",
    status_cadastro: p.documento ? "efetivo" : "provisorio",
    sincronizado_em: new Date().toISOString(),
  };
}
