// Configuração central dos recursos expostos pela API CRUD genérica.
// Cada recurso mapeia para uma tabela e define as colunas graváveis,
// para que o back-end nunca grave campos arbitrários vindos do cliente.

export type ResourceName =
  | "clientes"
  | "bancos"
  | "cartoes"
  | "contratos"
  | "contrato_servicos"
  | "assinaturas"
  | "contas_receber"
  | "contas_pagar"
  | "lancamentos"
  | "notas_fiscais"
  | "retencoes_fiscais";

interface ResourceConfig {
  columns: string[]; // colunas graváveis (POST/PATCH)
  orderBy: string;
  ascending: boolean;
  numeric: string[]; // colunas decimais
  integer: string[]; // colunas inteiras
}

export const RESOURCES: Record<ResourceName, ResourceConfig> = {
  clientes: {
    // ⛔ `origem` e `sincronizado_em` ficam de fora: quem os grava é a
    // replicação com a Dashboard. Um formulário capaz de escrever "origem:
    // dashboard" apagaria a única marca de procedência que o cadastro tem.
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
    // ⛔ `servico` saiu das colunas graváveis em 31/08/2026, quando o contrato
    // passou a ter N serviços. Ele virou **resumo derivado** dos itens de
    // `contrato_servicos`, mantido por gatilho no banco — deixá-lo gravável
    // faria a tela reescrever, com um texto, o campo que agora responde pelos
    // itens. A escrita acontece em `contrato_servicos`, e o resumo segue.
    columns: ["cliente_id", "valor", "freq", "categoria", "inicio", "fim", "status", "obs"],
    orderBy: "created_at",
    ascending: false,
    numeric: ["valor"],
    integer: [],
  },
  // Os itens do contrato — `1:N`, decisão do dono de 31/08/2026.
  //
  // ⛔ `contrato_id` É gravável, ao contrário do que a intuição sugere: sem
  // ele não há como criar um item, e a regra *"todo serviço tem um contrato"*
  // é garantida pelo `not null` do banco, não por omitir a coluna aqui.
  contrato_servicos: {
    columns: ["contrato_id", "servico_id", "descricao", "quantidade", "valor", "recorrencia", "obs"],
    orderBy: "created_at",
    ascending: true,
    numeric: ["valor"],
    integer: ["quantidade"],
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
    // `valor_pago` e `deducoes` sustentam a base LÍQUIDA da comissão da
    // Dashboard (`RN-04`). São graváveis pela tela porque é lá que o dado
    // nasce — na baixa, quem confere o extrato.
    columns: [
      "cliente_id", "contrato_id", "assinatura_id", "descricao", "valor",
      "vencimento", "status", "forma_pagamento", "pago_em", "conta_id", "competencia", "asaas_payment_id",
      "valor_pago", "deducoes",
    ],
    orderBy: "vencimento",
    ascending: true,
    numeric: ["valor", "valor_pago", "deducoes"],
    integer: [],
  },
  contas_pagar: {
    // ⛔ `referencia_externa` NÃO entra aqui de propósito: é a chave de
    // idempotência que a Dashboard manda em `/api/integracao/contas-pagar`.
    // Editável pela tela, ela deixaria de garantir o que promete garantir.
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
  retencoes_fiscais: {
    // `RF-60`/`RN-43` — a alíquota é cadastro, e cadastro fiscal é DATADO.
    // ⛔ `criado_em` fica de fora: é carimbo do banco, e uma tela capaz de
    // reescrevê-lo apagaria a única marca de quando a regra foi declarada.
    columns: [
      "sigla", "nome", "percentual", "retido",
      "vigencia_inicio", "vigencia_fim", "municipio", "observacao", "ativo", "criado_por",
    ],
    // Mais recente primeiro: quem abre a tela quer ver a regra que vale hoje,
    // e o histórico logo abaixo dela.
    orderBy: "vigencia_inicio",
    ascending: false,
    numeric: ["percentual"],
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
