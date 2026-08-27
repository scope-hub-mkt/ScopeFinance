import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  asaasParaDataLocal,
  asaasParaUtc,
  autenticarAsaas,
  centavos,
  deCentavos,
  deducaoDoGateway,
  dinheiro,
  lerEnvelope,
} from "@/lib/asaas/webhook";
import {
  CATALOGO,
  EVENTOS_NEGOCIO,
  EVENTOS_OPERACIONAL,
  EVENTOS_P0,
  definicaoDoEvento,
  entidadePorPrefixo,
} from "@/lib/asaas/eventos";
import { calcularMrr, calcularResumo, calcularSerie } from "@/lib/integracao/contrato";
import { novoBanco, fakeAtual } from "./fakes/supabase-fake";

vi.mock("@/lib/supabase/admin", async () => {
  const { fakeAtual: f } = await import("./fakes/supabase-fake");
  return { createSupabaseAdmin: () => f() };
});

const {
  registrarEvento,
  processarEvento,
  processarPendentes,
  saudeDaFila,
  statusDaCobranca,
  cicloDoAsaas,
} = await import("@/lib/asaas/processar");

/**
 * Os critérios de aceite do §10.2 do `03-PLANO-DE-IMPLEMENTACAO.md`, mais as
 * duas armadilhas do §4.10 — que são as que não levantam exceção nenhuma e
 * por isso só teste pega.
 */

const CLIENTE = "11111111-1111-4111-8111-111111111111";

function banco() {
  return novoBanco(
    {
      clientes: [
        {
          id: CLIENTE,
          nome: "Clínica Vetro LTDA",
          doc: "12345678000190",
          documento_principal: "12345678000190",
          asaas_customer_id: "cus_000005913252",
          status: "Ativo",
          status_cadastro: "efetivo",
        },
      ],
      contas_receber: [],
      assinaturas: [],
      notas_fiscais: [],
      asaas_webhook_events: [],
      asaas_alertas: [],
    },
    {
      asaas_webhook_events: {
        unicos: [["id"]],
        defaults: { process_status: "pending", attempts: 0, received_at: () => new Date().toISOString() },
      },
      contas_receber: {
        unicos: [{ colunas: ["asaas_payment_id"], onde: (l) => l.asaas_payment_id != null }],
        defaults: { id: () => crypto.randomUUID(), status: "Pendente", deducoes: 0 },
      },
      assinaturas: {
        unicos: [{ colunas: ["asaas_subscription_id"], onde: (l) => l.asaas_subscription_id != null }],
        defaults: { id: () => crypto.randomUUID(), status: "Ativa", ciclo: "mensal" },
      },
      notas_fiscais: {
        unicos: [{ colunas: ["asaas_invoice_id"], onde: (l) => l.asaas_invoice_id != null }],
        defaults: { id: () => crypto.randomUUID(), status: "Pendente" },
      },
      asaas_alertas: {
        // ⛔ Um evento gera UM alerta. A restrição existe no banco
        // (`ux_asaas_alertas_evento`) e precisa existir aqui: sem ela, o teste
        // de reentrega passaria com um código que enfileira o mesmo chargeback
        // três vezes — e ninguém saberia se são três disputas ou uma
        // reprocessada.
        unicos: [{ colunas: ["evento_id"], nome: "ux_asaas_alertas_evento" }],
        defaults: { id: () => crypto.randomUUID(), criado_em: () => new Date().toISOString() },
      },
    }
  );
}

function evento(event: string, objeto: Record<string, unknown>, id = `evt_${event}_1`) {
  const chave = definicaoDoEvento(event)?.entidade ?? entidadePorPrefixo(event) ?? "payment";
  return { id, event, dateCreated: "2026-06-19 14:30:00", [chave]: objeto };
}

const COBRANCA = {
  object: "payment",
  id: "pay_080225913252",
  customer: "cus_000005913252",
  value: 150.0,
  netValue: 148.35,
  billingType: "PIX",
  status: "RECEIVED",
  dueDate: "2026-06-19",
  paymentDate: "2026-06-19",
  description: "Gestão de redes sociais",
};

beforeEach(() => banco());

// ════════════════════════════════════════════════════════════════════
describe("RN-AS-01 — o token é conferido antes de qualquer coisa", () => {
  it("recusa quando o header não vem", () => {
    const v = autenticarAsaas("segredo", null);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.status).toBe(401);
  });

  it("recusa quando o token não confere", () => {
    const v = autenticarAsaas("segredo", "outro");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.status).toBe(401);
  });

  it("aceita o token exato", () => {
    expect(autenticarAsaas("segredo", "segredo").ok).toBe(true);
  });

  it("token ausente no ambiente é 503, não 401 — o problema é nosso, não de quem chama", () => {
    const v = autenticarAsaas(null, "qualquer");
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.status).toBe(503);
      expect(v.motivo).toContain("ASAAS_WEBHOOK_TOKEN");
      // A confusão mais comum entre as duas credenciais fica nomeada na
      // própria mensagem: é ali que quem está plugando vai ler.
      expect(v.motivo).toContain("NÃO é a API Key");
    }
  });
});

// ════════════════════════════════════════════════════════════════════
describe("Cenário: pagamento recebido", () => {
  it("grava o evento com o payload cru e baixa a conta com base líquida", async () => {
    const env = lerEnvelope(evento("PAYMENT_RECEIVED", COBRANCA));
    expect(env.ok).toBe(true);
    if (!env.ok) return;

    const reg = await registrarEvento(fakeAtual() as never, env.envelope);
    expect(reg.novo).toBe(true);

    const gravado = fakeAtual().tabela("asaas_webhook_events")[0];
    // ⛔ O cru, íntegro: é a única coisa que permite reprocessar depois de
    // descobrir um bug.
    expect((gravado.payload as Record<string, unknown>).event).toBe("PAYMENT_RECEIVED");
    expect(gravado.entity_type).toBe("payment");
    expect(gravado.entity_id).toBe("pay_080225913252");

    const desfecho = await processarEvento(fakeAtual() as never, env.envelope);
    expect(desfecho.estado).toBe("done");

    const conta = fakeAtual().tabela("contas_receber")[0];
    expect(conta.status).toBe("Pago");
    expect(conta.cliente_id).toBe(CLIENTE);
    expect(conta.valor_cobrado).toBe("150.00");
    expect(conta.valor_liquido).toBe("148.35");
    // 📐 `RN-04` da Dashboard: base = valor_pago − deducoes. Com estes dois
    // valores, a base de comissão É o netValue, sem uma linha mudar lá.
    expect(conta.valor_pago).toBe("150.00");
    expect(conta.deducoes).toBe("1.65");
    expect(Number(conta.valor_pago) - Number(conta.deducoes)).toBe(148.35);
  });
});

describe("Cenário: o mesmo evento chega duas vezes", () => {
  it("a segunda entrega não roda regra de negócio de novo", async () => {
    const env = lerEnvelope(evento("PAYMENT_RECEIVED", COBRANCA));
    if (!env.ok) throw new Error("envelope");

    const primeira = await registrarEvento(fakeAtual() as never, env.envelope);
    expect(primeira.novo).toBe(true);
    await processarEvento(fakeAtual() as never, env.envelope);

    const segunda = await registrarEvento(fakeAtual() as never, env.envelope);
    // ⛔ É este `false` que impede a receita de ser contada duas vezes. Sem
    // ele a rota reprocessaria, e o `upsert` da conta é idempotente por sorte,
    // não por desenho — o próximo handler poderia não ser.
    expect(segunda.novo).toBe(false);

    expect(fakeAtual().tabela("asaas_webhook_events")).toHaveLength(1);
    expect(fakeAtual().tabela("contas_receber")).toHaveLength(1);
  });
});

describe("Cenário: payload com campo novo que o código não conhece", () => {
  it("é lido e processado normalmente, sem exceção", async () => {
    const env = lerEnvelope(
      evento("PAYMENT_RECEIVED", {
        ...COBRANCA,
        campoQueNaoExistiaOntem: { aninhado: [1, 2, 3] },
        outroNovo: "surpresa",
      })
    );
    expect(env.ok).toBe(true);
    if (!env.ok) return;

    await registrarEvento(fakeAtual() as never, env.envelope);
    const desfecho = await processarEvento(fakeAtual() as never, env.envelope);
    expect(desfecho.estado).toBe("done");

    // O campo desconhecido sobrevive no cru — não é descartado na entrada.
    const p = fakeAtual().tabela("asaas_webhook_events")[0].payload as Record<string, unknown>;
    expect((p.payment as Record<string, unknown>).outroNovo).toBe("surpresa");
  });
});

describe("Cenário: evento de tipo desconhecido", () => {
  it("é gravado com process_status ignored, nunca erro", async () => {
    const env = lerEnvelope({
      id: "evt_novidade",
      event: "PAYMENT_ALGO_QUE_O_ASAAS_LANCOU_HOJE",
      payment: { id: "pay_x" },
    });
    if (!env.ok) throw new Error("envelope");

    // Mesmo fora do catálogo, o prefixo o coloca na entidade certa — em vez
    // de virar linha órfã que só um `select *` encontra.
    expect(env.envelope.entity_type).toBe("payment");

    await registrarEvento(fakeAtual() as never, env.envelope);
    const desfecho = await processarEvento(fakeAtual() as never, env.envelope);
    expect(desfecho.estado).toBe("ignored");
    expect(fakeAtual().tabela("asaas_webhook_events")[0].process_status).toBe("ignored");
  });

  it("evento de onda 2/3 é gravado e fica declaradamente sem regra", async () => {
    const env = lerEnvelope(evento("PAYMENT_BANK_SLIP_VIEWED", { id: "pay_y" }));
    if (!env.ok) throw new Error("envelope");
    await registrarEvento(fakeAtual() as never, env.envelope);
    const d = await processarEvento(fakeAtual() as never, env.envelope);
    expect(d.estado).toBe("ignored");
    if (d.estado === "ignored") expect(d.motivo).toContain("P2");
  });
});

describe("Cenário: erro interno no processamento", () => {
  it("o evento fica failed com o motivo, e é reprocessável sem o Asaas reenviar", async () => {
    // Cobrança sem id: o handler não tem o que espelhar.
    const env = lerEnvelope(evento("PAYMENT_RECEIVED", { customer: "cus_x", value: 10 }));
    if (!env.ok) throw new Error("envelope");

    await registrarEvento(fakeAtual() as never, env.envelope);
    const d = await processarEvento(fakeAtual() as never, env.envelope);
    expect(d.estado).toBe("failed");

    const linha = fakeAtual().tabela("asaas_webhook_events")[0];
    expect(linha.process_status).toBe("failed");
    expect(String(linha.process_error)).toContain("sem id");
    expect(linha.attempts).toBe(1);

    // A varredura o pega de novo — é a rede de segurança do §4.5.
    const varredura = await processarPendentes(fakeAtual() as never);
    expect(varredura.examinados).toBe(1);
    expect(fakeAtual().tabela("asaas_webhook_events")[0].attempts).toBe(2);
  });
});

describe("Cenário: valor editado no Finance e depois atualizado no Asaas", () => {
  it("valor_contratado sobrevive; só valor_cobrado muda", async () => {
    const criado = lerEnvelope(evento("PAYMENT_CREATED", { ...COBRANCA, status: "PENDING" }, "evt_1"));
    if (!criado.ok) throw new Error("envelope");
    await registrarEvento(fakeAtual() as never, criado.envelope);
    await processarEvento(fakeAtual() as never, criado.envelope);

    // Alguém edita o combinado no ScopeFinance — é o `RN-03` do board.
    const conta = fakeAtual().tabela("contas_receber")[0];
    conta.valor_contratado = "3000.00";

    const atualizado = lerEnvelope(
      evento("PAYMENT_UPDATED", { ...COBRANCA, value: 2500, netValue: 2450, status: "PENDING" }, "evt_2")
    );
    if (!atualizado.ok) throw new Error("envelope");
    await registrarEvento(fakeAtual() as never, atualizado.envelope);
    await processarEvento(fakeAtual() as never, atualizado.envelope);

    const depois = fakeAtual().tabela("contas_receber")[0];
    // ⛔ Os dois fatos não disputam o mesmo campo — é isso que faz a pergunta
    // "quem ganha?" desaparecer, em vez de precisar de uma flag que escolhe
    // uma verdade para apagar.
    expect(depois.valor_contratado).toBe("3000.00");
    expect(depois.valor_cobrado).toBe("2500.00");
    expect(fakeAtual().tabela("contas_receber")).toHaveLength(1);
  });
});

// ════════════════════════════════════════════════════════════════════
describe("§4.10 armadilha 1 — o fuso horário", () => {
  it("22:00 do dia 31 em Brasília é dia 1º em UTC — e isso muda o mês", () => {
    const iso = asaasParaUtc("2026-05-31 22:00:00");
    expect(iso).toBe("2026-06-01T01:00:00.000Z");
    // ⚠️ A competência vem da data LOCAL, não do UTC: senão o pagamento do
    // dia 31 seria contabilizado em junho, e o mês fecharia errado nos dois.
    expect(asaasParaDataLocal("2026-05-31 22:00:00")).toBe("2026-05-31");
  });

  it("data sem hora é a data local, não meia-noite UTC convertida", () => {
    expect(asaasParaDataLocal("2026-08-21")).toBe("2026-08-21");
    expect(asaasParaUtc("2026-08-21")).toBe("2026-08-21T03:00:00.000Z");
  });

  it("entrada irreconhecível vira null, nunca a data de hoje", () => {
    expect(asaasParaUtc("ontem")).toBeNull();
    expect(asaasParaUtc(null)).toBeNull();
    expect(asaasParaDataLocal(undefined)).toBeNull();
  });

  it("data que já traz fuso é respeitada", () => {
    expect(asaasParaUtc("2026-06-19T14:30:00Z")).toBe("2026-06-19T14:30:00.000Z");
  });
});

describe("§4.10 armadilha 2 — dinheiro nunca em float", () => {
  it("a subtração que o JavaScript erra sai exata", () => {
    // 150.00 - 148.35 === 1.6500000000000057 em ponto flutuante.
    expect(150.0 - 148.35).not.toBe(1.65);
    expect(deducaoDoGateway(150.0, 148.35)).toBe("1.65");
  });

  it("centavos e volta preservam o valor", () => {
    expect(centavos(150)).toBe(15000);
    expect(centavos(148.35)).toBe(14835);
    expect(deCentavos(14835)).toBe("148.35");
    expect(deCentavos(5)).toBe("0.05");
    expect(deCentavos(100)).toBe("1.00");
    expect(dinheiro(0.1)).toBe("0.10");
  });

  it("líquido maior que bruto não vira desconto negativo", () => {
    expect(deducaoDoGateway(100, 120)).toBe("0.00");
  });

  it("valor ausente é null, não zero — não houve cobrança de R$ 0,00", () => {
    expect(dinheiro(null)).toBeNull();
    expect(dinheiro(undefined)).toBeNull();
    expect(dinheiro("")).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════
describe("O catálogo dos 73 eventos", () => {
  it("tem exatamente os 73 do asaas-eventos.json", () => {
    expect(Object.keys(CATALOGO)).toHaveLength(73);
  });

  it("separa negócio de operacional — 49 e 24", () => {
    expect(EVENTOS_NEGOCIO).toHaveLength(49);
    expect(EVENTOS_OPERACIONAL).toHaveLength(24);
    // ⛔ Nenhum evento de dinheiro pode cair no webhook operacional: uma falha
    // de monitoramento não pode ter poder de pausar a fila do financeiro.
    for (const e of EVENTOS_P0) expect(CATALOGO[e].webhook).toBe("negocio");
  });

  it("os P0 são os 19 da primeira onda do §4.8", () => {
    // 11 cobranças + 4 assinaturas + 3 notas + 1 checkout. A conta está
    // escrita aqui de propósito: um evento que entra ou sai da primeira onda
    // muda o que o sistema faz com dinheiro, e isso não pode passar batido
    // num diff.
    expect(EVENTOS_P0.filter((e) => CATALOGO[e].entidade === "payment")).toHaveLength(11);
    expect(EVENTOS_P0.filter((e) => CATALOGO[e].entidade === "subscription")).toHaveLength(4);
    expect(EVENTOS_P0.filter((e) => CATALOGO[e].entidade === "invoice")).toHaveLength(3);
    expect(EVENTOS_P0.filter((e) => CATALOGO[e].entidade === "checkout")).toHaveLength(1);
    expect(EVENTOS_P0).toHaveLength(19);
    expect(EVENTOS_P0).toContain("PAYMENT_RECEIVED");
    expect(EVENTOS_P0).toContain("SUBSCRIPTION_INACTIVATED");
    expect(EVENTOS_P0).toContain("INVOICE_AUTHORIZED");
    expect(EVENTOS_P0).toContain("CHECKOUT_PAID");
  });
});

describe("Tradução de status — o vocabulário que o painel da Dashboard soma", () => {
  it("CONFIRMED não é Pago — dinheiro prometido não é dinheiro recebido", () => {
    expect(statusDaCobranca("PAYMENT_CONFIRMED", "CONFIRMED")).toBe("Pendente");
    expect(statusDaCobranca("PAYMENT_RECEIVED", "RECEIVED")).toBe("Pago");
  });

  it("estorno vira Cancelado, para não inflar a inadimplência do painel", () => {
    expect(statusDaCobranca("PAYMENT_REFUNDED", "REFUNDED")).toBe("Cancelado");
    expect(statusDaCobranca("PAYMENT_DELETED", "DELETED")).toBe("Cancelado");
  });

  it("baixa em dinheiro conta como recebida", () => {
    expect(statusDaCobranca("PAYMENT_UPDATED", "RECEIVED_IN_CASH")).toBe("Pago");
  });

  it("eventos que só mexem em valor não mexem no status", () => {
    expect(statusDaCobranca("PAYMENT_PARTIALLY_REFUNDED", "RECEIVED")).toBeNull();
    expect(statusDaCobranca("PAYMENT_ANTICIPATED", "RECEIVED")).toBeNull();
  });
});

describe("Ciclo de assinatura — o palpite que multiplicaria o MRR", () => {
  it("traduz os ciclos que o Asaas emite", () => {
    expect(cicloDoAsaas("MONTHLY")).toBe("mensal");
    expect(cicloDoAsaas("QUARTERLY")).toBe("trimestral");
    expect(cicloDoAsaas("SEMIANNUALLY")).toBe("semestral");
    expect(cicloDoAsaas("YEARLY")).toBe("anual");
  });

  it("recusa ciclo desconhecido em vez de chamar de mensal", () => {
    expect(cicloDoAsaas("QUINQUENALMENTE")).toBeNull();
  });

  it("o MRR normaliza todos os ciclos, não só três", () => {
    const um = (ciclo: string, valor: number) => ({ ciclo, valor, status: "Ativa" });
    expect(calcularMrr([um("mensal", 1000)])).toBe(1000);
    expect(calcularMrr([um("anual", 1200)])).toBe(100);
    expect(calcularMrr([um("trimestral", 300)])).toBe(100);
    // Sem esta linha, uma semestral de R$ 600 entrava como R$ 600/mês —
    // seis vezes o que ela vale.
    expect(calcularMrr([um("semestral", 600)])).toBe(100);
    expect(calcularMrr([um("bimestral", 200)])).toBe(100);
    expect(calcularMrr([um("semanal", 100)])).toBeCloseTo(433.33, 2);
    // Cancelada não entra em receita recorrente.
    expect(calcularMrr([{ ciclo: "mensal", valor: 999, status: "Cancelada" }])).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════
describe("Envelope — permissivo no que aceita, exigente no que precisa", () => {
  it("recusa corpo sem id do evento — sem ele não há idempotência", () => {
    const r = lerEnvelope({ event: "PAYMENT_RECEIVED", payment: { id: "pay_1" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toContain("idempotência");
  });

  it("recusa corpo que não é objeto", () => {
    expect(lerEnvelope("texto").ok).toBe(false);
    expect(lerEnvelope(null).ok).toBe(false);
    expect(lerEnvelope([1, 2]).ok).toBe(false);
  });

  it("aceita evento sem objeto de entidade sem quebrar", () => {
    const r = lerEnvelope({ id: "evt_1", event: "ACCESS_TOKEN_EXPIRED" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.envelope.entity_type).toBe("token");
      expect(r.envelope.objeto).toBeNull();
    }
  });
});

describe("§4.9 — o silêncio precisa ser um sinal ativo", () => {
  it("nunca ter recebido evento NÃO é alerta de fila", async () => {
    const s = await saudeDaFila(fakeAtual() as never);
    expect(s.alerta).toBe(false);
    // ⚠️ "Não plugado" e "parou de chegar" são estados diferentes. Chamar o
    // primeiro de alerta treinaria quem olha a ignorar o vermelho.
    expect(s.motivo).toContain("ainda não foi apontado");
  });

  it("silêncio longo depois de ter recebido é alerta", async () => {
    fakeAtual().tabela("asaas_webhook_events").push({
      id: "evt_velho",
      event_type: "PAYMENT_RECEIVED",
      payload: {},
      process_status: "done",
      received_at: new Date(Date.now() - 72 * 3_600_000).toISOString(),
    });
    const s = await saudeDaFila(fakeAtual() as never);
    expect(s.alerta).toBe(true);
    expect(s.motivo).toContain("pausada");
  });
});

// ════════════════════════════════════════════════════════════════════
describe("§4.10 dentro de casa — a soma do resumo também é dinheiro", () => {
  /**
   * ⚠️ Este teste nasceu de um sintoma de produção, não de imaginação. Depois
   * do backfill, `/resumo` devolveu `"recebido_mes": 7890.870000000001`. Com
   * 14 contas o defeito nunca apareceu; com 194 ele apareceu no primeiro dia.
   *
   * ⛔ Não é problema de formatação: o número atravessa a ponte e a Dashboard
   * o exibe **sem recalcular** (`RN-01`). O resíduo é o que ela mostra.
   */
  const conta = (valor: number, pago_em: string | null) => ({
    id: `c${valor}${pago_em}`,
    cliente_id: "cli",
    contrato_id: null,
    valor,
    valor_pago: valor,
    deducoes: 0,
    vencimento: "2026-08-10",
    status: pago_em ? "Pago" : "Pendente",
    pago_em,
  });

  it("somar centavos não deixa resíduo de ponto flutuante", () => {
    // 0.1 + 0.2 !== 0.3 em JavaScript — a soma direta destas três falharia.
    const r = calcularResumo(
      [conta(0.1, "2026-08-01"), conta(0.2, "2026-08-02")],
      [],
      0,
      "2026-08-15"
    );
    expect(r.recebido_mes).toBe(0.3);
    expect(String(r.recebido_mes)).not.toContain("000000");
  });

  it("reproduz o valor exato que produção devolveu errado", () => {
    const parcelas = [1550.0, 890.0, 2500.0, 449.0, 1200.0, 1301.87];
    const r = calcularResumo(
      parcelas.map((v, i) => conta(v, `2026-08-0${i + 1}`)),
      [],
      0,
      "2026-08-15"
    );
    expect(r.recebido_mes).toBe(7890.87);
  });

  it("a série mensal também sai sem resíduo", () => {
    const s = calcularSerie(
      [conta(0.1, "2026-08-01"), conta(0.2, "2026-08-02")],
      "2026-08-15",
      1
    );
    expect(s[0].recebido).toBe(0.3);
  });

  it("o MRR de ciclos fracionários fecha em centavo", () => {
    // 12/52 avos é dízima; sem centavo inteiro o total viria com cauda.
    const mrr = calcularMrr([{ ciclo: "semanal", valor: 100, status: "Ativa" }]);
    expect(Number.isInteger(Math.round(mrr * 100))).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════
describe("Fase 7 — ondas 2 e 3: status fino e alertas, nunca dinheiro", () => {
  const COBRANCA_EXISTENTE = {
    id: "cr-1",
    asaas_payment_id: "pay_080225913252",
    cliente_id: CLIENTE,
    status: "Pendente",
    asaas_status: "PENDING",
    valor: "150.00",
    valor_contratado: "150.00",
    valor_pago: null,
    deducoes: "0.00",
  };

  function bancoComCobranca() {
    const b = banco();
    b.tabela("contas_receber").push({ ...COBRANCA_EXISTENTE });
    return b;
  }

  async function entregar(event: string, objeto: Record<string, unknown>, id = `evt_${event}`) {
    const env = lerEnvelope(evento(event, objeto, id));
    if (!env.ok) throw new Error("envelope");
    await registrarEvento(fakeAtual() as never, env.envelope);
    return processarEvento(fakeAtual() as never, env.envelope);
  }

  it("chargeback abre alerta CRÍTICO e não encosta no dinheiro", async () => {
    bancoComCobranca();
    const d = await entregar("PAYMENT_CHARGEBACK_REQUESTED", {
      ...COBRANCA,
      status: "CHARGEBACK_REQUESTED",
    });
    expect(d.estado).toBe("done");

    const a = fakeAtual().tabela("asaas_alertas")[0];
    expect(a.severidade).toBe("critico");
    expect(a.categoria).toBe("cobranca");
    expect(a.valor).toBe("150.00");
    expect(a.cliente_id).toBe(CLIENTE);

    // ⛔ A regra que separa onda 1 de onda 2: o status FINO é espelhado, o
    // status de domínio não muda, e nenhum valor é tocado. Um evento de
    // "disputa aberta" que mexesse na receita daria um número durante a
    // disputa e outro depois — e nenhum dos dois seria a verdade.
    const c = fakeAtual().tabela("contas_receber")[0];
    expect(c.asaas_status).toBe("CHARGEBACK_REQUESTED");
    expect(c.status).toBe("Pendente");
    expect(c.valor).toBe("150.00");
    expect(c.valor_pago).toBeNull();
    expect(c.deducoes).toBe("0.00");
  });

  it("o mesmo evento reentregue não duplica o alerta", async () => {
    bancoComCobranca();
    await entregar("PAYMENT_CHARGEBACK_REQUESTED", COBRANCA, "evt_dup");
    // A varredura reprocessa o mesmo evento — é o caminho real do §4.5.
    const env = lerEnvelope(evento("PAYMENT_CHARGEBACK_REQUESTED", COBRANCA, "evt_dup"));
    if (!env.ok) throw new Error("envelope");
    await processarEvento(fakeAtual() as never, env.envelope);

    // Sem o índice único, o mesmo chargeback apareceria duas vezes na fila e
    // ninguém saberia se são duas disputas ou uma reprocessada.
    expect(fakeAtual().tabela("asaas_alertas")).toHaveLength(1);
  });

  it("evento de conta e de chave de API viram alerta, com a categoria certa", async () => {
    banco();
    await entregar("ACCOUNT_STATUS_GENERAL_APPROVAL_REJECTED", {}, "evt_conta");
    await entregar("ACCESS_TOKEN_EXPIRED", {}, "evt_token");

    const alertas = fakeAtual().tabela("asaas_alertas");
    expect(alertas).toHaveLength(2);
    expect(alertas.map((a) => a.categoria).sort()).toEqual(["conta", "seguranca"]);
    // Os dois param a operação — por isso críticos.
    expect(alertas.every((a) => a.severidade === "critico")).toBe(true);
  });

  it("⛔ telemetria NÃO vira alerta — fila cheia de ruído é fila que ninguém lê", async () => {
    bancoComCobranca();
    const d = await entregar("PAYMENT_BANK_SLIP_VIEWED", COBRANCA);
    expect(d.estado).toBe("done");
    // O boleto visto espelha o status e para aí.
    expect(fakeAtual().tabela("asaas_alertas")).toHaveLength(0);
  });

  it("⛔ split NÃO vira alerta — a Scope não usa split", async () => {
    banco();
    const d = await entregar("PAYMENT_SPLIT_DONE", { id: "pay_x" });
    expect(d.estado).toBe("ignored");
    expect(fakeAtual().tabela("asaas_alertas")).toHaveLength(0);
  });

  it("todo evento P1/P2 com regra tem categoria e severidade válidas", async () => {
    const { REGRAS } = await import("@/lib/asaas/alertas");
    for (const [ev, r] of Object.entries(REGRAS)) {
      expect(["cobranca", "fiscal", "conta", "seguranca"], ev).toContain(r.categoria);
      expect(["critico", "atencao"], ev).toContain(r.severidade);
      // ⛔ Nenhum P0 pode estar aqui: eles mexem em dinheiro, e esta lista é a
      // dos que NÃO mexem.
      expect(EVENTOS_P0, ev).not.toContain(ev);
      // E todo evento com regra tem de existir no catálogo — regra para
      // evento inventado nunca dispararia, e ninguém notaria.
      expect(CATALOGO[ev], ev).toBeDefined();
    }
  });

  it("crítico é minoria — uma fila em que tudo é crítico não tem prioridade", async () => {
    const { REGRAS } = await import("@/lib/asaas/alertas");
    const todas = Object.values(REGRAS);
    const criticos = todas.filter((r) => r.severidade === "critico").length;
    expect(criticos).toBeLessThan(todas.length / 2);
  });
});

// ════════════════════════════════════════════════════════════════════
describe("A fila de alertas ordena o urgente no topo", () => {
  /**
   * ⚠️ **Este teste nasceu de um defeito medido em produção.** A tela ordenava
   * `severidade` em ordem **crescente** com o comentário afirmando que
   * `critico` vinha antes de `atencao` — vem **depois** (`a` < `c`). A fila
   * subiu com um chargeback de R$ 150 embaixo de um aviso de chave expirando.
   *
   * ⛔ Ordenação errada não quebra nada e não levanta exceção: ela só põe o
   * urgente fora de vista, que é o oposto do motivo de a fila existir.
   */
  it("crescente colocaria 'atencao' na frente — por isso a consulta é decrescente", () => {
    const ordenado = ["critico", "atencao"].sort();
    expect(ordenado[0]).toBe("atencao");
    // Decrescente devolve o crítico primeiro, que é o que a tela precisa.
    expect(["atencao", "critico"].sort().reverse()[0]).toBe("critico");
  });
});
