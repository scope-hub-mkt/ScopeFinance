import { describe, expect, it } from "vitest";
import { BancoFake } from "./fakes/supabase-fake";
import type { SupabaseClient } from "@supabase/supabase-js";
import { gerarRecorrencias } from "@/lib/recorrencia";
import {
  CICLOS_EMBUTIDOS,
  avancar,
  lerCiclos,
  mensalizar,
  resolverCiclo,
  ultimoDiaDoMes,
} from "@/lib/ciclos";

/**
 * `RF-63` — ciclos de recorrência cadastráveis. Fecha `C-4` da régua.
 *
 * ─── O que estes casos protegem ──────────────────────────────────────────
 * Um erro aqui **não aparece na tela**: aparece no extrato do cliente, um
 * mês depois, como cobrança que ninguém emitiu ou como competência pulada.
 * É o mesmo argumento que abriu `recorrencia.test.ts`.
 *
 * ⛔ **O caso de 31 de janeiro é o mais importante do arquivo**, e é uma
 * correção de comportamento, não uma feature: `Date.setMonth(+1)` sobre
 * 31/jan produzia **3 de março**, pulando fevereiro inteiro. Uma assinatura
 * mensal vencendo no dia 31 deixava de ser cobrada em ~5 competências por
 * ano. A suíte já registrava o número errado num caso cujo TÍTULO afirmava o
 * certo — *"31 de janeiro + 1 mês não vira 3 de março"* — e cuja asserção
 * exigia `2026-03-03`. O título estava certo desde o começo.
 */

let banco: BancoFake;

function novoBanco(seed: Record<string, Record<string, unknown>[]> = {}) {
  banco = new BancoFake(seed, {
    contas_receber: {
      unicos: [{ colunas: ["assinatura_id", "competencia"], nome: "contas_receber_assinatura_id_competencia_key" }],
      defaults: { status: "Pendente", deducoes: 0 },
    },
    contas_pagar: {
      unicos: [{ colunas: ["assinatura_id", "competencia"], nome: "contas_pagar_assinatura_id_competencia_key" }],
      defaults: { status: "Pendente" },
    },
  });
  return banco as unknown as SupabaseClient;
}

const MENSAL = { meses: 1, regra_vencimento: "mesmo-dia" as const, dia: null };

describe("avancar — a regra de vencimento", () => {
  it("mesmo-dia mantém o dia quando o mês destino comporta", () => {
    expect(avancar("2026-01-15", MENSAL)).toBe("2026-02-15");
    expect(avancar("2026-01-15", { ...MENSAL, meses: 3 })).toBe("2026-04-15");
    expect(avancar("2026-01-15", { ...MENSAL, meses: 12 })).toBe("2027-01-15");
  });

  it("31 de janeiro + 1 mês NÃO vira 3 de março — vira 28 de fevereiro", () => {
    // O defeito corrigido. Antes: 2026-03-03, e fevereiro nunca era cobrado.
    expect(avancar("2026-01-31", MENSAL)).toBe("2026-02-28");
  });

  it("respeita ano bissexto sem tabela de bissexto", () => {
    expect(avancar("2024-01-31", MENSAL)).toBe("2024-02-29");
    expect(ultimoDiaDoMes(2024, 1)).toBe(29);
    expect(ultimoDiaDoMes(2026, 1)).toBe(28);
  });

  it("meses que cruzam o ano viram o ano certo", () => {
    expect(avancar("2026-11-10", { ...MENSAL, meses: 3 })).toBe("2027-02-10");
    expect(avancar("2026-12-31", MENSAL)).toBe("2027-01-31");
    expect(avancar("2026-07-15", { ...MENSAL, meses: 18 })).toBe("2028-01-15");
  });

  it("dia-fixo joga para o dia cadastrado — e limita em fevereiro", () => {
    const diaFixo = { meses: 1, regra_vencimento: "dia-fixo" as const, dia: 5 };
    expect(avancar("2026-01-20", diaFixo)).toBe("2026-02-05");
    // 31 cadastrado é aceito e LIMITADO: nunca transborda para o mês seguinte.
    expect(avancar("2026-01-20", { ...diaFixo, dia: 31 })).toBe("2026-02-28");
  });

  it("ultimo-dia cai sempre no fim do mês destino", () => {
    const ultimo = { meses: 1, regra_vencimento: "ultimo-dia" as const, dia: null };
    expect(avancar("2026-01-15", ultimo)).toBe("2026-02-28");
    expect(avancar("2026-03-15", ultimo)).toBe("2026-04-30");
    expect(avancar("2026-04-15", ultimo)).toBe("2026-05-31");
  });

  it("é puro em UTC — não escorrega um dia conforme o fuso do servidor", () => {
    // `new Date(iso + "T00:00:00")` lê no fuso local; a oeste de Greenwich
    // isso voltava um dia, e a conta nascia vencida na véspera.
    expect(avancar("2026-03-01", MENSAL)).toBe("2026-04-01");
    expect(avancar("2026-01-01", MENSAL)).toBe("2026-02-01");
  });

  it("data inválida estoura em vez de gerar cobrança numa data inventada", () => {
    expect(() => avancar("nao-e-data", MENSAL)).toThrow(/inválida/);
  });
});

describe("resolverCiclo e mensalizar", () => {
  it("chave desconhecida cai em mensal — errado e VISÍVEL, nunca silencioso", () => {
    // Parar de gerar conta seria pior: ninguém percebe uma cobrança ausente.
    expect(resolverCiclo("bienal-inventado", CICLOS_EMBUTIDOS).chave).toBe("mensal");
    expect(resolverCiclo(null, CICLOS_EMBUTIDOS).chave).toBe("mensal");
  });

  it("mensaliza pelo número de meses, não por uma lista de chaves", () => {
    expect(mensalizar(1200, { meses: 12 })).toBe(100);
    expect(mensalizar(300, { meses: 3 })).toBe(100);
    expect(mensalizar(600, { meses: 6 })).toBe(100);
    expect(mensalizar(100, { meses: 1 })).toBe(100);
  });
});

describe("lerCiclos — cadastro SOBREPÕE embutido, e nunca some", () => {
  it("sem tabela e sem cadastro, os três embutidos valem", async () => {
    const ciclos = await lerCiclos(novoBanco());
    expect(ciclos.map((c) => c.chave).sort()).toEqual(["anual", "mensal", "trimestral"]);
    expect(ciclos.every((c) => c.embutido)).toBe(true);
  });

  it("um ciclo novo entra sem apagar os embutidos", async () => {
    const ciclos = await lerCiclos(
      novoBanco({
        ciclos_recorrencia: [
          { chave: "semestral", nome: "Semestral", meses: 6, regra_vencimento: "mesmo-dia", dia: null, ativo: true },
        ],
      })
    );
    expect(ciclos.map((c) => c.chave).sort()).toEqual(["anual", "mensal", "semestral", "trimestral"]);
    expect(resolverCiclo("semestral", ciclos).meses).toBe(6);
    expect(resolverCiclo("semestral", ciclos).embutido).toBe(false);
  });

  it("cadastrar a MESMA chave substitui o embutido — não mescla", async () => {
    const ciclos = await lerCiclos(
      novoBanco({
        ciclos_recorrencia: [
          { chave: "mensal", nome: "Mensal (dia 5)", meses: 1, regra_vencimento: "dia-fixo", dia: 5, ativo: true },
        ],
      })
    );
    // Uma linha só, e é a cadastrada. Duas seria ciclo indeterminado.
    expect(ciclos.filter((c) => c.chave === "mensal")).toHaveLength(1);
    const mensal = resolverCiclo("mensal", ciclos);
    expect(mensal.regra_vencimento).toBe("dia-fixo");
    expect(mensal.dia).toBe(5);
    expect(mensal.embutido).toBe(false);
  });

  it("ciclo inativo não é lido", async () => {
    const ciclos = await lerCiclos(
      novoBanco({
        ciclos_recorrencia: [
          { chave: "semestral", nome: "Semestral", meses: 6, regra_vencimento: "mesmo-dia", dia: null, ativo: false },
        ],
      })
    );
    expect(ciclos.find((c) => c.chave === "semestral")).toBeUndefined();
  });
});

describe("gerarRecorrencias com ciclo CADASTRADO — o fim da edição de código", () => {
  it("um semestral cadastrado gera cobrança de 6 em 6 meses", async () => {
    const supabase = novoBanco({
      ciclos_recorrencia: [
        { chave: "semestral", nome: "Semestral", meses: 6, regra_vencimento: "mesmo-dia", dia: null, ativo: true },
      ],
      clientes: [{ id: "c1", nome: "Cliente" }],
      assinaturas: [
        {
          id: "a1",
          status: "Ativa",
          direcao: "receber",
          cliente_id: "c1",
          valor: 600,
          ciclo: "semestral",
          proximo_venc: "2026-01-10",
        },
      ],
    });

    const r = await gerarRecorrencias(supabase, "2026-08-01");

    // 10/jan e 10/jul entraram; 10/jan/2027 ainda não venceu.
    expect(r.geradas).toBe(2);
    expect(r.detalhes.map((d) => d.competencia)).toEqual(["2026-01-01", "2026-07-01"]);
    const [assinatura] = banco.tabela("assinaturas");
    expect(assinatura.proximo_venc).toBe("2027-01-10");
  });

  it("MUTAÇÃO: sem o cadastro, o MESMO semestral é cobrado todo mês", async () => {
    // Este caso é o que prova que o cadastro está sendo LIDO. Sem ele, o
    // teste acima passaria com um `meses: 6` escrito em qualquer lugar.
    const supabase = novoBanco({
      clientes: [{ id: "c1", nome: "Cliente" }],
      assinaturas: [
        {
          id: "a1",
          status: "Ativa",
          direcao: "receber",
          cliente_id: "c1",
          valor: 600,
          ciclo: "semestral",
          proximo_venc: "2026-01-10",
        },
      ],
    });

    const r = await gerarRecorrencias(supabase, "2026-08-01");
    // Cai no fallback mensal: jan a jul (10/ago ainda não venceu em 01/ago)
    // — 7 competências em vez de 2.
    expect(r.geradas).toBe(7);
  });

  it("dia-fixo cadastrado move o vencimento, e fevereiro não é pulado", async () => {
    const supabase = novoBanco({
      ciclos_recorrencia: [
        { chave: "mensal", nome: "Mensal dia 31", meses: 1, regra_vencimento: "dia-fixo", dia: 31, ativo: true },
      ],
      clientes: [{ id: "c1", nome: "Cliente" }],
      assinaturas: [
        {
          id: "a1",
          status: "Ativa",
          direcao: "receber",
          cliente_id: "c1",
          valor: 100,
          ciclo: "mensal",
          proximo_venc: "2026-01-31",
        },
      ],
    });

    const r = await gerarRecorrencias(supabase, "2026-04-15");

    // ⛔ Com o comportamento antigo, fevereiro NÃO aparecia nesta lista:
    // 31/jan saltava direto para 03/mar. Abril fica de fora porque o
    // vencimento seguinte é 30/04, depois da data de referência.
    expect(r.detalhes.map((d) => d.competencia)).toEqual([
      "2026-01-01",
      "2026-02-01",
      "2026-03-01",
    ]);
    const [assinatura] = banco.tabela("assinaturas");
    expect(assinatura.proximo_venc).toBe("2026-04-30");
  });

  it("a idempotência continua de pé com ciclo cadastrado", async () => {
    const seed = {
      ciclos_recorrencia: [
        { chave: "semestral", nome: "Semestral", meses: 6, regra_vencimento: "mesmo-dia", dia: null, ativo: true },
      ],
      clientes: [{ id: "c1", nome: "Cliente" }],
      assinaturas: [
        {
          id: "a1",
          status: "Ativa",
          direcao: "receber",
          cliente_id: "c1",
          valor: 600,
          ciclo: "semestral",
          proximo_venc: "2026-01-10",
        },
      ],
    };
    const supabase = novoBanco(seed);
    await gerarRecorrencias(supabase, "2026-08-01");
    const depois = await gerarRecorrencias(supabase, "2026-08-01");

    // `UNIQUE(assinatura_id, competencia)` segura a segunda rodada.
    expect(depois.geradas).toBe(0);
    expect(banco.tabela("contas_receber")).toHaveLength(2);
  });
});
