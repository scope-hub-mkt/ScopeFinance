import "server-only";
import { buscarUm, listarPagina } from "../asaas";

/**
 * A **conta do Asaas como ela é**, lida ao vivo — 02/09/2026.
 *
 * ⚖️ **O defeito que este módulo fecha, e ele foi medido.** A tela
 * `/bancos` listava linhas da tabela `bancos`, com `saldo` digitado à mão e
 * ajustado por gatilho a cada lançamento. Em 02/09/2026 a linha "Asaas" dizia
 * **R$ 429,47**; o saldo real da conta, pelo `GET /finance/balance`, era
 * **R$ 13,79**. Nenhum erro apareceu: a tela mostrava um número redondo,
 * com cara de certo, 31× maior que o dinheiro que existe.
 *
 * ⛔ **Por isso nada aqui é gravado no banco.** Espelhar o saldo numa coluna
 * recriaria o mesmo defeito com um passo a mais — `bancos.saldo` é somado pelo
 * gatilho `apply_lancamento_saldo` a cada lançamento, então uma cópia
 * começaria a divergir do gateway no minuto seguinte à sincronização. O que
 * vale é o que o Asaas responde **agora**, e é isso que a tela pede.
 *
 * ⚠️ **Toda leitura devolve `Leitura<T>`, não o valor cru.** Uma conta que não
 * respondeu tem de aparecer como *não respondeu* — devolver `0` transformaria
 * uma falha de rede em "sua empresa está sem dinheiro", que é exatamente a
 * classe de mentira que este módulo existe para acabar. Cada bloco da tela
 * cai sozinho, e diz por quê.
 */

export type Leitura<T> = { ok: true; valor: T } | { ok: false; erro: string };

async function ler<T>(o: () => Promise<T>): Promise<Leitura<T>> {
  try {
    return { ok: true, valor: await o() };
  } catch (e) {
    const erro = e instanceof Error ? e.message : "falha ao consultar o Asaas";
    console.error("[asaas/conta]", erro);
    return { ok: false, erro };
  }
}

/** O titular — quem é o dono do dinheiro, na palavra do gateway. */
export interface TitularAsaas {
  nome: string;
  documento: string | null;
  email: string | null;
  cidade: string | null;
  uf: string | null;
  /** `APPROVED`, `PENDING`, … — se a conta pode transacionar. */
  situacao: string | null;
}

export interface ChavePix {
  chave: string;
  tipo: string;
  situacao: string;
}

export interface EstatisticaCobrancas {
  quantidade: number;
  valor_bruto: number;
  /** Bruto menos a taxa do gateway. A diferença entre os dois é o custo real. */
  valor_liquido: number;
}

/**
 * Uma linha do extrato do Asaas.
 *
 * `saldo_apos` vem do próprio gateway (`balance` do lançamento) e não é
 * recalculado aqui: refazer a soma do lado de cá criaria um segundo saldo,
 * que é a origem de toda divergência que este módulo remove.
 */
export interface LinhaExtrato {
  id: string;
  data: string;
  tipo: string;
  descricao: string;
  valor: number;
  saldo_apos: number | null;
  payment_id: string | null;
}

export interface PainelBancario {
  saldo: Leitura<number>;
  titular: Leitura<TitularAsaas>;
  pix: Leitura<ChavePix[]>;
  cobrancas: Leitura<EstatisticaCobrancas>;
  extrato: Leitura<LinhaExtrato[]>;
  /** Quando esta leitura foi feita — sem isso "ao vivo" é só uma promessa. */
  lido_em: string;
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

const texto = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
};

export async function saldoAsaas(): Promise<number> {
  const r = await buscarUm<{ balance: number }>("/finance/balance");
  return num(r?.balance);
}

export async function titularAsaas(): Promise<TitularAsaas> {
  const r = await buscarUm<Record<string, unknown>>("/myAccount/commercialInfo");
  const cidade = (r?.city ?? null) as { name?: string; state?: string } | null;
  return {
    // `companyName` para PJ, `name` para PF — a conta é uma ou outra.
    nome: texto(r?.companyName) ?? texto(r?.name) ?? "Conta Asaas",
    documento: texto(r?.cpfCnpj),
    email: texto(r?.email),
    cidade: texto(cidade?.name),
    uf: texto(cidade?.state),
    situacao: texto(r?.status),
  };
}

export async function chavesPixAsaas(): Promise<ChavePix[]> {
  const r = await listarPagina<Record<string, unknown>>("/pix/addressKeys", 0, 20);
  return (r.data ?? []).map((k) => ({
    chave: String(k.key ?? ""),
    tipo: String(k.type ?? ""),
    situacao: String(k.status ?? ""),
  }));
}

export async function estatisticaCobrancas(): Promise<EstatisticaCobrancas> {
  const r = await buscarUm<{ quantity: number; value: number; netValue: number }>(
    "/finance/payment/statistics"
  );
  return {
    quantidade: num(r?.quantity),
    valor_bruto: num(r?.value),
    valor_liquido: num(r?.netValue),
  };
}

export async function extratoAsaas(limite = 25): Promise<LinhaExtrato[]> {
  const r = await listarPagina<Record<string, unknown>>(
    "/financialTransactions",
    0,
    Math.min(Math.max(limite, 1), 100)
  );
  return (r.data ?? []).map((t) => ({
    id: String(t.id ?? ""),
    data: String(t.date ?? "").slice(0, 10),
    tipo: String(t.type ?? ""),
    descricao: String(t.description ?? ""),
    valor: num(t.value),
    saldo_apos: t.balance === null || t.balance === undefined ? null : num(t.balance),
    payment_id: texto(t.paymentId),
  }));
}

/**
 * Tudo que a tela `/bancos` mostra, numa ida só.
 *
 * As cinco leituras vão **em paralelo** e cada uma sobrevive à queda das
 * outras: o saldo é o dado central, mas um `403` na chave Pix não pode apagar
 * o saldo da tela. É a mesma disciplina de `/api/integracao/saude`, onde cada
 * sonda reporta o próprio erro.
 */
export async function painelBancario(limiteExtrato = 25): Promise<PainelBancario> {
  const [saldo, titular, pix, cobrancas, extrato] = await Promise.all([
    ler(() => saldoAsaas()),
    ler(() => titularAsaas()),
    ler(() => chavesPixAsaas()),
    ler(() => estatisticaCobrancas()),
    ler(() => extratoAsaas(limiteExtrato)),
  ]);

  return { saldo, titular, pix, cobrancas, extrato, lido_em: new Date().toISOString() };
}

/**
 * Rótulo em português para o `type` do extrato.
 *
 * ⚠️ **Cai para o código cru quando não conhece o tipo**, de propósito. O Asaas
 * cria tipos novos sem avisar; traduzir para "Outro" apagaria a única pista de
 * quem for investigar uma linha que não bate.
 */
const ROTULO_EXTRATO: Record<string, string> = {
  PAYMENT_RECEIVED: "Cobrança recebida",
  PAYMENT_FEE: "Taxa da cobrança",
  PAYMENT_REFUNDED: "Cobrança estornada",
  PAYMENT_REVERSAL: "Estorno revertido",
  TRANSFER: "Transferência",
  TRANSFER_FEE: "Taxa de transferência",
  RECEIVABLE_ANTICIPATION_CREDIT: "Antecipação creditada",
  // ⚠️ Os três nomes de antecipação convivem, e conferi na conta em
  // 02/09/2026: o crédito real vem como `GROSS_CREDIT`, e é ele que aparece no
  // extrato. Faltando o rótulo, a linha maior do extrato ficava em caixa alta
  // e em inglês no meio de uma tela em português.
  RECEIVABLE_ANTICIPATION_GROSS_CREDIT: "Antecipação creditada (bruto)",
  RECEIVABLE_ANTICIPATION_DEBIT: "Baixa da antecipação",
  RECEIVABLE_ANTICIPATION_FEE: "Taxa de antecipação",
  BILL_PAYMENT: "Pagamento de conta",
  BILL_PAYMENT_FEE: "Taxa de pagamento de conta",
  BILL_PAYMENT_CANCELLED: "Pagamento de conta cancelado",
  PIX_TRANSACTION_CREDIT: "Pix recebido",
  PIX_TRANSACTION_DEBIT: "Pix enviado",
  PIX_TRANSACTION_FEE: "Taxa de Pix",
  PIX_TRANSACTION_DEBIT_REFUND: "Devolução de Pix enviado",
  PAYMENT_DUNNING_REQUEST_FEE: "Taxa de negativação",
  PAYMENT_MESSAGING_NOTIFICATION_FEE: "Taxa de notificação ao cliente",
  CHARGEBACK: "Chargeback",
  CHARGEBACK_REVERSAL: "Chargeback revertido",
  CREDIT_BUREAU_REPORT: "Consulta de crédito",
  INVOICE_FEE: "Taxa de nota fiscal",
  ASAAS_CARD_TRANSACTION: "Compra no cartão Asaas",
  ASAAS_CARD_TRANSACTION_REFUND: "Estorno no cartão Asaas",
};

export function rotuloExtrato(tipo: string): string {
  return ROTULO_EXTRATO[tipo] ?? tipo;
}
