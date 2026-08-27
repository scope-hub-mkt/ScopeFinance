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
    // ⛔ **Cliente provisório NÃO entra em número financeiro** — §2.3, item 3
    // da lista do que o estado proíbe: nada de faturamento, MRR, inadimplência
    // **nem clientes ativos**.
    //
    // ⚠️ **Isto foi medido errando, em 28/08/2026.** O vigia do CRM criou os
    // dois primeiros clientes provisórios e `clientes_ativos` saltou de 21 para
    // 23 — porque `clientes.status` nasce `'Ativo'` por default do schema, e a
    // contagem olhava só para ele. Nenhum erro foi levantado: o painel da
    // Dashboard passou a exibir dois clientes a mais, com cara de certo.
    //
    // ⚖️ A trava fica **aqui, na contagem**, e não em quem cria: assim ela
    // vale para QUALQUER caminho que produza um cadastro incompleto — o CRM, o
    // backfill do gateway, a tela — em vez de depender de cada um lembrar.
    // `status` e `status_cadastro` são eixos diferentes: o primeiro diz se o
    // cliente está em operação, o segundo diz se a identidade dele está
    // conferida. Só quem passa nos dois conta.
    supabase
      .from("clientes")
      .select("id", { count: "exact", head: true })
      .eq("status", "Ativo")
      .eq("status_cadastro", "efetivo"),
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
