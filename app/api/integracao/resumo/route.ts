import { NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { rotaIntegracao } from "@/lib/integracao/rota";
import { calcularResumo, type LinhaAssinatura, type LinhaReceber } from "@/lib/integracao/contrato";
import { today } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * `GET /api/integracao/resumo` — os KPIs do painel da Dashboard (`RF-01`).
 *
 * O cálculo mora em `lib/integracao/contrato.ts` e roda **aqui**, não lá:
 * `RN-01` diz que o ScopeFinance é dono do número financeiro e a Dashboard
 * nunca recalcula. Dois lugares somando o mesmo faturamento é como se
 * descobre, no fechamento, que eles nunca somaram igual.
 */
export const GET = rotaIntegracao(async () => {
  const supabase = createSupabaseAdmin();

  const [receber, assinaturas, ativos] = await Promise.all([
    supabase
      .from("contas_receber")
      .select("id, cliente_id, contrato_id, valor, valor_pago, deducoes, vencimento, status, pago_em")
      .limit(10000),
    supabase.from("assinaturas").select("valor, ciclo, status").limit(2000),
    supabase.from("clientes").select("id", { count: "exact", head: true }).eq("status", "Ativo"),
  ]);

  const erro = receber.error ?? assinaturas.error ?? ativos.error;
  if (erro) return NextResponse.json({ error: erro.message }, { status: 500 });

  return NextResponse.json(
    calcularResumo(
      (receber.data ?? []) as LinhaReceber[],
      (assinaturas.data ?? []) as LinhaAssinatura[],
      ativos.count ?? 0,
      today()
    )
  );
});
