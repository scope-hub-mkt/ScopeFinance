import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **O fiscal em N4 — `RF-60`, `RF-61`, `RN-43`, `PBI-054`.**
 *
 * ⚖️ **O defeito que estes casos existem para impedir não produz erro.** Uma
 * alíquota lida do ambiente devolve um número perfeitamente plausível; a nota
 * sai, o Asaas aceita, e nada na tela diz que agosto foi calculado com a regra
 * de setembro. É a família de `L-64` — falha atrás de indicador verde — com o
 * agravante de mexer em documento fiscal já emitido.
 *
 * Um bloco por cenário do Gherkin de `PBI-054`, mais as bordas que o Gherkin
 * não enuncia e o código precisou decidir.
 */

vi.mock("@/lib/supabase/admin", async () => {
  const { fakeAtual } = await import("./fakes/supabase-fake");
  return { createSupabaseAdmin: () => fakeAtual() };
});

import { novoBanco } from "./fakes/supabase-fake";
import {
  dataDoFatoGerador,
  lerConfigFiscal,
  listarRetencoes,
  retencaoVigente,
  retencoesVigentesEm,
  siglaEhConhecida,
  tributosDoAmbiente,
  tributosEm,
  type Retencao,
} from "@/lib/fiscal";

/** Uma retenção com o mínimo preenchido — o resto tem default sensato. */
function ret(over: Partial<Retencao> & { sigla: string; percentual: number }): Retencao {
  return {
    id: `${over.sigla}-${over.vigencia_inicio ?? "x"}`,
    nome: over.sigla,
    retido: false,
    vigencia_inicio: "2026-01-01",
    vigencia_fim: null,
    municipio: null,
    observacao: null,
    ativo: true,
    ...over,
  } as Retencao;
}

/** Ambiente com os `ASAAS_NF_*` preenchidos, para exercitar o fallback. */
const ENV_CHEIO = {
  ASAAS_NF_RETAIN_ISS: "true",
  ASAAS_NF_ISS: "2",
  ASAAS_NF_COFINS: "3",
  ASAAS_NF_CSLL: "1",
  ASAAS_NF_INSS: "0",
  ASAAS_NF_IR: "1.5",
  ASAAS_NF_PIS: "0.65",
};

describe("Cenário: cadastrar uma alíquota com vigência, pela tela", () => {
  beforeEach(() => {
    novoBanco({
      retencoes_fiscais: [
        {
          id: "r1",
          sigla: "ISS",
          nome: "ISS",
          percentual: 5,
          retido: true,
          vigencia_inicio: "2026-09-01",
          vigencia_fim: null,
          municipio: "Curitiba",
          observacao: null,
          ativo: true,
        },
      ],
    });
  });

  it("a retenção cadastrada é lida do banco, com a data junto", async () => {
    const todas = await listarRetencoes();
    expect(todas).toHaveLength(1);
    expect(todas[0]).toMatchObject({
      sigla: "ISS",
      percentual: 5,
      vigencia_inicio: "2026-09-01",
      retido: true,
    });
  });

  it("banco sem cadastro devolve lista vazia, não erro", async () => {
    novoBanco({ retencoes_fiscais: [] });
    await expect(listarRetencoes()).resolves.toEqual([]);
  });
});

describe("Cenário: a emissão lê a alíquota do FATO GERADOR, não a de hoje", () => {
  // O caso central da PBI: duas vigências da MESMA sigla, e a data decide.
  const retencoes = [
    ret({ sigla: "ISS", percentual: 3, vigencia_inicio: "2026-01-01", vigencia_fim: "2026-08-31" }),
    ret({ sigla: "ISS", percentual: 5, vigencia_inicio: "2026-09-01" }),
  ];

  it("nota sobre recebimento de AGOSTO usa 3%, ainda que hoje valha 5%", () => {
    const t = tributosEm(retencoes, "2026-08-15", ENV_CHEIO);
    expect(t.taxes.iss).toBe(3);
    expect(t.fonte).toBe("cadastro");
  });

  it("nota sobre recebimento de SETEMBRO usa 5%", () => {
    expect(tributosEm(retencoes, "2026-09-15", ENV_CHEIO).taxes.iss).toBe(5);
  });

  it("o primeiro dia da vigência JÁ vale — a borda é inclusiva", () => {
    expect(tributosEm(retencoes, "2026-09-01", ENV_CHEIO).taxes.iss).toBe(5);
  });

  it("o último dia da vigência anterior AINDA vale", () => {
    expect(tributosEm(retencoes, "2026-08-31", ENV_CHEIO).taxes.iss).toBe(3);
  });

  it("data anterior a QUALQUER vigência cai no ambiente, não na alíquota mais antiga", () => {
    // ⚖️ A alternativa — usar a mais antiga por não haver nada antes — inventaria
    // uma regra para um período em que a Scope não declarou nenhuma.
    const t = tributosEm(retencoes, "2025-12-31", ENV_CHEIO);
    expect(t.fonte).toBe("ambiente");
    expect(t.semRetencaoCadastrada).toBe(true);
  });
});

describe("Cenário: mudar a alíquota NÃO reescreve o passado", () => {
  it("cadastrar 5% em setembro deixa agosto valendo 3%", () => {
    const antes = [ret({ sigla: "ISS", percentual: 3, vigencia_inicio: "2026-01-01" })];
    const agostoAntes = tributosEm(antes, "2026-08-15", ENV_CHEIO).taxes.iss;

    // O manager cadastra a alíquota nova, com vigência — sem encerrar a antiga,
    // que é o esquecimento comum e o motivo de `retencaoVigente` desempatar.
    const depois = [...antes, ret({ sigla: "ISS", percentual: 5, vigencia_inicio: "2026-09-01" })];
    const agostoDepois = tributosEm(depois, "2026-08-15", ENV_CHEIO).taxes.iss;

    expect(agostoAntes).toBe(3);
    expect(agostoDepois).toBe(3);
    expect(tributosEm(depois, "2026-09-15", ENV_CHEIO).taxes.iss).toBe(5);
  });

  it("duas vigências abertas na mesma data: vence a de INÍCIO mais recente", () => {
    const ambiguas = [
      ret({ sigla: "ISS", percentual: 3, vigencia_inicio: "2026-01-01" }),
      ret({ sigla: "ISS", percentual: 5, vigencia_inicio: "2026-09-01" }),
    ];
    // A ordem da lista não pode decidir o imposto.
    expect(retencaoVigente(ambiguas, "ISS", "2026-10-01")?.percentual).toBe(5);
    expect(retencaoVigente([...ambiguas].reverse(), "ISS", "2026-10-01")?.percentual).toBe(5);
  });

  it("retenção inativa não vale, mesmo dentro da vigência", () => {
    const inativa = [ret({ sigla: "ISS", percentual: 9, ativo: false })];
    expect(tributosEm(inativa, "2026-06-01", ENV_CHEIO).fonte).toBe("ambiente");
  });
});

describe("Cenário: o código de serviço municipal é cadastro, não variável de ambiente", () => {
  it("lê o código cadastrado em config_fiscal", async () => {
    novoBanco({
      config_fiscal: [
        {
          id: 1,
          municipal_service_code: "1401",
          municipal_service_id: "id-1401",
          municipal_service_name: "Assessoria em marketing",
        },
      ],
    });
    await expect(lerConfigFiscal()).resolves.toMatchObject({
      municipal_service_code: "1401",
      municipal_service_name: "Assessoria em marketing",
    });
  });

  it("sem linha cadastrada devolve null — para o chamador cair no fallback", async () => {
    novoBanco({ config_fiscal: [] });
    await expect(lerConfigFiscal()).resolves.toBeNull();
  });
});

describe("Cenário: sem cadastro, o ambiente responde — e a fonte é DECLARADA", () => {
  it("nada cadastrado: usa ASAAS_NF_* e diz que a fonte é o ambiente", () => {
    const t = tributosEm([], "2026-08-15", ENV_CHEIO);
    expect(t.fonte).toBe("ambiente");
    expect(t.taxes).toEqual(tributosDoAmbiente(ENV_CHEIO));
    expect(t.taxes.iss).toBe(2);
    expect(t.taxes.retainIss).toBe(true);
  });

  it("com cadastro, o ambiente NÃO é mesclado — a origem fica reconstituível", () => {
    // ⚖️ Mesclar (ISS do cadastro, PIS do env) produziria uma nota cuja
    // procedência ninguém remonta depois. Cadastro presente = cadastro manda.
    const t = tributosEm([ret({ sigla: "ISS", percentual: 5 })], "2026-06-01", ENV_CHEIO);
    expect(t.fonte).toBe("cadastro");
    expect(t.taxes.iss).toBe(5);
    expect(t.taxes.pis).toBe(0); // e não 0.65 do ambiente
    expect(t.taxes.cofins).toBe(0); // idem
  });

  it("ambiente vazio devolve zeros, não NaN", () => {
    const t = tributosDoAmbiente({});
    expect(t).toEqual({
      retainIss: false,
      iss: 0,
      cofins: 0,
      csll: 0,
      inss: 0,
      ir: 0,
      pis: 0,
    });
  });
});

describe("Cenário: ausência de cadastro e alíquota zero são coisas diferentes", () => {
  it("0% CADASTRADO afirma: fonte=cadastro e semRetencaoCadastrada=false", () => {
    const t = tributosEm([ret({ sigla: "ISS", percentual: 0 })], "2026-06-01", ENV_CHEIO);
    expect(t.taxes.iss).toBe(0);
    expect(t.semRetencaoCadastrada).toBe(false);
    expect(t.fonte).toBe("cadastro");
    expect(t.aplicadas).toEqual([{ sigla: "ISS", percentual: 0, retido: false }]);
  });

  it("nada cadastrado se abstém: semRetencaoCadastrada=true e aplicadas vazio", () => {
    const t = tributosEm([], "2026-06-01", {});
    expect(t.taxes.iss).toBe(0);
    expect(t.semRetencaoCadastrada).toBe(true);
    expect(t.aplicadas).toEqual([]);
  });

  it("o zero e a ausência produzem o MESMO número e estados opostos", () => {
    const zero = tributosEm([ret({ sigla: "ISS", percentual: 0 })], "2026-06-01", {});
    const ausente = tributosEm([], "2026-06-01", {});
    expect(zero.taxes.iss).toBe(ausente.taxes.iss);
    expect(zero.semRetencaoCadastrada).not.toBe(ausente.semRetencaoCadastrada);
  });
});

describe("retainIss é datado junto com a alíquota", () => {
  it("a retenção na fonte segue a vigência, não o ambiente", () => {
    const rs = [
      ret({ sigla: "ISS", percentual: 3, retido: false, vigencia_inicio: "2026-01-01", vigencia_fim: "2026-08-31" }),
      ret({ sigla: "ISS", percentual: 3, retido: true, vigencia_inicio: "2026-09-01" }),
    ];
    expect(tributosEm(rs, "2026-08-15", ENV_CHEIO).taxes.retainIss).toBe(false);
    expect(tributosEm(rs, "2026-09-15", ENV_CHEIO).taxes.retainIss).toBe(true);
  });
});

describe("a data do fato gerador — pagamento, vencimento, hoje", () => {
  it("conta paga: manda o pago_em", () => {
    expect(dataDoFatoGerador({ pago_em: "2026-06-10", vencimento: "2026-06-05" }, "2026-08-27")).toBe(
      "2026-06-10"
    );
  });

  it("conta não paga: cai no vencimento", () => {
    expect(dataDoFatoGerador({ pago_em: null, vencimento: "2026-06-05" }, "2026-08-27")).toBe(
      "2026-06-05"
    );
  });

  it("nota avulsa, sem conta: hoje", () => {
    expect(dataDoFatoGerador(null, "2026-08-27")).toBe("2026-08-27");
  });

  it("conta sem data nenhuma: hoje, e não string vazia", () => {
    expect(dataDoFatoGerador({ pago_em: "", vencimento: null }, "2026-08-27")).toBe("2026-08-27");
  });
});

describe("bordas do recorte por vigência", () => {
  const rs = [
    ret({ sigla: "PIS", percentual: 0.65, vigencia_inicio: "2026-03-01", vigencia_fim: "2026-06-30" }),
  ];

  it("antes do início não vale", () => {
    expect(retencoesVigentesEm(rs, "2026-02-28")).toHaveLength(0);
  });

  it("depois do fim não vale", () => {
    expect(retencoesVigentesEm(rs, "2026-07-01")).toHaveLength(0);
  });

  it("vigência sem fim vale para sempre à frente", () => {
    const aberta = [ret({ sigla: "PIS", percentual: 0.65, vigencia_inicio: "2026-03-01" })];
    expect(retencoesVigentesEm(aberta, "2030-01-01")).toHaveLength(1);
  });
});

describe("a lista de siglas é uma trava, não documentação", () => {
  it("as seis que o Asaas aceita são conhecidas", () => {
    for (const s of ["ISS", "COFINS", "CSLL", "INSS", "IR", "PIS"]) {
      expect(siglaEhConhecida(s)).toBe(true);
    }
  });

  it("sigla inventada é recusada — cadastrar ICMS não vira tributo em silêncio", () => {
    expect(siglaEhConhecida("ICMS")).toBe(false);
    expect(siglaEhConhecida("")).toBe(false);
  });

  it("sigla cadastrada fora da lista NÃO entra nos tributos", () => {
    // ⚖️ Sem este caso, um erro de digitação no cadastro produziria uma
    // retenção que a tela mostra e a nota ignora — divergência silenciosa
    // entre o que o manager vê e o que o Asaas recebe.
    const t = tributosEm([ret({ sigla: "ICMS", percentual: 18 })], "2026-06-01", {});
    expect(t.aplicadas).toEqual([]);
    expect(Object.values(t.taxes).filter((v) => typeof v === "number" && v > 0)).toEqual([]);
  });
});
