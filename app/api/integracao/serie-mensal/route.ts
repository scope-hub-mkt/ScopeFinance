import { NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { rotaIntegracao } from "@/lib/integracao/rota";
import { calcularSerie, periodosAte, type LinhaReceber } from "@/lib/integracao/contrato";
import { today } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * `GET /api/integracao/serie-mensal?meses=6` — série dos mini-gráficos.
 *
 * Devolve **todos** os meses da janela, inclusive zerados: a Dashboard
 * distingue "mês sem faturamento" (ponto em zero) de "sem dado" (série
 * vazia), e omitir o mês vazio apagaria essa diferença lá.
 */
export const GET = rotaIntegracao(async (req) => {
  const bruto = Number(new URL(req.url).searchParams.get("meses") ?? 6);
  const meses = Number.isFinite(bruto) ? Math.min(Math.max(Math.trunc(bruto), 1), 36) : 6;
  const hoje = today();
  const desde = periodosAte(hoje, meses)[0] + "-01";

  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase
    .from("contas_receber")
    .select("id, cliente_id, contrato_id, valor, valor_pago, deducoes, vencimento, status, pago_em")
    // ⛔ **Só o que nasceu no gateway atravessa a ponte** (`RF-94`, `RN-51`,
    // `D-99`). Recebível digitado à mão existe, aparece em `/receber/manuais`
    // e é conciliável — o que ele não faz é chegar à Dashboard como se o
    // Asaas o tivesse recebido.
    //
    // ⚖️ O filtro mora **na consulta**, não em quem escreve: vale para
    // qualquer caminho que produza linha manual — a tela, a recorrência
    // interna, um backfill futuro — em vez de depender de cada um lembrar. É
    // a mesma correção que a contagem de clientes ativos recebeu em 28/08.
    .eq("origem_lancamento", "asaas")
    // `or` porque a conta entra na série por DOIS caminhos: o vencimento (que
    // é faturamento) e a data de baixa (que é recebimento). Filtrar só por
    // vencimento perderia a que venceu antes da janela e foi paga dentro dela.
    .or(`vencimento.gte.${desde},pago_em.gte.${desde}`)
    .limit(10000);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(calcularSerie((data ?? []) as LinhaReceber[], hoje, meses));
});
