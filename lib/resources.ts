// Configuração central dos recursos expostos pela API CRUD genérica.
// Cada recurso mapeia para uma tabela e define as colunas graváveis,
// para que o back-end nunca grave campos arbitrários vindos do cliente.

export type ResourceName =
  | "clientes"
  | "bancos"
  | "cartoes"
  | "contratos"
  | "assinaturas"
  | "contas_receber"
  | "contas_pagar"
  | "lancamentos"
  | "notas_fiscais";

interface ResourceConfig {
  columns: string[]; // colunas graváveis (POST/PATCH)
  orderBy: string;
  ascending: boolean;
  numeric: string[]; // colunas decimais
  integer: string[]; // colunas inteiras
}

export const RESOURCES: Record<ResourceName, ResourceConfig> = {
  clientes: {
    columns: ["nome", "tipo", "doc", "email", "tel", "status", "endereco", "obs", "asaas_customer_id"],
    orderBy: "nome",
    ascending: true,
    numeric: [],
    integer: [],
  },
  bancos: {
    columns: ["nome", "banco", "tipo", "saldo"],
    orderBy: "nome",
    ascending: true,
    numeric: ["saldo"],
    integer: [],
  },
  cartoes: {
    columns: ["nome", "bandeira", "limite", "usado", "fechamento", "vencimento"],
    orderBy: "nome",
    ascending: true,
    numeric: ["limite", "usado"],
    integer: ["fechamento", "vencimento"],
  },
  contratos: {
    columns: ["cliente_id", "servico", "valor", "freq", "categoria", "inicio", "fim", "status", "obs"],
    orderBy: "created_at",
    ascending: false,
    numeric: ["valor"],
    integer: [],
  },
  assinaturas: {
    columns: [
      "direcao", "cliente_id", "fornecedor", "descricao", "plano", "categoria",
      "valor", "ciclo", "dia_venc", "inicio", "proximo_venc", "fim", "conta_id", "status",
      "asaas_subscription_id", "obs",
    ],
    orderBy: "created_at",
    ascending: false,
    numeric: ["valor"],
    integer: ["dia_venc"],
  },
  contas_receber: {
    columns: [
      "cliente_id", "contrato_id", "assinatura_id", "descricao", "valor",
      "vencimento", "status", "forma_pagamento", "pago_em", "conta_id", "competencia", "asaas_payment_id",
    ],
    orderBy: "vencimento",
    ascending: true,
    numeric: ["valor"],
    integer: [],
  },
  contas_pagar: {
    columns: [
      "fornecedor", "assinatura_id", "descricao", "valor", "vencimento",
      "categoria", "status", "pago_em", "conta_id", "competencia",
    ],
    orderBy: "vencimento",
    ascending: true,
    numeric: ["valor"],
    integer: [],
  },
  lancamentos: {
    columns: ["tipo", "descricao", "valor", "data", "categoria", "conta_id", "origem", "origem_id"],
    orderBy: "data",
    ascending: false,
    numeric: ["valor"],
    integer: [],
  },
  notas_fiscais: {
    columns: [
      "cliente_id", "conta_receber_id", "descricao_servico", "valor", "status",
      "asaas_invoice_id", "numero", "data_emissao", "pdf_url", "xml_url", "payload", "erro",
    ],
    orderBy: "created_at",
    ascending: false,
    numeric: ["valor"],
    integer: [],
  },
};

export function isResource(name: string): name is ResourceName {
  return Object.prototype.hasOwnProperty.call(RESOURCES, name);
}

/**
 * Filtra o corpo da requisição para conter apenas colunas permitidas,
 * convertendo "" -> null e coagindo números/inteiros.
 */
export function sanitizeInput(
  resource: ResourceName,
  body: Record<string, unknown>
): Record<string, unknown> {
  const cfg = RESOURCES[resource];
  const out: Record<string, unknown> = {};
  for (const col of cfg.columns) {
    if (!(col in body)) continue;
    let v = body[col];
    if (v === "" || v === undefined) {
      v = null;
    } else if (cfg.numeric.includes(col)) {
      v = v === null ? null : Number(v);
      if (Number.isNaN(v)) v = 0;
    } else if (cfg.integer.includes(col)) {
      v = v === null ? null : parseInt(String(v), 10);
      if (Number.isNaN(v)) v = null;
    }
    out[col] = v;
  }
  return out;
}
