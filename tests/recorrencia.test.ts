import { beforeEach, describe, expect, it } from "vitest";
import { BancoFake } from "./fakes/supabase-fake";
import { gerarRecorrencias } from "@/lib/recorrencia";
import { advanceByCiclo, competencia, monthlyValue } from "@/lib/format";

/**
 * O motor de recorrência — o coração do ScopeFinance, e até 25/08/2026 sem
 * uma linha de teste.
 *
 * É ele que transforma assinatura em conta a receber/pagar todo mês. Um bug
 * aqui não aparece na tela: aparece no extrato, um mês depois, como cobrança
 * duplicada ou como cobrança que ninguém emitiu.
 */

let banco: BancoFake;

function novoBanco(seed: Record<string, Record<string, unknown>[]> = {}) {
  banco = new BancoFake(seed, {
    // A constraint real que torna o motor idempotente.
    contas_receber: {
      unicos: [{ colunas: ["assinatura_id", "competencia"], nome: "contas_receber_assinatura_id_competencia_key" }],
      defaults: { status: "Pendente", deducoes: 0 },
    },
    contas_pagar: {
      unicos: [{ colunas: ["assinatura_id", "competencia"], nome: "contas_pagar_assinatura_id_competencia_key" }],
      defaults: { status: "Pendente" },
    },
  });
  return banco;
}

const assinatura = (over: Record<string, unknown> = {}) => ({
  id: "as-1",
  direcao: "receber",
  cliente_id: "cli-1",
  fornecedor: null,
  descricao: "CRM Pro",
  plano: "Pro",
  categoria: null,
  valor: 500,
  ciclo: "mensal",
  inicio: "2026-01-01",
  proximo_venc: "2026-08-01",
  fim: null,
  conta_id: "bco-1",
  status: "Ativa",
  ...over,
});

beforeEach(() => novoBanco());

describe("gerarRecorrencias", () => {
  it("assinatura a receber vencida gera conta a receber e avança o vencimento", async () => {
    novoBanco({ assinaturas: [assinatura()] });
    const r = await gerarRecorrencias(banco as never, "2026-08-15");

    expect(r).toMatchObject({ geradas: 1, receber: 1, pagar: 0 });
    expect(banco.tabela("contas_receber")[0]).toMatchObject({
      cliente_id: "cli-1",
      assinatura_id: "as-1",
      valor: 500,
      vencimento: "2026-08-01",
      competencia: "2026-08-01",
      status: "Pendente",
    });
    expect(banco.tabela("assinaturas")[0].proximo_venc).toBe("2026-09-01");
  });

  it("assinatura a pagar gera conta a PAGAR, não a receber", async () => {
    novoBanco({
      assinaturas: [
        assinatura({ direcao: "pagar", cliente_id: null, fornecedor: "Vercel", categoria: "Infraestrutura" }),
      ],
    });
    const r = await gerarRecorrencias(banco as never, "2026-08-15");

    expect(r).toMatchObject({ geradas: 1, receber: 0, pagar: 1 });
    expect(banco.tabela("contas_receber")).toHaveLength(0);
    expect(banco.tabela("contas_pagar")[0]).toMatchObject({
      fornecedor: "Vercel",
      categoria: "Infraestrutura",
    });
  });

  it("é IDEMPOTENTE: rodar duas vezes não duplica a cobrança do mesmo ciclo", async () => {
    // A garantia inteira mora na constraint UNIQUE(assinatura_id, competencia).
    // Sem este teste, quebrá-la não faria nenhum sinal aparecer.
    novoBanco({ assinaturas: [assinatura()] });
    await gerarRecorrencias(banco as never, "2026-08-15");
    banco.tabela("assinaturas")[0].proximo_venc = "2026-08-01"; // simula rerun do mesmo dia
    const r2 = await gerarRecorrencias(banco as never, "2026-08-15");

    expect(r2.geradas).toBe(0);
    expect(banco.tabela("contas_receber")).toHaveLength(1);
  });

  it("assinatura atrasada gera TODAS as competências pendentes, não só a última", async () => {
    novoBanco({ assinaturas: [assinatura({ proximo_venc: "2026-06-01" })] });
    const r = await gerarRecorrencias(banco as never, "2026-08-15");

    expect(r.geradas).toBe(3);
    expect(banco.tabela("contas_receber").map((c) => c.competencia)).toEqual([
      "2026-06-01",
      "2026-07-01",
      "2026-08-01",
    ]);
    expect(banco.tabela("assinaturas")[0].proximo_venc).toBe("2026-09-01");
  });

  it("respeita o ciclo trimestral", async () => {
    novoBanco({ assinaturas: [assinatura({ ciclo: "trimestral", proximo_venc: "2026-02-01" })] });
    const r = await gerarRecorrencias(banco as never, "2026-08-15");
    expect(r.geradas).toBe(3); // fev, mai, ago
    expect(banco.tabela("assinaturas")[0].proximo_venc).toBe("2026-11-01");
  });

  it("assinatura suspensa ou cancelada não gera nada", async () => {
    novoBanco({
      assinaturas: [
        assinatura({ id: "a", status: "Suspensa" }),
        assinatura({ id: "b", status: "Cancelada" }),
      ],
    });
    expect((await gerarRecorrencias(banco as never, "2026-08-15")).geradas).toBe(0);
  });

  it("assinatura com vencimento futuro não gera nada", async () => {
    novoBanco({ assinaturas: [assinatura({ proximo_venc: "2026-12-01" })] });
    expect((await gerarRecorrencias(banco as never, "2026-08-15")).geradas).toBe(0);
  });

  it("para no `fim` da assinatura — não cobra depois do término", async () => {
    novoBanco({
      assinaturas: [assinatura({ proximo_venc: "2026-06-01", fim: "2026-07-15" })],
    });
    const r = await gerarRecorrencias(banco as never, "2026-08-15");
    expect(r.geradas).toBe(2); // junho e julho; agosto já passou do fim
    expect(banco.tabela("contas_receber").map((c) => c.competencia)).toEqual([
      "2026-06-01",
      "2026-07-01",
    ]);
  });

  it("assinatura antiquíssima não roda para sempre — a trava de 60 ciclos segura", async () => {
    // Sem MAX_CICLOS, uma assinatura de 2015 esquecida geraria centenas de
    // cobranças numa única execução do cron.
    novoBanco({ assinaturas: [assinatura({ proximo_venc: "2015-01-01" })] });
    const r = await gerarRecorrencias(banco as never, "2026-08-15");
    expect(r.geradas).toBe(60);
  });

  it("sem assinatura ativa, devolve resultado zerado sem tocar em nada", async () => {
    const r = await gerarRecorrencias(banco as never, "2026-08-15");
    expect(r).toEqual({ geradas: 0, receber: 0, pagar: 0, detalhes: [] });
  });

  it("assinatura sem descrição ainda gera conta com texto útil", async () => {
    novoBanco({ assinaturas: [assinatura({ descricao: null, plano: "Business" })] });
    await gerarRecorrencias(banco as never, "2026-08-15");
    expect(banco.tabela("contas_receber")[0].descricao).toBe("Assinatura Business");
  });
});

describe("helpers de data — a aritmética que o motor usa", () => {
  it("avança pelo ciclo", () => {
    expect(advanceByCiclo("2026-01-15", "mensal")).toBe("2026-02-15");
    expect(advanceByCiclo("2026-01-15", "trimestral")).toBe("2026-04-15");
    expect(advanceByCiclo("2026-01-15", "anual")).toBe("2027-01-15");
  });

  it("31 de janeiro + 1 mês não vira 3 de março", () => {
    // ♻️ 27/08/2026, `RF-63`: este caso mudou de asserção, não de título.
    //
    // O título sempre afirmou o comportamento CERTO; a asserção exigia
    // `2026-03-03` e um comentário explicava que documentar o defeito valia
    // mais que fingir que ele não existia. Valia — até haver como consertá-lo.
    //
    // ⛔ O defeito não era estético: `Date.setMonth(+1)` sobre 31/jan pula
    // fevereiro INTEIRO, e uma assinatura mensal vencendo no dia 31 deixava
    // de ser cobrada em ~5 competências por ano. `avancar()` limita o dia ao
    // último do mês destino.
    const r = advanceByCiclo("2026-01-31", "mensal");
    expect(r).toBe("2026-02-28");
  });

  it("competência é sempre o dia 1 do mês", () => {
    expect(competencia("2026-08-17")).toBe("2026-08-01");
  });

  it("monthlyValue normaliza o ciclo", () => {
    expect(monthlyValue(1200, "anual")).toBe(100);
    expect(monthlyValue(300, "trimestral")).toBe(100);
    expect(monthlyValue(100, "mensal")).toBe(100);
  });
});
