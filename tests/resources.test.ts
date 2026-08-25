import { describe, expect, it } from "vitest";
import { isResource, RESOURCES, sanitizeInput } from "@/lib/resources";

/**
 * A lista branca de colunas graváveis — a única barreira entre o corpo de uma
 * requisição e o banco. O CRUD é genérico de propósito; é esta função que
 * impede que "genérico" signifique "escreve qualquer coisa".
 */

describe("sanitizeInput", () => {
  it("descarta coluna que não está na lista branca", () => {
    const r = sanitizeInput("clientes", { nome: "Acme", id: "forjado", created_at: "1999-01-01" });
    expect(r).toEqual({ nome: "Acme" });
  });

  it("string vazia vira null, não string vazia no banco", () => {
    expect(sanitizeInput("clientes", { doc: "" })).toEqual({ doc: null });
  });

  it("coluna ausente não é tocada — PATCH parcial continua parcial", () => {
    // Se ausente virasse null, editar só o telefone apagaria o e-mail.
    expect(sanitizeInput("clientes", { tel: "9999" })).toEqual({ tel: "9999" });
  });

  it("numérico vindo como string do formulário é coagido", () => {
    expect(sanitizeInput("contas_receber", { valor: "1500.50" })).toEqual({ valor: 1500.5 });
  });

  it("numérico inválido vira 0, não NaN — NaN quebraria o insert", () => {
    expect(sanitizeInput("contas_receber", { valor: "abc" })).toEqual({ valor: 0 });
  });

  it("inteiro inválido vira null", () => {
    expect(sanitizeInput("cartoes", { fechamento: "xx" })).toEqual({ fechamento: null });
  });

  it("valor_pago e deducoes são graváveis e numéricos — a base da comissão", () => {
    expect(sanitizeInput("contas_receber", { valor_pago: "940", deducoes: "56.40" })).toEqual({
      valor_pago: 940,
      deducoes: 56.4,
    });
  });
});

describe("colunas deliberadamente NÃO graváveis pela tela", () => {
  it("⛔ referencia_externa não entra por contas_pagar", () => {
    // É a chave de idempotência que a Dashboard manda ao lançar comissão.
    // Editável pela tela, ela deixaria de garantir o que promete garantir.
    expect(RESOURCES.contas_pagar.columns).not.toContain("referencia_externa");
    expect(sanitizeInput("contas_pagar", { referencia_externa: "com_1", descricao: "x" })).toEqual({
      descricao: "x",
    });
  });

  it("⛔ origem do cliente não entra pelo formulário", () => {
    // Um formulário capaz de escrever "origem: dashboard" apagaria a única
    // marca de procedência que o cadastro tem.
    expect(RESOURCES.clientes.columns).not.toContain("origem");
    expect(sanitizeInput("clientes", { origem: "dashboard", nome: "Falso" })).toEqual({
      nome: "Falso",
    });
  });

  it("⛔ sincronizado_em também não", () => {
    expect(sanitizeInput("clientes", { sincronizado_em: "2020-01-01" })).toEqual({});
  });
});

describe("isResource", () => {
  it("reconhece as 9 tabelas e recusa o resto", () => {
    expect(Object.keys(RESOURCES)).toHaveLength(9);
    expect(isResource("clientes")).toBe(true);
    // `integracao` tem rotas ESTÁTICAS que precedem o CRUD genérico; se um dia
    // alguém a tornar recurso, a chave de integração viraria CRUD irrestrito.
    expect(isResource("integracao")).toBe(false);
    expect(isResource("integracao_recebidos")).toBe(false);
    expect(isResource("integracao_enviados")).toBe(false);
    expect(isResource("pg_catalog")).toBe(false);
  });

  it("não é enganado por propriedade herdada de Object", () => {
    expect(isResource("constructor")).toBe(false);
    expect(isResource("toString")).toBe(false);
  });
});
