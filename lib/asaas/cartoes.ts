import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listarPagina } from "../asaas";
import type { Leitura } from "./conta";

/**
 * **Cartões, com o dado real** — 02/09/2026.
 *
 * ⚖️ **A decisão difícil desta tela, e por que ela mudou de assunto.** A
 * `/cartoes` antiga cadastrava *o cartão da empresa*: nome, bandeira, limite,
 * quanto do limite estava usado, dia de fechamento. Nada disso existe na API
 * do Asaas — o Asaas é o **recebedor**, não o emissor do cartão de crédito da
 * Scope. Em 02/09/2026 a tabela `cartoes` tinha **zero linhas** e a tela vivia
 * mostrando "Nenhum cartão cadastrado" para sempre.
 *
 * ✅ **O cartão que este sistema conhece de verdade é o cartão que PAGA.** São
 * 71 cobranças `CREDIT_CARD` na conta, cada uma com bandeira e os quatro
 * últimos dígitos vindos do gateway. Isso é dinheiro real, com nome, valor e
 * data — e responde às perguntas que um financeiro faz sobre cartão: quanto
 * entra por ele, o que ainda não caiu, e o que virou inadimplência.
 *
 * ⛔ **O que este módulo NÃO faz:** inventar limite. Limite de cartão de
 * cliente é dado do banco emissor, não do Asaas. Uma barra de "70% do limite"
 * desenhada a partir de nada é a mesma ficção do saldo de R$ 429,47 que a
 * `/bancos` mostrava — só que mais bonita.
 *
 * ⚠️ **Quatro dígitos são identidade**, e por isso a tela os marca com
 * `sigilo` (`RF-90`). O gateway nunca devolve o número inteiro, e este módulo
 * também não guarda nada: a agregação é feita em memória, por requisição.
 */

/** Como o Asaas nomeia o desfecho de uma cobrança, agrupado pelo que importa. */
const LIQUIDADO = new Set(["RECEIVED", "RECEIVED_IN_CASH", "CONFIRMED"]);
const ABERTO = new Set(["PENDING", "AWAITING_RISK_ANALYSIS", "APPROVED_BY_RISK_ANALYSIS"]);

export type Situacao = "liquidado" | "aberto" | "problema";

/**
 * ⚠️ **O que não é `liquidado` nem `aberto` é `problema`, e o default é esse
 * de propósito.** Um status novo do gateway — um chargeback com nome que ainda
 * não existe — precisa cair no balde que alguém olha. Cair em "aberto" o
 * esconderia dentro do dinheiro que ainda vai entrar.
 */
export function situacaoDe(status: string): Situacao {
  if (LIQUIDADO.has(status)) return "liquidado";
  if (ABERTO.has(status)) return "aberto";
  return "problema";
}

export interface CartaoAsaas {
  /** `BANDEIRA-1234` — a identidade do cartão até onde o gateway revela. */
  chave: string;
  bandeira: string;
  /** Os quatro últimos dígitos, ou `null` quando o gateway não os devolveu. */
  final: string | null;
  cobrancas: number;
  valor_total: number;
  liquidado: number;
  aberto: number;
  problema: number;
  /** Nomes de clientes que pagaram com este cartão — `sigilo` na tela. */
  clientes: string[];
  primeiro_uso: string | null;
  ultimo_uso: string | null;
}

export interface ParcelamentoAsaas {
  id: string;
  bandeira: string;
  final: string | null;
  cliente: string | null;
  parcelas: number;
  valor_parcela: number;
  valor_total: number;
  data: string | null;
  comprovante: string | null;
}

export interface ResumoCartoes {
  cartoes: CartaoAsaas[];
  parcelamentos: ParcelamentoAsaas[];
  total: {
    cobrancas: number;
    valor_total: number;
    liquidado: number;
    aberto: number;
    problema: number;
    cartoes_distintos: number;
  };
  /** ⚠️ `true` quando o teto de páginas cortou a leitura — a tela declara. */
  truncado: boolean;
  lido_em: string;
}

interface PagamentoCartao {
  id?: string;
  customer?: string;
  value?: number;
  status?: string;
  dateCreated?: string;
  paymentDate?: string | null;
  creditCard?: { creditCardNumber?: string; creditCardBrand?: string } | null;
}

interface ParcelaBruta {
  id?: string;
  customer?: string;
  value?: number;
  paymentValue?: number;
  installmentCount?: number;
  paymentDate?: string | null;
  dateCreated?: string;
  deleted?: boolean;
  transactionReceiptUrl?: string | null;
  creditCard?: { creditCardNumber?: string; creditCardBrand?: string } | null;
}

/**
 * ⛔ **Teto de páginas, e ele é o motivo de `truncado` existir.** Esta leitura
 * roda em serverless: um laço sem teto sobre uma conta que cresceu para
 * dezenas de milhares de cobranças estoura a duração da função e morre no
 * meio — devolvendo uma agregação parcial **com cara de completa**. Com teto,
 * a página corta e **diz que cortou**.
 */
const TETO_PAGINAS = 20;
const POR_PAGINA = 100;

async function todasAsPaginas<T>(colecao: string): Promise<{ itens: T[]; truncado: boolean }> {
  const itens: T[] = [];
  for (let pagina = 0; pagina < TETO_PAGINAS; pagina++) {
    const r = await listarPagina<T>(colecao, pagina * POR_PAGINA, POR_PAGINA);
    itens.push(...(r.data ?? []));
    if (!r.hasMore) return { itens, truncado: false };
  }
  return { itens, truncado: true };
}

const marca = (c: { creditCardBrand?: string } | null | undefined) =>
  (c?.creditCardBrand || "SEM BANDEIRA").toUpperCase();

const quatroUltimos = (c: { creditCardNumber?: string } | null | undefined) =>
  c?.creditCardNumber ? String(c.creditCardNumber) : null;

const chaveDe = (c: { creditCardNumber?: string; creditCardBrand?: string } | null | undefined) =>
  `${marca(c)}-${quatroUltimos(c) ?? "????"}`;

const dinheiro = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Os cartões que pagaram esta conta, e os parcelamentos abertos neles.
 *
 * `nomePorCustomer` vem do espelho local de clientes (`clientes.asaas_customer_id`)
 * e não de uma consulta por cliente ao gateway: 71 cobranças dariam 71 idas ao
 * Asaas para descobrir nomes que já estão no banco daqui.
 */
export async function resumoDeCartoes(
  nomePorCustomer: Map<string, string> = new Map()
): Promise<ResumoCartoes> {
  const [pagamentos, parcelas] = await Promise.all([
    todasAsPaginas<PagamentoCartao>("/payments?billingType=CREDIT_CARD"),
    todasAsPaginas<ParcelaBruta>("/installments"),
  ]);

  const porCartao = new Map<string, CartaoAsaas & { _clientes: Set<string> }>();
  const total = {
    cobrancas: 0,
    valor_total: 0,
    liquidado: 0,
    aberto: 0,
    problema: 0,
    cartoes_distintos: 0,
  };

  for (const p of pagamentos.itens) {
    const chave = chaveDe(p.creditCard);
    let c = porCartao.get(chave);
    if (!c) {
      c = {
        chave,
        bandeira: marca(p.creditCard),
        final: quatroUltimos(p.creditCard),
        cobrancas: 0,
        valor_total: 0,
        liquidado: 0,
        aberto: 0,
        problema: 0,
        clientes: [],
        _clientes: new Set<string>(),
        primeiro_uso: null,
        ultimo_uso: null,
      };
      porCartao.set(chave, c);
    }

    const valor = dinheiro(p.value);
    const situacao = situacaoDe(String(p.status ?? ""));

    c.cobrancas++;
    c.valor_total += valor;
    c[situacao] += valor;
    total.cobrancas++;
    total.valor_total += valor;
    total[situacao] += valor;

    const nome = p.customer ? nomePorCustomer.get(p.customer) : undefined;
    if (nome) c._clientes.add(nome);

    // A data que interessa é a do uso do cartão: a do pagamento quando houve,
    // a da criação da cobrança enquanto ele ainda não caiu.
    const data = (p.paymentDate || p.dateCreated || "").slice(0, 10);
    if (data) {
      if (!c.primeiro_uso || data < c.primeiro_uso) c.primeiro_uso = data;
      if (!c.ultimo_uso || data > c.ultimo_uso) c.ultimo_uso = data;
    }
  }

  const cartoes: CartaoAsaas[] = [...porCartao.values()]
    .map(({ _clientes, ...c }) => ({ ...c, clientes: [..._clientes].sort() }))
    // Maior volume primeiro: a tela responde "por onde entra mais dinheiro?".
    .sort((a, b) => b.valor_total - a.valor_total);

  total.cartoes_distintos = cartoes.length;

  const parcelamentos: ParcelamentoAsaas[] = parcelas.itens
    .filter((p) => !p.deleted)
    .map((p) => ({
      id: String(p.id ?? ""),
      bandeira: marca(p.creditCard),
      final: quatroUltimos(p.creditCard),
      cliente: (p.customer && nomePorCustomer.get(p.customer)) || null,
      parcelas: Number(p.installmentCount ?? 0),
      valor_parcela: dinheiro(p.paymentValue),
      valor_total: dinheiro(p.value),
      data: (p.paymentDate || p.dateCreated || "").slice(0, 10) || null,
      comprovante: p.transactionReceiptUrl ?? null,
    }))
    .sort((a, b) => (b.data ?? "").localeCompare(a.data ?? ""));

  return {
    cartoes,
    parcelamentos,
    total,
    truncado: pagamentos.truncado || parcelas.truncado,
    lido_em: new Date().toISOString(),
  };
}

/** O mesmo resumo, embrulhado para a tela poder cair sozinha. Ver `conta.ts`. */
export async function lerResumoDeCartoes(
  nomePorCustomer?: Map<string, string>
): Promise<Leitura<ResumoCartoes>> {
  try {
    return { ok: true, valor: await resumoDeCartoes(nomePorCustomer) };
  } catch (e) {
    const erro = e instanceof Error ? e.message : "falha ao consultar o Asaas";
    console.error("[asaas/cartoes]", erro);
    return { ok: false, erro };
  }
}

/**
 * `customer` do Asaas → nome do cliente, pelo vínculo que já está no banco.
 *
 * ⚠️ **Cliente sem vínculo simplesmente não entra no mapa**, e a tela mostra o
 * cartão sem nome em vez de inventar um. Um cadastro que ainda não foi
 * reconciliado com o gateway (`lib/asaas/backfill.ts`) é uma lacuna real; um
 * nome chutado esconderia essa lacuna atrás de texto plausível.
 */
export async function nomesPorCustomerAsaas(
  supabase: SupabaseClient
): Promise<Map<string, string>> {
  const { data } = await supabase
    .from("clientes")
    .select("nome, asaas_customer_id")
    .not("asaas_customer_id", "is", null)
    .limit(5000);

  const mapa = new Map<string, string>();
  for (const c of (data ?? []) as Array<{ nome: string; asaas_customer_id: string }>) {
    mapa.set(c.asaas_customer_id, c.nome);
  }
  return mapa;
}
