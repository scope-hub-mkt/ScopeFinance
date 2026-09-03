import { describe, it, expect } from "vitest";
import {
  recusaAoMexerEmRecebivel,
  origemDaEscrita,
} from "@/lib/dominio/recebivel-manual";

/**
 * `RN-53` / `D-100` / `D-101` — só a master mexe em recebível manual, e
 * ninguém mexe no do gateway.
 *
 * ⚖️ **Os dois sentidos, sempre.** Um teste que só prova a recusa passa
 * igualzinho se a guarda recusar TODO MUNDO — e aí o defeito é o oposto: a
 * master não consegue lançar nada e ninguém descobre até alguém tentar.
 */

const master = { master: true, papel: "admin" };
const admin = { master: false, papel: "admin" };
const leitura = { master: false, papel: "leitura" };

describe("RN-53 — quem mexe em recebível", () => {
  it("a master lança recebível manual", () => {
    expect(recusaAoMexerEmRecebivel(master, "manual")).toBeNull();
  });

  it("papel admin NÃO basta — é a metade que o D-101 acrescenta", () => {
    // No ScopeFinance `admin` já não mandava em credencial alheia (`D-96`).
    // A partir de `D-101` também não manda em receita: a instrução do dono é
    // que quem define valor pago é ele.
    const r = recusaAoMexerEmRecebivel(admin, "manual");
    expect(r).not.toBeNull();
    expect(r).toContain("administradora");
  });

  it("papel leitura também é recusado", () => {
    expect(recusaAoMexerEmRecebivel(leitura, "manual")).not.toBeNull();
  });

  it("nem a master edita linha do gateway", () => {
    // ⛔ Não é hierarquia, é natureza do dado: a linha do Asaas é espelho, e
    // a próxima varredura sobrescreveria a edição. Uma alteração que some
    // sozinha é pior que uma recusa.
    const r = recusaAoMexerEmRecebivel(master, "asaas");
    expect(r).not.toBeNull();
    expect(r).toContain("gateway");
  });

  it("credencial sem cadastro é recusada com o caminho, não com erro seco", () => {
    const r = recusaAoMexerEmRecebivel(null, "manual");
    expect(r).toContain("administradora");
  });
});

describe("origemDaEscrita — a origem vem da linha, não do pedido", () => {
  it("linha do gateway é reconhecida", () => {
    expect(origemDaEscrita({ origem_lancamento: "asaas" })).toBe("asaas");
  });

  it("linha manual é reconhecida", () => {
    expect(origemDaEscrita({ origem_lancamento: "manual" })).toBe("manual");
  });

  it("linha inexistente cai em manual, não em asaas", () => {
    // ⚖️ O default seguro é o mesmo do banco: o que não se prova ser do
    // gateway não é do gateway. Cair em "asaas" aqui deixaria uma linha
    // fantasma editável como se fosse espelho — e, pior, contável como
    // receita do gateway.
    expect(origemDaEscrita(null)).toBe("manual");
    expect(origemDaEscrita({})).toBe("manual");
  });
});
