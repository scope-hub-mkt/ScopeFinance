// Tipos das linhas do banco (espelham supabase/schema.sql)

export interface Cliente {
  id: string;
  nome: string;
  tipo: string;
  doc: string | null;
  email: string | null;
  tel: string | null;
  status: string;
  endereco: string | null;
  obs: string | null;
  asaas_customer_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Banco {
  id: string;
  nome: string;
  banco: string | null;
  tipo: string;
  saldo: number;
  created_at: string;
  updated_at: string;
}

export interface Cartao {
  id: string;
  nome: string;
  bandeira: string | null;
  limite: number;
  usado: number;
  fechamento: number | null;
  vencimento: number | null;
  created_at: string;
  updated_at: string;
}

export interface Contrato {
  id: string;
  cliente_id: string | null;
  servico: string;
  valor: number;
  freq: string;
  categoria: string | null;
  inicio: string | null;
  fim: string | null;
  status: string;
  obs: string | null;
  created_at: string;
  updated_at: string;
}

export type Direcao = "receber" | "pagar";
export type Ciclo = "mensal" | "trimestral" | "anual";

export interface Assinatura {
  id: string;
  direcao: Direcao;
  cliente_id: string | null;
  fornecedor: string | null;
  descricao: string | null;
  plano: string | null;
  categoria: string | null;
  valor: number;
  ciclo: Ciclo;
  dia_venc: number | null;
  inicio: string;
  proximo_venc: string | null;
  fim: string | null;
  conta_id: string | null;
  status: string;
  asaas_subscription_id: string | null;
  obs: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContaReceber {
  id: string;
  cliente_id: string | null;
  contrato_id: string | null;
  assinatura_id: string | null;
  descricao: string;
  valor: number;
  vencimento: string | null;
  status: string;
  forma_pagamento: string | null;
  pago_em: string | null;
  conta_id: string | null;
  competencia: string | null;
  asaas_payment_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContaPagar {
  id: string;
  fornecedor: string;
  assinatura_id: string | null;
  descricao: string;
  valor: number;
  vencimento: string | null;
  categoria: string | null;
  status: string;
  pago_em: string | null;
  conta_id: string | null;
  competencia: string | null;
  created_at: string;
  updated_at: string;
}

export interface Lancamento {
  id: string;
  tipo: "entrada" | "saida";
  descricao: string;
  valor: number;
  data: string;
  categoria: string | null;
  conta_id: string | null;
  origem: string;
  origem_id: string | null;
  created_at: string;
}

export interface NotaFiscal {
  id: string;
  cliente_id: string | null;
  conta_receber_id: string | null;
  descricao_servico: string | null;
  valor: number;
  status: string;
  asaas_invoice_id: string | null;
  numero: string | null;
  data_emissao: string | null;
  pdf_url: string | null;
  xml_url: string | null;
  payload: unknown;
  erro: string | null;
  created_at: string;
  updated_at: string;
}
