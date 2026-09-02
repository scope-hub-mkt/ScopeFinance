import "server-only";

/**
 * Cliente da API do Asaas (v3).
 * Autenticação por header `access_token`. Base configurável por env:
 *   ASAAS_API_BASE = https://api-sandbox.asaas.com/v3  (sandbox)
 *                  | https://api.asaas.com/v3           (produção)
 */

const BASE = process.env.ASAAS_API_BASE || "https://api-sandbox.asaas.com/v3";

function apiKey(): string {
  const k = process.env.ASAAS_API_KEY;
  if (!k) throw new Error("ASAAS_API_KEY não configurada no ambiente.");
  return k;
}

export class AsaasError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "AsaasError";
    this.status = status;
    this.body = body;
  }
}

async function asaasRequest<T = unknown>(
  path: string,
  method: "GET" | "POST" | "DELETE" = "GET",
  body?: unknown
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      access_token: apiKey(),
      "User-Agent": "ScopeFinance",
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const msg =
      (data?.errors && data.errors[0]?.description) ||
      `Asaas respondeu ${res.status}`;
    throw new AsaasError(msg, res.status, data);
  }
  return data as T;
}

// ─── Listagem paginada ──────────────────────────────────────────────

export interface PaginaAsaas<T> {
  data: T[];
  hasMore: boolean;
  totalCount: number;
  offset: number;
}

/**
 * Uma página de qualquer coleção do Asaas (`/customers`, `/payments`, …).
 *
 * ⚖️ Existe para o backfill do §4 do plano: o webhook só traz o que acontece
 * **de agora em diante**, e a conta tem 180 cobranças e 51 notas anteriores a
 * ele. Sem esta leitura, faturamento, MRR e inadimplência continuariam sem
 * relação com o dinheiro que de fato passou pelo gateway.
 *
 * Página por página, e não tudo de uma vez, porque o consumidor roda em
 * serverless: uma função que tenta 180 itens com ida e volta ao banco em cada
 * um esbarra no teto de duração e morre no meio — deixando metade importada,
 * que é o pior estado possível.
 */
export function listarPagina<T = Record<string, unknown>>(
  colecao: string,
  offset = 0,
  limit = 100
): Promise<PaginaAsaas<T>> {
  const sep = colecao.includes("?") ? "&" : "?";
  return asaasRequest<PaginaAsaas<T>>(`${colecao}${sep}limit=${limit}&offset=${offset}`);
}

/**
 * Um recurso do Asaas pelo id.
 *
 * ⚠️ Existe porque a **listagem omite o que foi excluído**: medido em
 * 28/08/2026, `GET /customers` devolve 22 e há 13 outros, todos com
 * `"deleted": true`, que só respondem quando pedidos pelo id — e que têm
 * cobrança real neste banco. Uma importação que confie só na listagem deixa
 * essa receita sem dono e não avisa.
 */
export function buscarUm<T = Record<string, unknown>>(caminho: string): Promise<T> {
  return asaasRequest<T>(caminho);
}

// ─── Customers ──────────────────────────────────────────────────────
export interface AsaasCustomer {
  id: string;
  name: string;
  cpfCnpj: string;
}

export function createCustomer(input: {
  name: string;
  cpfCnpj: string;
  email?: string | null;
  phone?: string | null;
  mobilePhone?: string | null;
  externalReference?: string | null;
}): Promise<AsaasCustomer> {
  return asaasRequest<AsaasCustomer>("/customers", "POST", input);
}

// ─── Invoices (NFS-e) ───────────────────────────────────────────────
export interface AsaasInvoiceTaxes {
  retainIss?: boolean;
  iss?: number;
  cofins?: number;
  csll?: number;
  inss?: number;
  ir?: number;
  pis?: number;
}

export interface AsaasInvoiceInput {
  customer: string; // id do customer no Asaas
  serviceDescription: string;
  observations?: string;
  externalReference?: string;
  value: number;
  deductions?: number;
  effectiveDate: string; // YYYY-MM-DD
  municipalServiceCode?: string;
  municipalServiceId?: string;
  municipalServiceName?: string;
  updatePayment?: boolean;
  taxes: AsaasInvoiceTaxes;
}

export interface AsaasInvoice {
  id: string;
  status: string;
  number?: string;
  pdfUrl?: string;
  xmlUrl?: string;
  value: number;
  [k: string]: unknown;
}

/** Cria (agenda) uma nota fiscal de serviço. */
export function createInvoice(input: AsaasInvoiceInput): Promise<AsaasInvoice> {
  return asaasRequest<AsaasInvoice>("/invoices", "POST", input);
}

/** Autoriza/emite uma nota fiscal já agendada. */
export function authorizeInvoice(id: string): Promise<AsaasInvoice> {
  return asaasRequest<AsaasInvoice>(`/invoices/${id}/authorize`, "POST");
}

/**
 * Defaults de tributos vindos do ambiente.
 *
 * ⛔ **Isto deixou de ser a autoridade fiscal em 27/08/2026** (`RF-60`). A
 * alíquota que vale é a **cadastrada com vigência**, resolvida por
 * `tributosEm()` de `lib/fiscal.ts` a partir da **data do fato gerador**.
 * Esta função continua existindo como o **fallback declarado**, para o caso de
 * nada haver cadastrado — e é `lib/fiscal.ts` quem decide quando chamá-la.
 *
 * ⚠️ **Não chame daqui para montar uma nota.** Ler o ambiente direto devolve a
 * alíquota de **hoje**, e emitir hoje a nota de um recebimento de junho com a
 * alíquota de hoje é o defeito de auditoria que `RN-43` proíbe.
 */
export function defaultTaxes(): AsaasInvoiceTaxes {
  const num = (v: string | undefined) => (v ? Number(v) : 0);
  return {
    retainIss: process.env.ASAAS_NF_RETAIN_ISS === "true",
    iss: num(process.env.ASAAS_NF_ISS),
    cofins: num(process.env.ASAAS_NF_COFINS),
    csll: num(process.env.ASAAS_NF_CSLL),
    inss: num(process.env.ASAAS_NF_INSS),
    ir: num(process.env.ASAAS_NF_IR),
    pis: num(process.env.ASAAS_NF_PIS),
  };
}

/**
 * Código de serviço municipal vindo do ambiente.
 *
 * ⛔ **Fallback, não autoridade** (`RF-61`, 27/08/2026): o valor que vale é o
 * cadastrado em `config_fiscal`, lido por `lerConfigFiscal()` de
 * `lib/fiscal.ts`. O dono já decidiu uma vez que isto é configuração de
 * negócio; esta função é o que responde enquanto ninguém cadastrou.
 */
export function defaultMunicipalServiceCode(): string | undefined {
  return process.env.ASAAS_NF_MUNICIPAL_SERVICE_CODE || undefined;
}
