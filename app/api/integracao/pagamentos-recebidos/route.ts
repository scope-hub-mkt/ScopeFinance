import { NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { rotaIntegracao, recusa } from "@/lib/integracao/rota";
import { pagamentosDeReceber, type LinhaReceber } from "@/lib/integracao/contrato";

export const dynamic = "force-dynamic";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `GET /api/integracao/pagamentos-recebidos?desde=YYYY-MM-DD`
 *
 * O fato gerador da comissão (`RN-06` da Dashboard). Só conta **baixada**:
 * parcela vincenda, faturada ou inadimplida não aparece aqui de propósito —
 * é o que impede a Dashboard de pagar comissão sobre dinheiro que não entrou.
 *
 * `deducoes` vai junto porque `RN-04` manda calcular sobre o líquido. Mandar
 * só o bruto obrigaria a Dashboard a adivinhar o imposto — e ela recalcularia
 * um número financeiro, que é exatamente o que `RN-01` proíbe.
 */
export const GET = rotaIntegracao(async (req) => {
  const desde = new URL(req.url).searchParams.get("desde");
  if (!desde || !ISO.test(desde)) {
    return recusa("Parâmetro obrigatório: desde=YYYY-MM-DD", 400);
  }

  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase
    .from("contas_receber")
    .select("id, cliente_id, contrato_id, valor, valor_pago, deducoes, vencimento, status, pago_em")
    .eq("status", "Pago")
    .gte("pago_em", desde)
    .order("pago_em", { ascending: true })
    .limit(5000);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(pagamentosDeReceber((data ?? []) as LinhaReceber[]));
});
