import { NextRequest } from "next/server";
import { requireUser } from "@/lib/supabase/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { ok, fail, handleError } from "@/lib/api";
import { today } from "@/lib/format";
import {
  AsaasError,
  authorizeInvoice,
  createCustomer,
  createInvoice,
  defaultMunicipalServiceCode,
  defaultTaxes,
  type AsaasInvoiceTaxes,
} from "@/lib/asaas";
import {
  dataDoFatoGerador,
  lerConfigFiscal,
  listarRetencoes,
  tributosEm,
} from "@/lib/fiscal";

export const dynamic = "force-dynamic";

const onlyDigits = (s: string | null | undefined) => (s || "").replace(/\D/g, "");

/**
 * Emite uma NFS-e via Asaas.
 * body: {
 *   conta_receber_id?: string,   // emitir a partir de uma cobrança recebida
 *   cliente_id?: string,         // ou direto por cliente
 *   descricao_servico?: string,
 *   valor?: number,
 *   municipalServiceCode?: string,
 *   taxes?: { retainIss?, iss?, cofins?, csll?, inss?, ir?, pis? },
 *   emitir_agora?: boolean       // default true (autoriza na hora)
 * }
 */
export async function POST(req: NextRequest) {
  const supabase = createSupabaseAdmin();
  let notaId: string | null = null;

  try {
    await requireUser();
    const body = (await req.json()) as {
      conta_receber_id?: string;
      cliente_id?: string;
      descricao_servico?: string;
      valor?: number;
      municipalServiceCode?: string;
      taxes?: AsaasInvoiceTaxes;
      emitir_agora?: boolean;
    };

    // 1) Resolve a origem (conta a receber ou cliente direto)
    let clienteId = body.cliente_id ?? null;
    let valor = body.valor ?? 0;
    let descricao = body.descricao_servico ?? "";
    // A conta sobrevive ao bloco abaixo porque é dela que sai a data do fato
    // gerador (`RN-43`) — sem isso, a alíquota lida seria a de hoje.
    let contaFiscal: { pago_em?: string | null; vencimento?: string | null } | null = null;

    if (body.conta_receber_id) {
      const { data: conta, error } = await supabase
        .from("contas_receber")
        .select("*")
        .eq("id", body.conta_receber_id)
        .single();
      if (error || !conta) return fail("Conta a receber não encontrada", 404);
      clienteId = clienteId || conta.cliente_id;
      valor = valor || Number(conta.valor);
      descricao = descricao || conta.descricao;
      contaFiscal = conta;
    }

    if (!clienteId) return fail("Informe o cliente (cliente_id) ou uma conta a receber", 400);
    if (!valor || valor <= 0) return fail("Valor da nota inválido", 400);

    // 2) Carrega o cliente
    const { data: cliente, error: cliErr } = await supabase
      .from("clientes")
      .select("*")
      .eq("id", clienteId)
      .single();
    if (cliErr || !cliente) return fail("Cliente não encontrado", 404);

    const cpfCnpj = onlyDigits(cliente.doc);
    if (!cpfCnpj) return fail(`Cliente "${cliente.nome}" está sem CPF/CNPJ — obrigatório para emitir NF`, 400);

    // 3) Registra a nota como "Agendada" (rastreabilidade mesmo se o Asaas falhar)
    const { data: nota, error: notaErr } = await supabase
      .from("notas_fiscais")
      .insert({
        cliente_id: clienteId,
        conta_receber_id: body.conta_receber_id ?? null,
        descricao_servico: descricao,
        valor,
        status: "Agendada",
      })
      .select()
      .single();
    if (notaErr || !nota) return fail(notaErr?.message || "Falha ao registrar nota", 500);
    notaId = nota.id;

    // 4) Garante o cliente no Asaas
    let asaasCustomerId = cliente.asaas_customer_id as string | null;
    if (!asaasCustomerId) {
      const customer = await createCustomer({
        name: cliente.nome,
        cpfCnpj,
        email: cliente.email,
        mobilePhone: onlyDigits(cliente.tel) || undefined,
        externalReference: cliente.id,
      });
      asaasCustomerId = customer.id;
      await supabase.from("clientes").update({ asaas_customer_id: asaasCustomerId }).eq("id", cliente.id);
    }

    // 4.5) Resolve o fiscal pela regra VIGENTE NA DATA DO FATO GERADOR — `RF-60`,
    // `RN-43`. ⛔ Não é a alíquota de hoje: emitir hoje a nota de um
    // recebimento de junho com a alíquota de hoje é o defeito de auditoria que
    // a regra proíbe. Ordem do fato gerador: pagamento → vencimento → hoje.
    const dataFato = dataDoFatoGerador(contaFiscal, today());
    const [retencoes, config] = await Promise.all([listarRetencoes(), lerConfigFiscal()]);
    const tributos = tributosEm(retencoes, dataFato);

    // ⚠️ `effectiveDate` continua sendo HOJE de propósito: é a data de emissão
    // da nota, não a do fato gerador. As duas coincidem no caso comum e
    // divergem exatamente no caso que motivou `RF-60` — a alíquota segue a
    // segunda, a emissão segue a primeira. Se o contador exigir que a nota saia
    // datada no fato gerador, é uma linha aqui e uma decisão do dono.
    // 5) Cria a nota fiscal no Asaas
    const invoice = await createInvoice({
      customer: asaasCustomerId,
      serviceDescription: descricao || "Prestação de serviços",
      observations: `ScopeFinance · ${cliente.nome}`,
      externalReference: nota.id,
      value: valor,
      effectiveDate: today(),
      municipalServiceCode:
        body.municipalServiceCode || config?.municipal_service_code || defaultMunicipalServiceCode(),
      municipalServiceId: config?.municipal_service_id || undefined,
      municipalServiceName: config?.municipal_service_name || undefined,
      taxes: { ...tributos.taxes, ...(body.taxes || {}) },
    });

    await supabase
      .from("notas_fiscais")
      .update({ asaas_invoice_id: invoice.id, status: "Agendada", payload: invoice })
      .eq("id", nota.id);

    // 6) Autoriza (emite) imediatamente, se solicitado
    const emitirAgora = body.emitir_agora ?? true;
    if (emitirAgora) {
      const emitida = await authorizeInvoice(invoice.id);
      const { data: final } = await supabase
        .from("notas_fiscais")
        .update({
          status: emitida.status === "AUTHORIZED" ? "Emitida" : emitida.status || "Agendada",
          numero: emitida.number ?? null,
          pdf_url: emitida.pdfUrl ?? null,
          xml_url: emitida.xmlUrl ?? null,
          data_emissao: today(),
          payload: emitida,
        })
        .eq("id", nota.id)
        .select()
        .single();
      return ok({ ok: true, nota: final });
    }

    const { data: final } = await supabase.from("notas_fiscais").select("*").eq("id", nota.id).single();
    return ok({ ok: true, nota: final });
  } catch (e) {
    // Persiste o erro na nota para diagnóstico
    if (notaId) {
      const msg = e instanceof AsaasError ? e.message : e instanceof Error ? e.message : "Erro";
      await supabase.from("notas_fiscais").update({ status: "Erro", erro: msg }).eq("id", notaId);
    }
    return handleError(e);
  }
}
