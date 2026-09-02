import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **O dinheiro passa a vir do gateway** — 02/09/2026.
 *
 * ⚖️ **O defeito que estas telas fecharam, medido no dia.** A linha "Asaas" da
 * tabela `bancos` dizia **R$ 429,47**; `GET /finance/balance` da mesma conta
 * respondia **R$ 13,79**. A tela de contas, a Dashboard e o relatório exibiam
 * os R$ 429,47 sem erro nenhum — número redondo, no lugar certo, 31× maior que
 * o dinheiro que existe.
 *
 * ⛔ **O que este arquivo trava não é a formatação.** São as duas coisas que
 * podem voltar a mentir sem quebrar nada:
 *
 *   1. **Falha virar zero.** `Leitura<T>` existe para que "não consegui
 *      perguntar" e "não há dinheiro" nunca se pareçam. Um `catch` que devolve
 *      `0` reintroduz o defeito com aparência de robustez.
 *   2. **Status desconhecido cair no balde errado.** Um chargeback com nome
 *      novo somado ao "ainda vai cair" é receita que não existe.
 */

const respostas = new Map<string, unknown>();
let chamadas: string[] = [];

function responder(caminho: string, corpo: unknown) {
  respostas.set(caminho, corpo);
}

beforeEach(() => {
  respostas.clear();
  chamadas = [];
  process.env.ASAAS_API_KEY = "chave-de-teste";
  process.env.ASAAS_API_BASE = "https://api.asaas.test/v3";

  vi.stubGlobal("fetch", async (url: string) => {
    const caminho = String(url).replace("https://api.asaas.test/v3", "");
    chamadas.push(caminho);
    const achado = [...respostas.entries()].find(([k]) => caminho.startsWith(k));
    if (!achado) {
      return new Response(JSON.stringify({ errors: [{ description: "não mapeado" }] }), {
        status: 404,
      });
    }
    return new Response(JSON.stringify(achado[1]), { status: 200 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const pagina = (data: unknown[], hasMore = false) => ({
  data,
  hasMore,
  totalCount: data.length,
  offset: 0,
});

const cobranca = (over: Record<string, unknown> = {}) => ({
  id: "pay_1",
  customer: "cus_1",
  value: 100,
  status: "RECEIVED",
  dateCreated: "2026-06-01",
  paymentDate: "2026-06-02",
  creditCard: { creditCardNumber: "1234", creditCardBrand: "VISA" },
  ...over,
});

describe("painelBancario — o saldo vem do gateway, e a falha não vira zero", () => {
  it("lê saldo, titular, Pix, estatísticas e extrato numa ida só", async () => {
    responder("/finance/balance", { balance: 13.79 });
    responder("/finance/payment/statistics", {
      quantity: 183,
      value: 194351.57,
      netValue: 194151.18,
    });
    responder("/myAccount/commercialInfo", {
      companyName: "SCOPE HUB MARKETING LTDA",
      cpfCnpj: "48396488000144",
      email: "financeiro@scopehub.com.br",
      status: "APPROVED",
      city: { name: "Aparecida de Goiânia", state: "GO" },
    });
    responder("/pix/addressKeys", pagina([{ key: "abc-123", type: "EVP", status: "ACTIVE" }]));
    responder(
      "/financialTransactions",
      pagina([
        {
          id: "ftn_1",
          value: -449,
          balance: 13.79,
          type: "RECEIVABLE_ANTICIPATION_DEBIT",
          date: "2026-08-31",
          description: "Baixa da antecipação",
          paymentId: null,
        },
      ])
    );

    const { painelBancario } = await import("@/lib/asaas/conta");
    const p = await painelBancario(25);

    // ⚖️ O número que a tela mostra é ESTE, e ele não passa por tabela nenhuma.
    expect(p.saldo).toEqual({ ok: true, valor: 13.79 });
    expect(p.titular.ok && p.titular.valor.nome).toBe("SCOPE HUB MARKETING LTDA");
    expect(p.titular.ok && p.titular.valor.uf).toBe("GO");
    expect(p.cobrancas.ok && p.cobrancas.valor.valor_liquido).toBe(194151.18);
    expect(p.pix.ok && p.pix.valor[0].tipo).toBe("EVP");
    // O saldo após a linha vem do gateway, não de uma soma refeita aqui:
    // refazê-la criaria um segundo saldo, que é a origem de toda divergência.
    expect(p.extrato.ok && p.extrato.valor[0].saldo_apos).toBe(13.79);
  });

  it("⛔ leitura que falha vira `{ ok: false }`, NUNCA zero", async () => {
    responder("/finance/payment/statistics", { quantity: 0, value: 0, netValue: 0 });
    // `/finance/balance` fica sem resposta mapeada de propósito → 404.

    const { painelBancario } = await import("@/lib/asaas/conta");
    const p = await painelBancario();

    expect(p.saldo.ok).toBe(false);
    // ⚠️ Esta é a asserção que importa: se algum dia alguém "melhorar" o
    // tratamento devolvendo 0, a tela volta a afirmar que a empresa está sem
    // dinheiro quando o que houve foi um erro de rede.
    expect(p.saldo).not.toHaveProperty("valor");
  });

  it("um bloco que cai não derruba os outros", async () => {
    responder("/finance/balance", { balance: 500 });
    // Pix e extrato sem resposta → 404 em cada um.

    const { painelBancario } = await import("@/lib/asaas/conta");
    const p = await painelBancario();

    expect(p.saldo).toEqual({ ok: true, valor: 500 });
    expect(p.pix.ok).toBe(false);
    expect(p.extrato.ok).toBe(false);
  });

  it("tipo de extrato desconhecido mantém o código cru — a pista não some", async () => {
    const { rotuloExtrato } = await import("@/lib/asaas/conta");
    expect(rotuloExtrato("PAYMENT_RECEIVED")).toBe("Cobrança recebida");
    expect(rotuloExtrato("COISA_NOVA_DO_ASAAS")).toBe("COISA_NOVA_DO_ASAAS");
  });
});

describe("situacaoDe — o balde errado é receita inventada", () => {
  it("liquidado é dinheiro que entrou ou está confirmado", async () => {
    const { situacaoDe } = await import("@/lib/asaas/cartoes");
    expect(situacaoDe("RECEIVED")).toBe("liquidado");
    expect(situacaoDe("CONFIRMED")).toBe("liquidado");
    expect(situacaoDe("RECEIVED_IN_CASH")).toBe("liquidado");
  });

  it("aberto é o que ainda vai cair", async () => {
    const { situacaoDe } = await import("@/lib/asaas/cartoes");
    expect(situacaoDe("PENDING")).toBe("aberto");
    expect(situacaoDe("AWAITING_RISK_ANALYSIS")).toBe("aberto");
  });

  it("⛔ status DESCONHECIDO cai em `problema`, não em `aberto`", async () => {
    const { situacaoDe } = await import("@/lib/asaas/cartoes");
    // O Asaas cria status sem avisar. Cair em "aberto" esconderia um
    // chargeback novo dentro do dinheiro que a empresa espera receber.
    expect(situacaoDe("CHARGEBACK_REQUESTED")).toBe("problema");
    expect(situacaoDe("OVERDUE")).toBe("problema");
    expect(situacaoDe("STATUS_QUE_AINDA_NAO_EXISTE")).toBe("problema");
    expect(situacaoDe("")).toBe("problema");
  });
});

describe("resumoDeCartoes — agrega o cartão que PAGA", () => {
  it("agrupa por bandeira + 4 últimos, soma por situação e nomeia quem pagou", async () => {
    responder(
      "/payments?billingType=CREDIT_CARD",
      pagina([
        cobranca({ id: "a", value: 300, status: "RECEIVED" }),
        cobranca({ id: "b", value: 200, status: "PENDING" }),
        cobranca({ id: "c", value: 50, status: "OVERDUE" }),
        cobranca({
          id: "d",
          value: 999,
          customer: "cus_2",
          creditCard: { creditCardNumber: "9999", creditCardBrand: "elo" },
        }),
      ])
    );
    responder("/installments", pagina([]));

    const { resumoDeCartoes } = await import("@/lib/asaas/cartoes");
    const r = await resumoDeCartoes(new Map([["cus_1", "Clínica Alfa"]]));

    expect(r.cartoes).toHaveLength(2);
    // Maior volume primeiro: a tela responde "por onde entra mais dinheiro?".
    expect(r.cartoes[0].chave).toBe("ELO-9999");

    const visa = r.cartoes.find((c) => c.chave === "VISA-1234")!;
    expect(visa.cobrancas).toBe(3);
    expect(visa.liquidado).toBe(300);
    expect(visa.aberto).toBe(200);
    expect(visa.problema).toBe(50);
    expect(visa.clientes).toEqual(["Clínica Alfa"]);

    // ⛔ Cliente sem vínculo `asaas_customer_id` fica como lacuna, e não vira
    // nome chutado: a lacuna é real e o conserto dela é a reconciliação.
    expect(r.cartoes[0].clientes).toEqual([]);

    expect(r.total.cobrancas).toBe(4);
    expect(r.total.cartoes_distintos).toBe(2);
    expect(r.truncado).toBe(false);
  });

  it("cobrança sem bandeira nem dígitos não é descartada — ela é dinheiro", async () => {
    responder(
      "/payments?billingType=CREDIT_CARD",
      pagina([cobranca({ id: "x", value: 399, creditCard: null })])
    );
    responder("/installments", pagina([]));

    const { resumoDeCartoes } = await import("@/lib/asaas/cartoes");
    const r = await resumoDeCartoes();

    expect(r.cartoes[0].chave).toBe("SEM BANDEIRA-????");
    expect(r.cartoes[0].final).toBeNull();
    expect(r.total.valor_total).toBe(399);
  });

  it("primeiro e último uso saem da data do pagamento, ou da criação enquanto não caiu", async () => {
    responder(
      "/payments?billingType=CREDIT_CARD",
      pagina([
        cobranca({ id: "a", paymentDate: "2026-03-10" }),
        cobranca({ id: "b", paymentDate: null, dateCreated: "2026-07-20" }),
        cobranca({ id: "c", paymentDate: "2026-01-05" }),
      ])
    );
    responder("/installments", pagina([]));

    const { resumoDeCartoes } = await import("@/lib/asaas/cartoes");
    const r = await resumoDeCartoes();

    expect(r.cartoes[0].primeiro_uso).toBe("2026-01-05");
    expect(r.cartoes[0].ultimo_uso).toBe("2026-07-20");
  });

  it("parcelamento apagado no gateway não entra na lista", async () => {
    responder("/payments?billingType=CREDIT_CARD", pagina([]));
    responder(
      "/installments",
      pagina([
        {
          id: "i1",
          customer: "cus_1",
          value: 1875.2,
          paymentValue: 187.52,
          installmentCount: 10,
          paymentDate: "2026-02-26",
          creditCard: { creditCardNumber: "9616", creditCardBrand: "MASTERCARD" },
        },
        { id: "i2", deleted: true, value: 100, installmentCount: 2 },
      ])
    );

    const { resumoDeCartoes } = await import("@/lib/asaas/cartoes");
    const r = await resumoDeCartoes(new Map([["cus_1", "Clínica Alfa"]]));

    expect(r.parcelamentos).toHaveLength(1);
    expect(r.parcelamentos[0].parcelas).toBe(10);
    expect(r.parcelamentos[0].valor_parcela).toBe(187.52);
    expect(r.parcelamentos[0].cliente).toBe("Clínica Alfa");
  });

  it("⚠️ leitura cortada no teto de páginas é DECLARADA, não silenciosa", async () => {
    // `hasMore: true` para sempre: é a conta que cresceu além do teto.
    responder("/payments?billingType=CREDIT_CARD", pagina([cobranca()], true));
    responder("/installments", pagina([], false));

    const { resumoDeCartoes } = await import("@/lib/asaas/cartoes");
    const r = await resumoDeCartoes();

    // ⛔ Sem esta bandeira, um total parcial chegaria à tela com cara de total.
    expect(r.truncado).toBe(true);
    expect(chamadas.filter((c) => c.startsWith("/payments"))).toHaveLength(20);
  });

  it("lerResumoDeCartoes embrulha a falha em vez de derrubar a tela", async () => {
    // Nada mapeado → 404 na primeira página.
    const { lerResumoDeCartoes } = await import("@/lib/asaas/cartoes");
    const r = await lerResumoDeCartoes();

    expect(r.ok).toBe(false);
    expect(r).not.toHaveProperty("valor");
  });
});
