import { describe, expect, it } from "vitest";
import { apurarCarga, resumoDeFalhas } from "@/lib/carga";

const ok = <T>(value: T): PromiseSettledResult<T> => ({ status: "fulfilled", value });
const nok = (msg: string): PromiseSettledResult<never> => ({
  status: "rejected",
  reason: new Error(msg),
});

describe("apurarCarga", () => {
  it("tudo respondeu: nada de falha, nada de queda", () => {
    const r = apurarCarga(["clientes", "bancos"], [ok([1]), ok([2])]);
    expect(r.dados).toEqual([
      ["clientes", [1]],
      ["bancos", [2]],
    ]);
    expect(r.falhas).toEqual([]);
    expect(r.queda).toBe(false);
  });

  it("o incidente de 27/08/2026: 1 de 10 falha e os 9 continuam entrando", () => {
    // Era exatamente esta forma que o Promise.all descartava — as nove
    // respostas boas iam para o lixo junto com a décima.
    const chaves = [
      "clientes", "contratos", "assinaturas", "contas_receber", "contas_pagar",
      "lancamentos", "bancos", "cartoes", "notas_fiscais", "retencoes_fiscais",
    ];
    const resultados = [
      ...chaves.slice(0, 9).map(() => ok([])),
      nok("Could not find the table 'public.retencoes_fiscais' in the schema cache"),
    ];
    const r = apurarCarga(chaves, resultados);
    expect(r.dados).toHaveLength(9);
    expect(r.dados.map(([k]) => k)).not.toContain("retencoes_fiscais");
    expect(r.falhas).toEqual([
      {
        recurso: "retencoes_fiscais",
        motivo: "Could not find the table 'public.retencoes_fiscais' in the schema cache",
      },
    ]);
    // Nove telas inteiras dependiam disto ser `false`.
    expect(r.queda).toBe(false);
  });

  it("ninguém respondeu: aí é queda", () => {
    const r = apurarCarga(["clientes", "bancos"], [nok("rede"), nok("rede")]);
    expect(r.dados).toEqual([]);
    expect(r.queda).toBe(true);
  });

  it("lista vazia não é queda — não havia nada a carregar", () => {
    expect(apurarCarga([], []).queda).toBe(false);
  });

  it("um recurso só, e ele falhou: queda (é o caso do refresh pontual)", () => {
    // `refresh("clientes")` depois de um POST precisa PROPAGAR o erro, senão
    // a tela diz "salvo" sobre uma lista que não recarregou.
    expect(apurarCarga(["clientes"], [nok("500")]).queda).toBe(true);
  });

  it("rejeição que não é Error não vira 'undefined' na tela", () => {
    const r = apurarCarga(["clientes"], [{ status: "rejected", reason: "texto solto" }]);
    expect(r.falhas[0].motivo).toBe("Erro desconhecido");
  });
});

describe("resumoDeFalhas", () => {
  it("sem falha, sem frase", () => {
    expect(resumoDeFalhas([])).toBe("");
  });

  it("nomeia o recurso e afirma que o resto está bom", () => {
    const f = resumoDeFalhas([{ recurso: "retencoes_fiscais", motivo: "500" }]);
    expect(f).toContain("retencoes_fiscais");
    expect(f).toContain("O resto da tela está atualizado");
    expect(f).toContain("500");
  });

  it("mais de um: conta e lista os dois", () => {
    const f = resumoDeFalhas([
      { recurso: "cartoes", motivo: "500" },
      { recurso: "bancos", motivo: "500" },
    ]);
    expect(f).toContain("2 recursos");
    expect(f).toContain("cartoes, bancos");
  });

  it("motivo repetido aparece uma vez — a frase informa, não ecoa", () => {
    const f = resumoDeFalhas([
      { recurso: "cartoes", motivo: "timeout" },
      { recurso: "bancos", motivo: "timeout" },
    ]);
    expect(f.match(/timeout/g)).toHaveLength(1);
  });
});
