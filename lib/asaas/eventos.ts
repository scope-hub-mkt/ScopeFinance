/**
 * O catálogo dos 73 eventos do Asaas — prioridade, entidade e webhook.
 *
 * Fonte: `spec-scope/webhook-asaas/asaas-eventos.json`, transcrito aqui para
 * que o código não dependa de um arquivo que não está neste repositório.
 *
 * ⚖️ **Por que um catálogo e não um `switch` no handler.** Três perguntas
 * diferentes são feitas sobre um evento em três momentos distintos: *"que
 * objeto vem no payload?"* (na hora de gravar), *"isto altera dinheiro?"*
 * (na hora de decidir a onda de implementação) e *"este evento pertence ao
 * webhook de negócio ou ao operacional?"* (na hora de configurar o painel).
 * Espalhar as três por um `switch` faria a resposta de cada uma envelhecer
 * separadamente.
 *
 * ⛔ **Evento fora desta tabela NÃO é erro.** O Asaas adiciona tipos novos sem
 * aviso; quem não conhece o tipo grava com `process_status = 'ignored'` e
 * responde `200`. Um parser que trata desconhecido como falha funciona hoje e
 * derruba a fila no próximo release deles — `RN-AS-04`, 15 falhas, `RN-AS-05`,
 * 14 dias.
 *
 * Puro de propósito: nada aqui toca banco, rede ou `process.env`.
 */

/** P0 altera dado financeiro · P1 muda status ou pede humano · P2 é telemetria. */
export type Prioridade = "P0" | "P1" | "P2";

/** A chave sob a qual o objeto vem no corpo do evento. */
export type EntidadeAsaas =
  | "payment"
  | "subscription"
  | "invoice"
  | "checkout"
  | "accountStatus"
  | "token";

/**
 * Qual dos dois webhooks entrega este evento.
 *
 * ⛔ **O ganho da separação, dito sem rodeio:** com um webhook só, se o
 * handler de `ACCESS_TOKEN_EXPIRING_SOON` quebrar 15 vezes, você **para de
 * receber pagamento junto**. Monitoramento não pode ter poder de derrubar a
 * fila que carrega o financeiro.
 */
export type WebhookAsaas = "negocio" | "operacional";

export interface DefinicaoEvento {
  entidade: EntidadeAsaas;
  prioridade: Prioridade;
  webhook: WebhookAsaas;
}

const P = (prioridade: Prioridade): DefinicaoEvento => ({
  entidade: "payment",
  prioridade,
  webhook: "negocio",
});
const S = (prioridade: Prioridade): DefinicaoEvento => ({
  entidade: "subscription",
  prioridade,
  webhook: "negocio",
});
const I = (prioridade: Prioridade): DefinicaoEvento => ({
  entidade: "invoice",
  prioridade,
  webhook: "negocio",
});
const C = (prioridade: Prioridade): DefinicaoEvento => ({
  entidade: "checkout",
  prioridade,
  webhook: "negocio",
});
const A: DefinicaoEvento = { entidade: "accountStatus", prioridade: "P2", webhook: "operacional" };
const T: DefinicaoEvento = { entidade: "token", prioridade: "P2", webhook: "operacional" };

export const CATALOGO: Record<string, DefinicaoEvento> = {
  // ─── Cobranças (30) — Vendas (Avulsas/Contratos) + Contas a receber ──
  PAYMENT_CREATED: P("P0"),
  PAYMENT_UPDATED: P("P0"),
  PAYMENT_CONFIRMED: P("P0"),
  PAYMENT_RECEIVED: P("P0"),
  PAYMENT_ANTICIPATED: P("P0"),
  PAYMENT_OVERDUE: P("P0"),
  PAYMENT_DELETED: P("P0"),
  PAYMENT_RESTORED: P("P0"),
  PAYMENT_REFUNDED: P("P0"),
  PAYMENT_PARTIALLY_REFUNDED: P("P0"),
  PAYMENT_RECEIVED_IN_CASH_UNDONE: P("P0"),
  PAYMENT_AUTHORIZED: P("P1"),
  PAYMENT_AWAITING_RISK_ANALYSIS: P("P1"),
  PAYMENT_APPROVED_BY_RISK_ANALYSIS: P("P1"),
  PAYMENT_REPROVED_BY_RISK_ANALYSIS: P("P1"),
  PAYMENT_REFUND_IN_PROGRESS: P("P1"),
  PAYMENT_REFUND_DENIED: P("P1"),
  PAYMENT_CHARGEBACK_REQUESTED: P("P1"),
  PAYMENT_CHARGEBACK_DISPUTE: P("P1"),
  PAYMENT_AWAITING_CHARGEBACK_REVERSAL: P("P1"),
  PAYMENT_DUNNING_RECEIVED: P("P1"),
  PAYMENT_DUNNING_REQUESTED: P("P1"),
  PAYMENT_BANK_SLIP_CANCELLED: P("P1"),
  PAYMENT_CREDIT_CARD_CAPTURE_REFUSED: P("P1"),
  PAYMENT_BANK_SLIP_VIEWED: P("P2"),
  PAYMENT_CHECKOUT_VIEWED: P("P2"),
  PAYMENT_SPLIT_CANCELLED: P("P2"),
  PAYMENT_SPLIT_DIVERGENCE_BLOCK: P("P2"),
  PAYMENT_SPLIT_DIVERGENCE_BLOCK_FINISHED: P("P2"),
  PAYMENT_SPLIT_DONE: P("P2"),

  // ─── Assinaturas (7) — Vendas > Assinaturas ─────────────────────────
  SUBSCRIPTION_CREATED: S("P0"),
  SUBSCRIPTION_UPDATED: S("P0"),
  SUBSCRIPTION_INACTIVATED: S("P0"),
  SUBSCRIPTION_DELETED: S("P0"),
  SUBSCRIPTION_SPLIT_DISABLED: S("P2"),
  SUBSCRIPTION_SPLIT_DIVERGENCE_BLOCK: S("P2"),
  SUBSCRIPTION_SPLIT_DIVERGENCE_BLOCK_FINISHED: S("P2"),

  // ─── Notas fiscais (8) — Fiscal > Notas fiscais ─────────────────────
  INVOICE_AUTHORIZED: I("P0"),
  INVOICE_CANCELED: I("P0"),
  INVOICE_ERROR: I("P0"),
  INVOICE_CREATED: I("P1"),
  INVOICE_UPDATED: I("P1"),
  INVOICE_SYNCHRONIZED: I("P1"),
  INVOICE_PROCESSING_CANCELLATION: I("P1"),
  INVOICE_CANCELLATION_DENIED: I("P1"),

  // ─── Checkouts (4) — funil de conversão do link ─────────────────────
  CHECKOUT_PAID: C("P0"),
  CHECKOUT_CREATED: C("P1"),
  CHECKOUT_CANCELED: C("P1"),
  CHECKOUT_EXPIRED: C("P1"),

  // ─── Situação da conta (18) — Sistema > alertas operacionais ────────
  ACCOUNT_STATUS_BANK_ACCOUNT_INFO_APPROVED: A,
  ACCOUNT_STATUS_BANK_ACCOUNT_INFO_AWAITING_APPROVAL: A,
  ACCOUNT_STATUS_BANK_ACCOUNT_INFO_PENDING: A,
  ACCOUNT_STATUS_BANK_ACCOUNT_INFO_REJECTED: A,
  ACCOUNT_STATUS_COMMERCIAL_INFO_APPROVED: A,
  ACCOUNT_STATUS_COMMERCIAL_INFO_AWAITING_APPROVAL: A,
  ACCOUNT_STATUS_COMMERCIAL_INFO_EXPIRED: A,
  ACCOUNT_STATUS_COMMERCIAL_INFO_EXPIRING_SOON: A,
  ACCOUNT_STATUS_COMMERCIAL_INFO_PENDING: A,
  ACCOUNT_STATUS_COMMERCIAL_INFO_REJECTED: A,
  ACCOUNT_STATUS_DOCUMENT_APPROVED: A,
  ACCOUNT_STATUS_DOCUMENT_AWAITING_APPROVAL: A,
  ACCOUNT_STATUS_DOCUMENT_PENDING: A,
  ACCOUNT_STATUS_DOCUMENT_REJECTED: A,
  ACCOUNT_STATUS_GENERAL_APPROVAL_APPROVED: A,
  ACCOUNT_STATUS_GENERAL_APPROVAL_AWAITING_APPROVAL: A,
  ACCOUNT_STATUS_GENERAL_APPROVAL_PENDING: A,
  ACCOUNT_STATUS_GENERAL_APPROVAL_REJECTED: A,

  // ─── Chaves de API (6) — Sistema > alertas de segurança ─────────────
  ACCESS_TOKEN_CREATED: T,
  ACCESS_TOKEN_DELETED: T,
  ACCESS_TOKEN_DISABLED: T,
  ACCESS_TOKEN_ENABLED: T,
  ACCESS_TOKEN_EXPIRED: T,
  ACCESS_TOKEN_EXPIRING_SOON: T,
};

/**
 * Os eventos que o webhook de **negócio** deve assinar no painel do Asaas.
 *
 * Exportado porque o painel é preenchido à mão e a lista tem 49 itens: quem
 * a digitar de memória vai errar, e o erro é silencioso — um evento não
 * assinado simplesmente nunca chega, e nada fica vermelho.
 */
export const EVENTOS_NEGOCIO = Object.keys(CATALOGO).filter(
  (e) => CATALOGO[e].webhook === "negocio"
);

/** Os eventos do webhook **operacional** — monitoramento, não dado de negócio. */
export const EVENTOS_OPERACIONAL = Object.keys(CATALOGO).filter(
  (e) => CATALOGO[e].webhook === "operacional"
);

/**
 * Os P0 — a primeira onda do §4.8, os únicos com regra de negócio escrita.
 *
 * ⛔ Isto **não** é a lista do que se grava. Todo evento é gravado desde o dia
 * 1, inclusive os das ondas 2 e 3: gravar é `insert`, processar é outra coisa.
 * Evento não gravado está perdido; evento gravado e não processado espera.
 */
export const EVENTOS_P0 = Object.keys(CATALOGO).filter((e) => CATALOGO[e].prioridade === "P0");

/** A definição de um evento, ou `null` quando é tipo que ainda não conhecemos. */
export function definicaoDoEvento(event: string | null | undefined): DefinicaoEvento | null {
  if (!event) return null;
  return CATALOGO[event] ?? null;
}

/**
 * A entidade de um evento desconhecido, deduzida do prefixo.
 *
 * ⚖️ Existe para que um `PAYMENT_ALGO_QUE_NAO_EXISTIA_ONTEM` ainda caia em
 * `entity_type = 'payment'` e apareça na consulta por cobrança, em vez de
 * virar uma linha órfã que só um `select *` encontra.
 */
export function entidadePorPrefixo(event: string): EntidadeAsaas | null {
  if (event.startsWith("PAYMENT_")) return "payment";
  if (event.startsWith("SUBSCRIPTION_")) return "subscription";
  if (event.startsWith("INVOICE_")) return "invoice";
  if (event.startsWith("CHECKOUT_")) return "checkout";
  if (event.startsWith("ACCOUNT_STATUS_")) return "accountStatus";
  if (event.startsWith("ACCESS_TOKEN_")) return "token";
  return null;
}
