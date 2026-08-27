/**
 * O contrato entre o ScopeFinance (CFO) e a Scope Dashboard (CEO).
 *
 * ⚖️ **A relação foi definida pelo dono em 25/08/2026:** os dois sistemas têm
 * poder equivalente e papéis distintos — compartilham o núcleo de dados, não
 * uma hierarquia. O cadastro de cliente nasce em qualquer um dos dois e
 * replica para o outro **com o mesmo `id`**.
 *
 * A fonte de verdade do formato é `docs/03-CONTRATO-DE-INTEGRACAO ✅.md` da
 * Dashboard, e o consumidor real é o `lib/scopefinance.ts` de lá. Este arquivo
 * é deliberadamente **puro**: nenhuma linha toca banco, rede ou `process.env`.
 * É o que torna o contrato testável sem infraestrutura — e o Gate G0 apontou a
 * ausência de testes aqui como risco aceito (`D-18`), não como coisa boa.
 */

// ─── Formatos que a Dashboard consome ───────────────────────────────

/** `ClienteFinance` em `lib/scopefinance.ts` da Dashboard. */
export interface ClienteContrato {
  cliente_id: string;
  nome: string;
  doc: string | null;
  email: string | null;
  tel: string | null;
  status: string | null;
}

/**
 * Um pagamento efetivamente **recebido** — o fato gerador da comissão
 * (`RN-06` da Dashboard). Parcela vincenda, apenas faturada ou inadimplida
 * **não** aparece aqui: é o que impede a Dashboard de antecipar comissão
 * sobre dinheiro que não entrou.
 */
export interface PagamentoContrato {
  referencia: string;
  cliente_id: string;
  contrato_id: string | null;
  valor_bruto: number;
  deducoes: number;
  recebido_em: string;
  fonte: string;
}

export interface ResumoContrato {
  faturamento_mes: number;
  recebido_mes: number;
  inadimplencia: number;
  mrr: number;
  clientes_ativos: number;
  fonte: string;
}

export interface PontoMensalContrato {
  periodo: string; // 'YYYY-MM'
  faturamento: number;
  recebido: number;
}

export const FONTE = "scopefinance";

// ─── Linhas cruas do banco, no mínimo que os cálculos precisam ──────

export interface LinhaReceber {
  id: string;
  cliente_id: string | null;
  contrato_id: string | null;
  valor: number | string | null;
  valor_pago: number | string | null;
  deducoes: number | string | null;
  vencimento: string | null;
  status: string;
  pago_em: string | null;
}

export interface LinhaAssinatura {
  valor: number | string | null;
  ciclo: string;
  status: string;
}

export interface LinhaCliente {
  id: string;
  nome: string;
  doc: string | null;
  email: string | null;
  tel: string | null;
  status: string | null;
}

const num = (v: number | string | null | undefined): number => Number(v ?? 0) || 0;

/**
 * O que a Scope realmente recebeu numa conta baixada.
 *
 * `valor_pago` só existe quando alguém informou na baixa; sem ele, o valor
 * cobrado é a melhor aproximação disponível — declarada, não inventada.
 */
export function valorRecebido(linha: Pick<LinhaReceber, "valor" | "valor_pago">): number {
  return linha.valor_pago == null ? num(linha.valor) : num(linha.valor_pago);
}

/** `RN-04`: a base da comissão é líquida — bruto recebido menos deduções. */
export function baseLiquida(
  linha: Pick<LinhaReceber, "valor" | "valor_pago" | "deducoes">
): number {
  return valorRecebido(linha) - num(linha.deducoes);
}

export function clienteParaContrato(c: LinhaCliente): ClienteContrato {
  return {
    cliente_id: c.id,
    nome: c.nome,
    doc: c.doc,
    email: c.email,
    tel: c.tel,
    status: c.status,
  };
}

/**
 * Converte contas baixadas em pagamentos recebidos.
 *
 * Descarta linha sem `cliente_id` ou sem `pago_em`: a comissão precisa saber
 * de quem e quando, e um pagamento órfão viraria comissão sem dono na tela do
 * colaborador da Dashboard.
 */
export function pagamentosDeReceber(linhas: LinhaReceber[]): PagamentoContrato[] {
  return linhas
    .filter((l) => l.status === "Pago" && l.pago_em && l.cliente_id)
    .map((l) => ({
      referencia: l.id,
      cliente_id: l.cliente_id as string,
      contrato_id: l.contrato_id,
      valor_bruto: valorRecebido(l),
      deducoes: num(l.deducoes),
      recebido_em: l.pago_em as string,
      fonte: FONTE,
    }));
}

/**
 * Quantos meses cada ciclo cobre — o divisor que normaliza tudo para o mês.
 *
 * ⚖️ **Por que a tabela cresceu em 28/08/2026.** Até então o cálculo conhecia
 * três ciclos (`anual`, `trimestral`, e tudo o mais como mensal). Isso bastava
 * enquanto as assinaturas nasciam só pela tela daqui — medido, as 6 existentes
 * são todas mensais. A entrada do Asaas muda a premissa: ele emite
 * `WEEKLY`, `BIWEEKLY`, `BIMONTHLY` e `SEMIANNUALLY` também, e uma assinatura
 * semestral tratada como mensal **multiplica o MRR por seis**.
 *
 * ⛔ O erro não levantaria exceção nenhuma: sairia um número maior, com cara
 * de certa, num painel que a Dashboard exibe sem recalcular (`RN-01`). É
 * exatamente a armadilha que o §4.10 do plano descreve.
 *
 * Ciclos mais curtos que o mês têm fator menor que 1 de propósito: uma
 * cobrança semanal de R$ 100 vale ~R$ 433 por mês, não R$ 100.
 */
export const MESES_POR_CICLO: Record<string, number> = {
  semanal: 12 / 52,
  quinzenal: 12 / 26,
  mensal: 1,
  bimestral: 2,
  trimestral: 3,
  semestral: 6,
  anual: 12,
};

/** Receita recorrente mensal — todo ciclo normalizado para o mês. */
export function calcularMrr(assinaturas: LinhaAssinatura[]): number {
  return assinaturas
    .filter((a) => a.status === "Ativa")
    .reduce((soma, a) => {
      // Ciclo que ninguém cadastrou cai em mensal, que é o comportamento
      // desde sempre. Não é palpite melhor — é o palpite ANTIGO, mantido para
      // que esta mudança não mexa em nenhum número que já estava certo. O
      // caminho que evita o palpite é `cicloDoAsaas`, que recusa gravar ciclo
      // que não reconhece.
      const meses = MESES_POR_CICLO[a.ciclo] ?? 1;
      return soma + num(a.valor) / meses;
    }, 0);
}

/** Último dia do mês de uma data ISO — usado como teto da janela do mês. */
export function fimDoMes(iso: string): string {
  const [ano, mes] = iso.slice(0, 7).split("-").map(Number);
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${iso.slice(0, 7)}-${String(ultimo).padStart(2, "0")}`;
}

/**
 * O resumo do painel da Dashboard (`RF-01`), calculado **aqui** — `RN-01` diz
 * que o ScopeFinance é dono do número financeiro e a Dashboard nunca
 * recalcula. Se este cálculo mudar, ele muda num lugar só.
 *
 * `hoje` entra por parâmetro para o teste não depender do relógio da máquina.
 */
export function calcularResumo(
  receber: LinhaReceber[],
  assinaturas: LinhaAssinatura[],
  clientesAtivos: number,
  hoje: string
): ResumoContrato {
  const inicioMes = hoje.slice(0, 7) + "-01";
  const fimMes = fimDoMes(hoje);
  let faturamento_mes = 0;
  let recebido_mes = 0;
  let inadimplencia = 0;

  for (const c of receber) {
    if (c.vencimento && c.vencimento >= inicioMes && c.vencimento <= fimMes) {
      faturamento_mes += num(c.valor);
    }
    if (c.status === "Pago" && c.pago_em && c.pago_em >= inicioMes) {
      recebido_mes += valorRecebido(c);
    }
    // Vencida e não baixada. Cancelada NÃO é inadimplência — é conta que
    // deixou de existir, e somá-la inflaria o vermelho do painel de lá.
    if (c.status !== "Pago" && c.status !== "Cancelado" && c.vencimento && c.vencimento < hoje) {
      inadimplencia += num(c.valor);
    }
  }

  return {
    faturamento_mes,
    recebido_mes,
    inadimplencia,
    mrr: calcularMrr(assinaturas),
    clientes_ativos: clientesAtivos,
    fonte: FONTE,
  };
}

/** Os N períodos 'YYYY-MM' terminando no mês de `hoje`, do mais antigo ao atual. */
export function periodosAte(hoje: string, meses: number): string[] {
  const [ano, mes] = hoje.slice(0, 7).split("-").map(Number);
  const out: string[] = [];
  for (let i = meses - 1; i >= 0; i--) {
    out.push(new Date(Date.UTC(ano, mes - 1 - i, 1)).toISOString().slice(0, 7));
  }
  return out;
}

/**
 * Série mensal dos mini-gráficos (`RF-01`/`RF-02` da Dashboard).
 *
 * Devolve **todos** os períodos da janela, inclusive os zerados — a Dashboard
 * distingue "mês sem faturamento" (ponto em zero) de "sem dado" (série
 * vazia), e omitir o mês vazio aqui apagaria essa diferença lá.
 */
export function calcularSerie(
  receber: LinhaReceber[],
  hoje: string,
  meses: number
): PontoMensalContrato[] {
  const mapa = new Map<string, PontoMensalContrato>(
    periodosAte(hoje, meses).map((p) => [p, { periodo: p, faturamento: 0, recebido: 0 }])
  );

  for (const c of receber) {
    if (c.vencimento) {
      const alvo = mapa.get(c.vencimento.slice(0, 7));
      if (alvo) alvo.faturamento += num(c.valor);
    }
    if (c.status === "Pago" && c.pago_em) {
      const alvo = mapa.get(c.pago_em.slice(0, 7));
      if (alvo) alvo.recebido += valorRecebido(c);
    }
  }

  return [...mapa.values()];
}

// ─── Eventos ────────────────────────────────────────────────────────

/** Envelope de evento — idêntico nos dois sentidos (`03` §4.2/§4.3). */
export interface Envelope {
  evento: string;
  id: string;
  criado_em: string;
  dados: Record<string, unknown>;
}

export type ResultadoEvento =
  | { acao: "criar" | "atualizar"; cliente: Record<string, unknown> }
  | { acao: "ignorar"; motivo: string };

/** Só dígitos — a mesma normalização dos dois lados. */
export function normalizarDoc(doc: string | null | undefined): string | null {
  if (!doc) return null;
  const so = doc.replace(/[^0-9]/g, "");
  return so || null;
}

/**
 * Traduz um evento da Dashboard para a escrita que ele significa aqui.
 *
 * ⚠️ **A Dashboard emite `cliente.criado` com DOIS formatos diferentes** —
 * medido em 25/08/2026 em `lib/dominio/clientes.ts` de lá: o CRUD e a
 * importação mandam `{cliente_id, nome, doc, fonte}`, e a criação de perfil
 * comercial manda `{cliente_id, setor, porte, status}`, sem nome. O segundo
 * não é cadastro de cliente — é extensão comercial, que não existe aqui.
 * Ignorar com motivo declarado é a leitura correta; criar um cliente chamado
 * "undefined" seria a errada.
 */
export function interpretarEvento(env: Envelope): ResultadoEvento {
  const d = env.dados ?? {};
  const clienteId = typeof d.cliente_id === "string" ? d.cliente_id : null;

  if (env.evento !== "cliente.criado" && env.evento !== "cliente.atualizado") {
    return { acao: "ignorar", motivo: `evento "${env.evento}" não tem efeito no financeiro` };
  }
  if (!clienteId) {
    return { acao: "ignorar", motivo: "evento sem cliente_id" };
  }
  const nome = typeof d.nome === "string" ? d.nome.trim() : "";
  if (!nome) {
    return {
      acao: "ignorar",
      motivo: "payload sem nome — é o formato de perfil comercial, que não é cadastro de cliente",
    };
  }

  const doc = typeof d.doc === "string" ? d.doc : null;
  return {
    acao: env.evento === "cliente.criado" ? "criar" : "atualizar",
    cliente: {
      id: clienteId,
      nome,
      doc,
      email: typeof d.email === "string" ? d.email : null,
      tel: typeof d.tel === "string" ? d.tel : null,
      tipo: normalizarDoc(doc)?.length === 14 ? "Pessoa Jurídica" : "Pessoa Física",
      // ⚠️ **`status` só entra se o payload trouxer.** Ele é campo NOSSO: a
      // Dashboard não tem coluna de status em `clientes` e nunca o envia. Fixar
      // "Ativo" aqui fazia toda `cliente.atualizado` RESSUSCITAR um cliente
      // inativado daqui — bastava corrigir o nome lá para ele voltar a contar
      // no `/resumo`, sem ninguém pedir e sem nada registrar. Omitido, o
      // upsert não toca a coluna; na criação, quem responde é o
      // `default 'Ativo'` do schema, que é o lugar certo desse padrão.
      ...(typeof d.status === "string" ? { status: d.status } : {}),
      origem: "dashboard",
    },
  };
}
