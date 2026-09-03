import { describe, it, expect, beforeEach, vi } from "vitest";
import { novoBanco } from "./fakes/supabase-fake";

/**
 * `RF-94` / `RN-51` / `D-99` — só o que nasceu no gateway atravessa a ponte.
 *
 * ⚖️ **Por que o teste é de ROTA, e não das funções de cálculo.**
 * `calcularResumo` e `calcularSerie` recebem as linhas já filtradas: elas
 * somam o que lhes derem, e somariam recebível manual sem reclamar. O filtro
 * mora na consulta, então é a consulta que precisa ser exercitada — testar a
 * função pura aqui daria verde sobre um sistema quebrado.
 *
 * A fixture é sempre **mista**: um recebível do gateway e um manual, os dois
 * baixados, com valores diferentes o bastante para que a soma denuncie qual
 * entrou.
 */

vi.mock("@/lib/supabase/admin", async () => {
  const { fakeAtual: f } = await import("./fakes/supabase-fake");
  return { createSupabaseAdmin: () => f() };
});

const CHAVE = "chave-de-teste";

vi.mock("@/lib/integracao/config", () => ({
  estadoIntegracao: () => ({ apiKey: CHAVE }),
}));

const autorizado = (url: string) =>
  new Request(url, { headers: { authorization: `Bearer ${CHAVE}` } });

/** Um do gateway (R$ 1.000) e um digitado à mão (R$ 7.777), ambos pagos. */
function bancoMisto() {
  novoBanco({
    contas_receber: [
      {
        id: "cr-asaas",
        cliente_id: "cli-1",
        contrato_id: null,
        descricao: "Mensalidade",
        valor: 1000,
        valor_pago: 1000,
        deducoes: 0,
        vencimento: "2026-09-01",
        pago_em: "2026-09-02",
        status: "Pago",
        origem_lancamento: "asaas",
        asaas_payment_id: "pay_1",
        tipo_venda: "assinatura",
      },
      {
        id: "cr-manual",
        cliente_id: "cli-1",
        contrato_id: null,
        descricao: "Ajuste lançado à mão",
        valor: 7777,
        valor_pago: 7777,
        deducoes: 0,
        vencimento: "2026-09-01",
        pago_em: "2026-09-02",
        status: "Pago",
        origem_lancamento: "manual",
        asaas_payment_id: null,
        tipo_venda: null,
      },
    ],
    assinaturas: [],
    clientes: [{ id: "cli-1", nome: "Cliente", status: "Ativo", status_cadastro: "efetivo" }],
  });
}

beforeEach(() => bancoMisto());

describe("RF-94 — a ponte entrega só o gateway", () => {
  it("pagamentos-recebidos ignora o manual", async () => {
    const { GET } = await import("@/app/api/integracao/pagamentos-recebidos/route");
    const r = await GET(
      autorizado("http://x/api/integracao/pagamentos-recebidos?desde=2026-01-01")
    );
    const corpo = await r.json();

    expect(r.status).toBe(200);
    const refs = (corpo as { referencia: string }[]).map((p) => p.referencia);
    expect(refs).toContain("cr-asaas");
    // ⛔ A asserção que importa: o manual **não** pode estar aqui. Se
    // estivesse, a Dashboard calcularia comissão sobre dinheiro que o
    // gateway nunca confirmou.
    expect(refs).not.toContain("cr-manual");
  });

  it("vendas ignora o manual", async () => {
    const { GET } = await import("@/app/api/integracao/vendas/route");
    const r = await GET(autorizado("http://x/api/integracao/vendas"));
    const corpo = (await r.json()) as { venda_id: string; fonte: string }[];

    expect(r.status).toBe(200);
    expect(corpo.map((v) => v.venda_id)).toEqual(["cr-asaas"]);
    // `RNF-19` — todo número declara de onde veio.
    expect(corpo[0].fonte).toBeTruthy();
  });

  it("o resumo não soma os R$ 7.777 digitados à mão", async () => {
    const { GET } = await import("@/app/api/integracao/resumo/route");
    const r = await GET(autorizado("http://x/api/integracao/resumo"));
    const corpo = (await r.json()) as Record<string, number | string>;

    expect(r.status).toBe(200);
    // O valor manual é escolhido para ser inconfundível: se qualquer total
    // encostar em 7777 ou 8777, o filtro furou.
    const numeros = Object.values(corpo).filter((v) => typeof v === "number") as number[];
    expect(numeros).not.toContain(7777);
    expect(numeros).not.toContain(8777);
  });

  it("a série mensal também não soma o manual", async () => {
    const { GET } = await import("@/app/api/integracao/serie-mensal/route");
    const r = await GET(autorizado("http://x/api/integracao/serie-mensal?meses=12"));
    const corpo = (await r.json()) as { periodo: string; faturamento: number; recebido: number }[];

    expect(r.status).toBe(200);
    const total = corpo.reduce((s, p) => s + Number(p.recebido || 0), 0);
    expect(total).not.toBe(8777);
    expect(total).toBeLessThan(7777);
  });

  it("sem chave, nenhuma delas responde dado", async () => {
    // A guarda continua sendo a de sempre; o filtro de origem não a
    // substitui. Recusar sem chave é o que impede a ponte de virar leitura
    // pública do financeiro.
    const { GET } = await import("@/app/api/integracao/resumo/route");
    const r = await GET(new Request("http://x/api/integracao/resumo"));
    expect(r.status).toBeGreaterThanOrEqual(400);
  });
});
