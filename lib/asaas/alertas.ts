import { dinheiro } from "./webhook";

/**
 * A tradução de um evento P1/P2 no alerta que ele significa — Fase 7.
 *
 * ⚖️ **Por que estes eventos deixaram de ser `ignored`.** Os 54 P1/P2 vinham
 * sendo gravados desde o dia 1 e marcados como sem regra — o que era honesto
 * enquanto a regra não existia. Mas metade deles não é telemetria: chargeback
 * aberto, negativação, cartão recusado na captura, conta do gateway reprovada,
 * chave de API expirando. Deixá-los só na caixa de entrada significaria que a
 * única forma de descobrir um chargeback é alguém rodar um `select`.
 *
 * ⛔ **O que continua NÃO acontecendo, de propósito:** nenhum evento desta
 * lista mexe em dinheiro. Eles não baixam conta, não alteram valor e não mudam
 * `status`. Isso é dos P0 (§4.8, primeira onda), e continua sendo — um evento
 * de "disputa aberta" que mexesse na receita produziria número errado durante
 * a disputa e outro depois dela.
 *
 * Puro: nada aqui toca banco ou rede.
 */

export type CategoriaAlerta = "cobranca" | "fiscal" | "conta" | "seguranca";
export type SeveridadeAlerta = "critico" | "atencao";

export interface Alerta {
  categoria: CategoriaAlerta;
  severidade: SeveridadeAlerta;
  titulo: string;
  detalhe: string | null;
  valor: string | null;
}

interface Regra {
  categoria: CategoriaAlerta;
  severidade: SeveridadeAlerta;
  titulo: string;
}

/**
 * As regras, evento a evento.
 *
 * ⚖️ **`critico` significa "alguém perde dinheiro ou a operação para"** — não
 * "é chato". A distinção existe porque uma fila em que tudo é crítico é uma
 * fila sem prioridade, e o time aprende a ignorar o vermelho. Cinco categorias
 * de evento chegam a crítico e todas têm consequência imediata: dinheiro
 * saindo (chargeback, estorno negado), venda perdida (recusa de risco, captura
 * recusada), nota que não sai, saque bloqueado, integração que para.
 *
 * ⛔ Evento que **não** está aqui não vira alerta. Telemetria de engajamento
 * (`BANK_SLIP_VIEWED`, `CHECKOUT_VIEWED`) e split — que a Scope não usa —
 * continuam gravados e sem tela, que é o tratamento certo: gerar alerta para
 * "alguém abriu o boleto" treinaria o time a fechar a fila sem ler.
 */
export const REGRAS: Record<string, Regra> = {
  // ─── Cobranças que pedem decisão humana ─────────────────────────────
  PAYMENT_CHARGEBACK_REQUESTED: {
    categoria: "cobranca",
    severidade: "critico",
    titulo: "Chargeback aberto — o dinheiro pode voltar",
  },
  PAYMENT_CHARGEBACK_DISPUTE: {
    categoria: "cobranca",
    severidade: "critico",
    titulo: "Disputa de chargeback em andamento — há prazo para responder",
  },
  PAYMENT_AWAITING_CHARGEBACK_REVERSAL: {
    categoria: "cobranca",
    severidade: "atencao",
    titulo: "Disputa ganha; o saldo ainda não voltou",
  },
  PAYMENT_REPROVED_BY_RISK_ANALYSIS: {
    categoria: "cobranca",
    severidade: "critico",
    titulo: "Cobrança recusada pela análise de risco",
  },
  PAYMENT_CREDIT_CARD_CAPTURE_REFUSED: {
    categoria: "cobranca",
    severidade: "critico",
    titulo: "Captura no cartão recusada — a venda não se completou",
  },
  PAYMENT_REFUND_DENIED: {
    categoria: "cobranca",
    severidade: "critico",
    titulo: "Estorno negado — o cliente pediu e não recebeu",
  },
  PAYMENT_DUNNING_REQUESTED: {
    categoria: "cobranca",
    severidade: "atencao",
    titulo: "Negativação solicitada",
  },
  PAYMENT_DUNNING_RECEIVED: {
    categoria: "cobranca",
    severidade: "atencao",
    titulo: "Retorno de negativação",
  },
  PAYMENT_BANK_SLIP_CANCELLED: {
    categoria: "cobranca",
    severidade: "atencao",
    titulo: "Boleto cancelado — o cliente precisa de nova via",
  },
  PAYMENT_AWAITING_RISK_ANALYSIS: {
    categoria: "cobranca",
    severidade: "atencao",
    titulo: "Cobrança em análise de risco",
  },
  PAYMENT_REFUND_IN_PROGRESS: {
    categoria: "cobranca",
    severidade: "atencao",
    titulo: "Estorno em andamento",
  },
  PAYMENT_AUTHORIZED: {
    categoria: "cobranca",
    severidade: "atencao",
    titulo: "Cartão autorizado, aguardando captura",
  },

  // ─── Fiscal ─────────────────────────────────────────────────────────
  INVOICE_CANCELLATION_DENIED: {
    categoria: "fiscal",
    severidade: "critico",
    titulo: "Cancelamento de nota NEGADO — a nota continua valendo",
  },
  INVOICE_PROCESSING_CANCELLATION: {
    categoria: "fiscal",
    severidade: "atencao",
    titulo: "Cancelamento de nota em processamento",
  },

  // ─── Checkout ───────────────────────────────────────────────────────
  CHECKOUT_EXPIRED: {
    categoria: "cobranca",
    severidade: "atencao",
    titulo: "Link de pagamento expirou sem conversão",
  },
  CHECKOUT_CANCELED: {
    categoria: "cobranca",
    severidade: "atencao",
    titulo: "Link de pagamento cancelado",
  },

  // ─── Situação da conta (P2) ─────────────────────────────────────────
  //
  // ⚠️ Os "REJECTED" e o "EXPIRED" são críticos porque **param a operação**:
  // conta bancária rejeitada bloqueia saque, aprovação geral rejeitada para
  // tudo, e informação comercial expirada impede novas cobranças.
  ACCOUNT_STATUS_BANK_ACCOUNT_INFO_REJECTED: {
    categoria: "conta",
    severidade: "critico",
    titulo: "Conta bancária REJEITADA no Asaas — saques bloqueados",
  },
  ACCOUNT_STATUS_GENERAL_APPROVAL_REJECTED: {
    categoria: "conta",
    severidade: "critico",
    titulo: "Aprovação geral da conta REJEITADA — a operação para",
  },
  ACCOUNT_STATUS_COMMERCIAL_INFO_REJECTED: {
    categoria: "conta",
    severidade: "critico",
    titulo: "Informação comercial REJEITADA no Asaas",
  },
  ACCOUNT_STATUS_DOCUMENT_REJECTED: {
    categoria: "conta",
    severidade: "critico",
    titulo: "Documento REJEITADO no Asaas",
  },
  ACCOUNT_STATUS_COMMERCIAL_INFO_EXPIRED: {
    categoria: "conta",
    severidade: "critico",
    titulo: "Informação comercial EXPIRADA no Asaas",
  },
  ACCOUNT_STATUS_COMMERCIAL_INFO_EXPIRING_SOON: {
    categoria: "conta",
    severidade: "atencao",
    titulo: "Informação comercial do Asaas expira em breve",
  },

  // ─── Chaves de API (P2) ─────────────────────────────────────────────
  //
  // ⚖️ Estes são de **segurança**, e a categoria importa: uma chave criada que
  // ninguém reconhece é incidente, não manutenção.
  ACCESS_TOKEN_EXPIRED: {
    categoria: "seguranca",
    severidade: "critico",
    titulo: "Chave de API do Asaas EXPIROU — a integração de saída parou",
  },
  ACCESS_TOKEN_DISABLED: {
    categoria: "seguranca",
    severidade: "critico",
    titulo: "Chave de API do Asaas DESABILITADA",
  },
  ACCESS_TOKEN_EXPIRING_SOON: {
    categoria: "seguranca",
    severidade: "atencao",
    titulo: "Chave de API do Asaas expira em breve — renove",
  },
  ACCESS_TOKEN_CREATED: {
    categoria: "seguranca",
    severidade: "atencao",
    titulo: "Chave de API criada no Asaas — confirme que foi você",
  },
  ACCESS_TOKEN_DELETED: {
    categoria: "seguranca",
    severidade: "atencao",
    titulo: "Chave de API removida no Asaas",
  },
};

/**
 * O alerta que um evento significa, ou `null` quando ele não pede ninguém.
 *
 * ⛔ `null` é a resposta certa para telemetria e para split (que a Scope não
 * usa). O evento continua **gravado** na caixa de entrada — só não vira fila.
 */
export function alertaDoEvento(
  event: string,
  objeto: Record<string, unknown> | null
): Alerta | null {
  const regra = REGRAS[event];
  if (!regra) return null;

  const o = objeto ?? {};
  const partes: string[] = [];

  const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

  const descricao = texto(o.description) ?? texto(o.serviceDescription);
  if (descricao) partes.push(descricao);

  const status = texto(o.status);
  if (status) partes.push(`status no Asaas: ${status}`);

  // O motivo, quando o Asaas o manda. É a diferença entre "recusado" e
  // "recusado porque o cartão não tem limite" — e é a segunda que diz o que
  // fazer a respeito.
  const motivo =
    texto(o.refusalReason) ??
    texto(o.chargeback && (o.chargeback as Record<string, unknown>).reason) ??
    texto(o.denialReason) ??
    texto(o.cancellationReason);
  if (motivo) partes.push(`motivo: ${motivo}`);

  const vencimento = texto(o.dueDate);
  if (vencimento) partes.push(`vencimento ${vencimento}`);

  return {
    categoria: regra.categoria,
    severidade: regra.severidade,
    titulo: regra.titulo,
    detalhe: partes.length ? partes.join(" · ") : null,
    // `value` para cobrança, `netValue` quando é o que importa. Sem valor, o
    // alerta ainda vale — só não dá para ordenar por quanto custa.
    valor: dinheiro(o.value ?? o.netValue ?? null),
  };
}
