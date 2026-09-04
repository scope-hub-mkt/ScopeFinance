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
  /** 'scopefinance' = nasceu aqui · 'dashboard' = chegou pela replicação. */
  origem: string;
  sincronizado_em: string | null;
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

export interface Contrato {
  id: string;
  /**
   * ⚖️ **Nunca nulo desde 31/08/2026** — *"cada contrato deve ter um
   * cliente"*. O `not null` está no banco; o tipo aqui apenas para de mentir
   * sobre o que o banco garante.
   */
  cliente_id: string;
  /**
   * ⛔ **DERIVADO — não escreva.** Resumo dos itens de `contrato_servicos`,
   * mantido por gatilho no Postgres desde 31/08/2026. A fonte do que foi
   * contratado é a lista de itens; esta coluna existe para que quem só quer
   * uma linha de texto (a ponte, um relatório) continue tendo uma que
   * corresponde à verdade.
   */
  servico: string;
  /**
   * O valor **acordado** do contrato — é dele que a cobrança sai.
   *
   * ⚠️ Não é a soma dos itens, e pode divergir dela. A divergência é
   * declarada na tela (`vw_contrato_servicos_totais`), nunca corrigida por
   * conta própria: mexer em dinheiro já contratado é o que `RN-01` proíbe.
   */
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

/**
 * Um serviço dentro de um contrato — a ligação `1:N` decidida pelo dono em
 * 31/08/2026.
 *
 * ⚖️ *"um contrato pode ter N serviços e um serviço deve possuir um
 * contrato"*. O `contrato_id` obrigatório é essa segunda metade: item não
 * existe solto, e a exclusão do contrato leva os itens junto (`cascade`).
 */
export interface ContratoServico {
  id: string;
  contrato_id: string;
  /**
   * O item do catálogo (`servicos_espelho`), quando existe um que corresponda.
   *
   * ⛔ Nulo é caso legítimo, não pendência: escopo fechado sob medida é
   * faturável e não é item de catálogo. A tela mostra quantos itens estão sem
   * vínculo para que a escolha seja de quem vendeu, não do código.
   */
  servico_id: string | null;
  /** O nome como estava **na venda** — renomear o catálogo não reescreve isto. */
  descricao: string;
  quantidade: number;
  valor: number;
  /** Nulo = herda a frequência do contrato. */
  recorrencia: string | null;
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
  /** O que entrou de fato. Null = ninguém informou; vale o `valor` cobrado. */
  valor_pago: number | null;
  /** Tributos e taxas retidos — a base da comissão é `valor_pago - deducoes`. */
  deducoes: number;
  conta_id: string | null;
  competencia: string | null;
  asaas_payment_id: string | null;
  /**
   * De onde a linha nasceu — `RF-93` / `RN-52` / `D-100`.
   *
   * ⛔ **`'manual'` é o default do banco, e o tipo não o torna opcional de
   * propósito.** Toda linha tem origem; o que não existe é linha sem ela. A
   * ponte para a Dashboard entrega só `'asaas'` (`RF-94`), então tratar este
   * campo como possivelmente ausente convidaria a um `?? "asaas"` em algum
   * filtro — e o valor omitido cairia para o lado errado.
   *
   * ⚠️ Não está em `resources.contas_receber.columns`: a tela não grava esta
   * coluna nem por engano. Quem marca `'asaas'` é `linhaDaCobranca`, a
   * tradução que webhook e backfill compartilham.
   */
  origem_lancamento: "asaas" | "manual";
  created_at: string;
  updated_at: string;
}

export interface ContaPagar {
  id: string;
  fornecedor: string;
  /** Id do fato na origem (ex.: comissao_id da Dashboard) — único, idempotência. */
  referencia_externa?: string | null;
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

/**
 * Uma retenção fiscal cadastrada — `RF-60`, `RN-43`.
 *
 * ⚖️ A vigência é o que separa **corrigir** de **versionar**: sem ela, mudar a
 * alíquota reescreve nota já emitida. Ver `lib/fiscal.ts`.
 */
export interface RetencaoFiscal {
  id: string;
  sigla: string;
  nome: string;
  percentual: number;
  retido: boolean;
  vigencia_inicio: string;
  vigencia_fim: string | null;
  municipio: string | null;
  observacao: string | null;
  ativo: boolean;
  criado_por: string | null;
  criado_em?: string;
}
