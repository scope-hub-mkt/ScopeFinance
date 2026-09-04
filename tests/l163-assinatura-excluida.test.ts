import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backfillAssinaturas, backfillCobrancas, religarOrfaos } from "@/lib/asaas/backfill";
import { novoBanco, type BancoFake } from "./fakes/supabase-fake";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * `L-163` — **a listagem do Asaas esconde o excluído, e o excluído tem
 * dinheiro atrás.**
 *
 * ⛔ **O defeito que este arquivo guarda, medido na conta de produção em
 * 04/09/2026:** `GET /subscriptions` devolve **8** assinaturas;
 * `?includeDeleted=true` devolve **34**. As 26 restantes estão `INACTIVE` com
 * `deleted: true` — e **113 cobranças reais apontam para 31 assinaturas
 * distintas**. Resultado: 80 cobranças gravadas com `assinatura_id` nulo, a
 * Dashboard sem a chave que liga o pagamento a quem prestou o serviço, e o
 * motor de comissão criando **zero** todo dia, com HTTP 200.
 *
 * ⚖️ **A lição já estava escrita a dois arquivos daqui** — `buscarUm` em
 * `lib/asaas.ts` existe porque `/customers` omite o excluído, medido em
 * 28/08/2026. A mesma armadilha, na coleção seguinte, custou uma semana. Por
 * isso o primeiro caso deste arquivo não olha o resultado: **olha a pergunta
 * feita ao gateway**, que é onde o defeito mora.
 */

const respostas = new Map<string, unknown>();
let chamadas: string[] = [];

beforeEach(() => {
  respostas.clear();
  chamadas = [];
  process.env.ASAAS_API_KEY = "chave-de-teste";

  vi.stubGlobal("fetch", async (url: string) => {
    // ⚠️ A base do cliente é capturada na carga do módulo, então mexer em
    // `ASAAS_API_BASE` aqui não a alcança — o corte é pelo `/v3`, que vale
    // para sandbox e produção. Nenhuma rede é tocada: o `fetch` é o stub.
    const caminho = String(url).replace(/^https?:\/\/[^/]+\/v3/, "");
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

afterEach(() => vi.unstubAllGlobals());

const pagina = (data: unknown[], hasMore = false) => ({
  data,
  hasMore,
  totalCount: data.length,
  offset: 0,
});

/** Assinatura cancelada no Asaas — o formato literal que a conta devolve. */
const assinaturaExcluida = {
  id: "sub_t93165njb2srsqo5",
  customer: "cus_000178817351",
  value: 449,
  cycle: "MONTHLY",
  description: "Assinatura Scope System - Ronco Zero",
  dateCreated: "2026-06-09",
  deleted: true,
  status: "INACTIVE",
};

const cobrancaDaAssinatura = {
  id: "pay_7efd2640",
  customer: "cus_000178817351",
  subscription: "sub_t93165njb2srsqo5",
  value: 449,
  netValue: 449,
  status: "RECEIVED",
  dueDate: "2026-08-10",
  paymentDate: "2026-08-11",
  billingType: "CREDIT_CARD",
  description: "Assinatura Scope System - Ronco Zero",
};

const comoCliente = (banco: BancoFake) => banco as unknown as SupabaseClient;

describe("L-163 — assinatura excluída no gateway", () => {
  it("a listagem de assinaturas pede `includeDeleted` — a pergunta, não a conta", async () => {
    respostas.set("/subscriptions", pagina([]));
    const banco = novoBanco({ assinaturas: [], clientes: [] });

    await backfillAssinaturas(comoCliente(banco));

    // ⚠️ Esta asserção parece burocrática e é a única que pega o defeito: uma
    // listagem sem o parâmetro responde 200, com dados de verdade, e é
    // indistinguível de uma completa até alguém somar as duas fontes.
    expect(chamadas.some((c) => c.includes("includeDeleted=true"))).toBe(true);
  });

  it("assinatura `INACTIVE` entra como Cancelada, e não como ausente", async () => {
    respostas.set("/subscriptions", pagina([assinaturaExcluida]));
    const banco = novoBanco({
      assinaturas: [],
      clientes: [{ id: "cli-1", asaas_customer_id: "cus_000178817351" }],
    });

    const r = await backfillAssinaturas(comoCliente(banco));

    expect(r.criados).toBe(1);
    const gravada = banco.tabelas.get("assinaturas")?.[0];
    expect(gravada?.asaas_subscription_id).toBe("sub_t93165njb2srsqo5");
    // ⚖️ `Cancelada` é o que faz isto ser seguro: `calcularMrr` só soma
    // `Ativa`, então trazer 26 assinaturas mortas não move nenhum número
    // exibido — só devolve a chave às cobranças delas.
    expect(gravada?.status).toBe("Cancelada");
    expect(gravada?.cliente_id).toBe("cli-1");
  });

  it("a cobrança da assinatura excluída recebe `assinatura_id`", async () => {
    respostas.set("/payments", pagina([cobrancaDaAssinatura]));
    const banco = novoBanco({
      contas_receber: [],
      clientes: [{ id: "cli-1", asaas_customer_id: "cus_000178817351" }],
      assinaturas: [
        {
          id: "assin-1",
          asaas_subscription_id: "sub_t93165njb2srsqo5",
          status: "Cancelada",
        },
      ],
    });

    const r = await backfillCobrancas(comoCliente(banco));

    expect(r.conflitos).toEqual([]);
    const linha = banco.tabelas.get("contas_receber")?.[0];
    expect(linha?.assinatura_id).toBe("assin-1");
    expect(linha?.cliente_id).toBe("cli-1");
  });

  it("cobrança que NOMEIA assinatura ausente vira conflito — e entra assim mesmo", async () => {
    respostas.set("/payments", pagina([cobrancaDaAssinatura]));
    const banco = novoBanco({
      contas_receber: [],
      clientes: [{ id: "cli-1", asaas_customer_id: "cus_000178817351" }],
      assinaturas: [],
    });

    const r = await backfillCobrancas(comoCliente(banco));

    // ⛔ O silêncio era o defeito inteiro: `criados: 1, conflitos: []` com a
    // chave nula é indistinguível de uma importação correta.
    expect(r.conflitos).toHaveLength(1);
    expect(r.conflitos[0].asaas_id).toBe("pay_7efd2640");
    expect(r.conflitos[0].motivo).toContain("sub_t93165njb2srsqo5");

    // ⚖️ E a cobrança entra: ela é fato do gateway, e recusá-la trocaria uma
    // chave faltando por receita faltando.
    expect(r.criados).toBe(1);
    expect(banco.tabelas.get("contas_receber")?.[0]?.assinatura_id).toBeUndefined();
  });

  it("cobrança avulsa não gera conflito nenhum — ela não nomeia assinatura", async () => {
    respostas.set(
      "/payments",
      pagina([{ ...cobrancaDaAssinatura, id: "pay_avulsa", subscription: undefined }])
    );
    const banco = novoBanco({
      contas_receber: [],
      clientes: [{ id: "cli-1", asaas_customer_id: "cus_000178817351" }],
      assinaturas: [],
    });

    const r = await backfillCobrancas(comoCliente(banco));

    expect(r.conflitos).toEqual([]);
    expect(r.criados).toBe(1);
  });
});

describe("L-163 — a assinatura encerrada ganha data de fim", () => {
  /**
   * ⛔ **O Asaas não guarda data de cancelamento.** A assinatura excluída volta
   * com `deleted: true` e `endDate` no FUTURO — `endDate` é o fim previsto do
   * contrato, não o dia em que ela morreu (medido: `sub_t93165njb2srsqo5`,
   * excluída, com `endDate: 2027-06-10`). Usar `endDate` gravaria um
   * encerramento que ainda não aconteceu; deixar nulo faz a Dashboard carimbar
   * *"hoje"*, que é a data em que alguém olhou. As duas são falsas.
   *
   * ⚖️ A última cobrança **paga** é o único fato nosso sobre isso, e é a
   * fronteira certa: depois dela o cliente não pagou mais.
   */
  it("carimba `fim` com a data da última cobrança paga", async () => {
    const banco = novoBanco({
      clientes: [],
      assinaturas: [{ id: "assin-morta", status: "Cancelada", fim: null }],
      contas_receber: [
        { id: "c1", assinatura_id: "assin-morta", status: "Pago", pago_em: "2026-06-11" },
        { id: "c2", assinatura_id: "assin-morta", status: "Pago", pago_em: "2026-08-11" },
        // ⛔ Não paga não conta: ela não prova que o cliente ainda estava lá.
        { id: "c3", assinatura_id: "assin-morta", status: "Vencido", pago_em: "2026-09-11" },
      ],
    });

    const r = await religarOrfaos(comoCliente(banco));

    expect(r.datadas).toBe(1);
    expect(banco.tabelas.get("assinaturas")?.[0]?.fim).toBe("2026-08-11");
  });

  it("assinatura ATIVA não é datada — ela não acabou", async () => {
    const banco = novoBanco({
      clientes: [],
      assinaturas: [{ id: "assin-viva", status: "Ativa", fim: null }],
      contas_receber: [
        { id: "c1", assinatura_id: "assin-viva", status: "Pago", pago_em: "2026-08-11" },
      ],
    });

    const r = await religarOrfaos(comoCliente(banco));

    expect(r.datadas).toBe(0);
    expect(banco.tabelas.get("assinaturas")?.[0]?.fim).toBeNull();
  });

  it("encerrada SEM cobrança paga continua nula — inventar data é pior que a ausência", async () => {
    const banco = novoBanco({
      clientes: [],
      assinaturas: [{ id: "assin-vazia", status: "Cancelada", fim: null }],
      contas_receber: [],
    });

    const r = await religarOrfaos(comoCliente(banco));

    expect(r.datadas).toBe(0);
    expect(banco.tabelas.get("assinaturas")?.[0]?.fim).toBeNull();
  });

  it("`fim` já preenchido não é reescrito — a data de lá vence a derivada", async () => {
    const banco = novoBanco({
      clientes: [],
      assinaturas: [{ id: "assin-datada", status: "Cancelada", fim: "2026-01-31" }],
      contas_receber: [
        { id: "c1", assinatura_id: "assin-datada", status: "Pago", pago_em: "2026-08-11" },
      ],
    });

    const r = await religarOrfaos(comoCliente(banco));

    expect(r.datadas).toBe(0);
    expect(banco.tabelas.get("assinaturas")?.[0]?.fim).toBe("2026-01-31");
  });
});
