import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  assinarCrm,
  autenticarCrm,
  clienteDoCrm,
  ehGatilho,
  lerPayloadCrm,
  normalizarColuna,
  normalizarDocumento,
} from "@/lib/crm/contrato";
import { novoBanco, fakeAtual } from "./fakes/supabase-fake";

vi.mock("@/lib/supabase/admin", async () => {
  const { fakeAtual: f } = await import("./fakes/supabase-fake");
  return { createSupabaseAdmin: () => f() };
});

const { aplicarEventoCrm, clientesEmRevisao } = await import("@/lib/crm/aplicar");

/**
 * Os cenários do §10.1 do `03-PLANO-DE-IMPLEMENTACAO.md`, literais.
 *
 * ⚖️ Esta é a seção que o plano chama de *"a mais importante do documento"*, e
 * a razão é uma frase: **duplicata de cliente com nota fiscal emitida não se
 * desfaz.** Cada teste aqui existe para uma forma diferente de criar essa
 * duplicata sem querer.
 */

const EXISTENTE = "11111111-1111-4111-8111-111111111111";

function banco(seedClientes: Record<string, unknown>[] = []) {
  return novoBanco(
    { clientes: seedClientes, crm_webhook_events: [] },
    {
      clientes: {
        unicos: [
          {
            colunas: ["documento_principal"],
            nome: "ux_clientes_documento_principal",
            onde: (l) => l.documento_principal != null,
          },
          { colunas: ["crm_id"], nome: "ux_clientes_crm_id", onde: (l) => l.crm_id != null },
        ],
        defaults: {
          id: () => crypto.randomUUID(),
          status: "Ativo",
          created_at: () => new Date().toISOString(),
        },
      },
      crm_webhook_events: {
        defaults: { id: () => crypto.randomUUID(), process_status: "pending" },
      },
    }
  );
}

/**
 * O fake não tem a trigger `set_documento_principal` do banco. Semear já
 * normalizado é o que mantém os dois honestos — a trava real é a do Postgres,
 * exercitada em `tests/integracao/**`.
 */
const cliente = (over: Record<string, unknown>) => ({
  id: EXISTENTE,
  nome: "Clínica Vetro LTDA",
  doc: "12345678000190",
  documento_principal: "12345678000190",
  status_cadastro: "efetivo",
  origem: "scopefinance",
  crm_id: null,
  created_at: new Date().toISOString(),
  ...over,
});

const payload = (over: Record<string, unknown> = {}) =>
  lerPayloadCrm({
    evento: "lead.convertido",
    id_externo_crm: "ord_8f3c1a",
    ocorrido_em: "2026-08-27T10:32:00-03:00",
    funil: { nome: "pos-venda", coluna: "Validação Contratual" },
    contato: { nome: "Maria Souza", telefone: "5511999998888", email: "maria@vetro.com.br" },
    empresa: { razao_social: "Clínica Vetro LTDA", cnpj: "12.345.678/0001-90" },
    documento: "12.345.678/0001-90",
    negocio: { braco: "hub", servico_id: "svc_1", valor: 2500, vendedor_id: "usr_1" },
    ...over,
  });

beforeEach(() => banco());

// ════════════════════════════════════════════════════════════════════
describe("§3.2 — autenticação", () => {
  const corpo = '{"a":1}';
  const agora = 1_756_000_000;

  it("aceita HMAC correto dentro da janela", () => {
    const h = new Headers({
      "x-scope-signature-256": assinarCrm("segredo", agora, corpo),
      "x-scope-timestamp": String(agora),
    });
    expect(autenticarCrm({ hmac: "segredo", token: null }, h, corpo, agora).ok).toBe(true);
  });

  it("recusa corpo alterado com a mesma assinatura", () => {
    const h = new Headers({
      "x-scope-signature-256": assinarCrm("segredo", agora, corpo),
      "x-scope-timestamp": String(agora),
    });
    // O corpo entra no material assinado: trocá-lo invalida a assinatura.
    expect(autenticarCrm({ hmac: "segredo", token: null }, h, '{"a":2}', agora).ok).toBe(false);
  });

  it("recusa timestamp fora da janela de 5 min — proteção contra replay", () => {
    const velho = agora - 400;
    const h = new Headers({
      "x-scope-signature-256": assinarCrm("segredo", velho, corpo),
      "x-scope-timestamp": String(velho),
    });
    const v = autenticarCrm({ hmac: "segredo", token: null }, h, corpo, agora);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.motivo).toContain("replay");
  });

  it("aceita o token em header quando ele está provisionado", () => {
    const h = new Headers({ "x-scope-crm-token": "tok" });
    expect(autenticarCrm({ hmac: null, token: "tok" }, h, corpo, agora).ok).toBe(true);
  });

  it("token só vale se estiver provisionado — nenhuma porta abre por omissão", () => {
    const h = new Headers({ "x-scope-crm-token": "qualquer" });
    const v = autenticarCrm({ hmac: "segredo", token: null }, h, corpo, agora);
    expect(v.ok).toBe(false);
  });

  it("nada provisionado é 503, não 401 — o problema é nosso", () => {
    const v = autenticarCrm({ hmac: null, token: null }, new Headers(), corpo, agora);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.status).toBe(503);
  });
});

// ════════════════════════════════════════════════════════════════════
describe("§3.3 — o payload", () => {
  it("recusa sem id_externo_crm, nome ou telefone, e diz quais faltam", () => {
    const r = lerPayloadCrm({ contato: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.campos).toEqual(["id_externo_crm", "contato.nome", "contato.telefone"]);
    }
  });

  it("aceita SEM documento — é o que faz o cliente nascer provisório", () => {
    const r = payload({ documento: null, empresa: {} });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.payload.documento).toBeNull();
  });

  it("normaliza o documento para só dígitos, aqui e em qualquer forma", () => {
    expect(normalizarDocumento("12.345.678/0001-90")).toBe("12345678000190");
    expect(normalizarDocumento("12345678000190")).toBe("12345678000190");
    expect(normalizarDocumento("")).toBeNull();
    expect(normalizarDocumento(null)).toBeNull();
  });

  it("aceita o documento vindo por empresa.cnpj quando o campo raiz não vem", () => {
    const r = payload({ documento: null });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.payload.documento).toBe("12345678000190");
  });
});

describe("RN-02 — só uma coluna dispara", () => {
  it('"Validação Contratual" e "validacao-contratual" são a mesma coluna', () => {
    expect(normalizarColuna("Validação Contratual")).toBe("validacao-contratual");
    expect(ehGatilho("Validação Contratual")).toBe(true);
    expect(ehGatilho("validacao-contratual")).toBe(true);
    expect(ehGatilho("VALIDAÇÃO  CONTRATUAL")).toBe(true);
  });

  it("nenhuma outra coluna dispara", () => {
    for (const c of ["Leads Quentes", "Follow Up", "Cliente Avulso", "", null]) {
      expect(ehGatilho(c)).toBe(false);
    }
  });
});

// ════════════════════════════════════════════════════════════════════
describe("Cenário: card entra em Validação Contratual com documento", () => {
  it("cria cliente efetivo, com o documento só em dígitos", async () => {
    const p = payload();
    if (!p.ok) throw new Error("payload");
    const r = await aplicarEventoCrm(fakeAtual() as never, p.payload, {});
    expect(r.estado).toBe("aplicado");
    if (r.estado !== "aplicado") return;
    expect(r.acao).toBe("criado");
    expect(r.status_cadastro).toBe("efetivo");

    const c = fakeAtual().tabela("clientes")[0];
    expect(c.cnpj).toBe("12345678000190");
    expect(c.crm_id).toBe("ord_8f3c1a");
    expect(c.origem).toBe("crm");
    // O evento fica gravado na caixa de entrada, com o desfecho.
    expect(fakeAtual().tabela("crm_webhook_events")[0].process_status).toBe("done");
  });
});

describe("Cenário: card entra sem documento", () => {
  it("cria PROVISÓRIO e ele aparece na fila", async () => {
    const p = payload({ documento: null, empresa: {} });
    if (!p.ok) throw new Error("payload");
    const r = await aplicarEventoCrm(fakeAtual() as never, p.payload, {});
    expect(r.estado).toBe("aplicado");
    if (r.estado !== "aplicado") return;
    expect(r.status_cadastro).toBe("provisorio");

    const fila = await clientesEmRevisao(fakeAtual() as never, "provisorio");
    expect(fila).toHaveLength(1);
    expect(fila[0].documento_principal ?? null).toBeNull();
    // ⛔ É a fila que torna "provisório" mais que um rótulo: sem ela, o estado
    // que bloqueia cobrança e nota fiscal seria invisível.
    expect(fila[0].dias_esperando).toBe(0);
  });
});

describe("Cenário: o mesmo card entra duas vezes", () => {
  it("devolve o MESMO cliente_id e não cria um segundo", async () => {
    const p = payload();
    if (!p.ok) throw new Error("payload");

    const a = await aplicarEventoCrm(fakeAtual() as never, p.payload, {});
    const b = await aplicarEventoCrm(fakeAtual() as never, p.payload, {});
    expect(a.estado).toBe("aplicado");
    expect(b.estado).toBe("aplicado");
    if (a.estado !== "aplicado" || b.estado !== "aplicado") return;

    expect(b.cliente_id).toBe(a.cliente_id);
    expect(b.acao).toBe("atualizado");
    expect(fakeAtual().tabela("clientes")).toHaveLength(1);
    // As duas entregas ficam gravadas: a caixa de entrada guarda tudo que
    // chegou, e é ela que permite auditar um reenvio manual.
    expect(fakeAtual().tabela("crm_webhook_events")).toHaveLength(2);
  });
});

describe("Cenário: duas empresas diferentes, mesmo documento", () => {
  it("recusa com conflito e NÃO funde nada", async () => {
    banco([cliente({ crm_id: "ord_ANTIGO" })]);
    const p = payload({ id_externo_crm: "ord_NOVO" });
    if (!p.ok) throw new Error("payload");

    const r = await aplicarEventoCrm(fakeAtual() as never, p.payload, {});
    expect(r.estado).toBe("conflito");
    if (r.estado !== "conflito") return;
    expect(r.cliente_id_existente).toBe(EXISTENTE);
    expect(fakeAtual().tabela("clientes")).toHaveLength(1);
    // O cadastro existente NÃO é tocado — nem o nome, nem o crm_id.
    expect(fakeAtual().tabela("clientes")[0].crm_id).toBe("ord_ANTIGO");
    expect(fakeAtual().tabela("crm_webhook_events")[0].process_status).toBe("conflito");
  });

  it("mas documento que já existe SEM card ganha o vínculo, não uma segunda linha", async () => {
    // É o cliente que nasceu na Dashboard, no financeiro ou pelo gateway.
    banco([cliente({ crm_id: null })]);
    const p = payload();
    if (!p.ok) throw new Error("payload");

    const r = await aplicarEventoCrm(fakeAtual() as never, p.payload, {});
    expect(r.estado).toBe("aplicado");
    if (r.estado !== "aplicado") return;
    expect(r.cliente_id).toBe(EXISTENTE);
    expect(r.acao).toBe("atualizado");
    expect(fakeAtual().tabela("clientes")).toHaveLength(1);
    expect(fakeAtual().tabela("clientes")[0].crm_id).toBe("ord_8f3c1a");
  });
});

describe("Cenário: card em outra coluna", () => {
  it("é recebido de propósito e NÃO vira cliente", async () => {
    const p = payload({ funil: { nome: "pre-venda", coluna: "Leads Quentes" } });
    if (!p.ok) throw new Error("payload");

    const r = await aplicarEventoCrm(fakeAtual() as never, p.payload, {});
    expect(r.estado).toBe("ignorado");
    expect(fakeAtual().tabela("clientes")).toHaveLength(0);
    // ⛔ Ligar qualquer coluna criaria cliente a partir de prospect: das 38
    // negociações do CRM apenas 12 estão ganhas.
    expect(fakeAtual().tabela("crm_webhook_events")[0].process_status).toBe("ignored");
  });
});

describe("Cenário: card sai da coluna depois de sincronizado (§3.6)", () => {
  it("lead.revertido NÃO apaga o cliente", async () => {
    const p = payload();
    if (!p.ok) throw new Error("payload");
    await aplicarEventoCrm(fakeAtual() as never, p.payload, {});

    const rev = payload({ evento: "lead.revertido" });
    if (!rev.ok) throw new Error("payload");
    const r = await aplicarEventoCrm(fakeAtual() as never, rev.payload, {});

    expect(r.estado).toBe("ignorado");
    if (r.estado === "ignorado") expect(r.motivo).toContain("PERMANECE");
    // ⛔ O cliente já pode ter cobrança gerada e nota emitida em segundos.
    // Apagar em cascata destruiria histórico fiscal que não pertence ao CRM.
    expect(fakeAtual().tabela("clientes")).toHaveLength(1);
  });
});

describe("clienteDoCrm — a tradução", () => {
  it("CNPJ vai em cnpj, CPF vai em cpf, e o status sai do documento", () => {
    const pj = payload();
    const pf = payload({ documento: "05898403124", empresa: {} });
    if (!pj.ok || !pf.ok) throw new Error("payload");

    expect(clienteDoCrm(pj.payload).cnpj).toBe("12345678000190");
    expect(clienteDoCrm(pj.payload).status_cadastro).toBe("efetivo");
    expect(clienteDoCrm(pf.payload).cpf).toBe("05898403124");
    expect(clienteDoCrm(pf.payload).cnpj).toBeUndefined();

    const sem = payload({ documento: null, empresa: {} });
    if (!sem.ok) throw new Error("payload");
    expect(clienteDoCrm(sem.payload).status_cadastro).toBe("provisorio");
  });
});

// ════════════════════════════════════════════════════════════════════
describe("§2.3 — o que 'provisório' PROÍBE, e por que isso não é rótulo", () => {
  /**
   * ⚠️ **Este bloco nasceu de um defeito medido em produção, em 28/08/2026.**
   * O vigia criou os dois primeiros clientes provisórios e `clientes_ativos`
   * saltou de 21 para 23 — porque `clientes.status` nasce `'Ativo'` por
   * default do schema, e a contagem do resumo olhava só para ele. Nenhum erro
   * foi levantado: o painel passou a exibir dois clientes a mais, com cara de
   * certo.
   *
   * ⚖️ A lição está no §2.3: sem a lista do que o estado proíbe, "provisório"
   * é um rótulo bonito que não protege de nada.
   */
  it("cliente provisório é criado com identidade INCOMPLETA e fica marcado", async () => {
    banco();
    const p = payload({ documento: null, empresa: {} });
    if (!p.ok) throw new Error("payload");
    await aplicarEventoCrm(fakeAtual() as never, p.payload, {});

    const c = fakeAtual().tabela("clientes")[0];
    expect(c.status_cadastro).toBe("provisorio");
    expect(c.cnpj).toBeUndefined();
    expect(c.cpf).toBeUndefined();
  });

  it("a fila devolve provisórios e conflitos, e ordena pelo mais antigo", async () => {
    const velho = new Date(Date.now() - 5 * 86_400_000).toISOString();
    banco([
      cliente({ id: "a", nome: "Antigo", status_cadastro: "provisorio", created_at: velho }),
      cliente({
        id: "b",
        nome: "Recente",
        documento_principal: "99999999000199",
        status_cadastro: "em_conflito",
      }),
      cliente({ id: "c", nome: "Normal", documento_principal: "88888888000188" }),
    ]);

    const fila = await clientesEmRevisao(fakeAtual() as never);
    expect(fila.map((f) => f.nome)).toEqual(["Antigo", "Recente"]);
    // ⛔ Quem já tem identidade conferida não aparece na fila.
    expect(fila.some((f) => f.nome === "Normal")).toBe(false);
    // Dias esperando é o que transforma a lista em urgência visível.
    expect(fila[0].dias_esperando).toBe(5);
  });

  it("filtra por estado quando pedido", async () => {
    banco([
      cliente({ id: "a", nome: "Prov", status_cadastro: "provisorio" }),
      cliente({
        id: "b",
        nome: "Confl",
        documento_principal: "99999999000199",
        status_cadastro: "em_conflito",
      }),
    ]);
    expect((await clientesEmRevisao(fakeAtual() as never, "provisorio")).map((f) => f.nome)).toEqual(["Prov"]);
    expect((await clientesEmRevisao(fakeAtual() as never, "em_conflito")).map((f) => f.nome)).toEqual(["Confl"]);
  });
});
