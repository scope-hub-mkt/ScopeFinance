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

export function getInvoice(id: string): Promise<AsaasInvoice> {
  return asaasRequest<AsaasInvoice>(`/invoices/${id}`, "GET");
}

/** Defaults de tributos vindos do ambiente (podem ser sobrescritos por requisição). */
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

export function defaultMunicipalServiceCode(): string | undefined {
  return process.env.ASAAS_NF_MUNICIPAL_SERVICE_CODE || undefined;
}
