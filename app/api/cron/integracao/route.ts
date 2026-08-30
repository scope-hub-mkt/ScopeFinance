import { NextRequest } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import {
  entregarFila,
  reconciliarComDashboard,
  reconciliarServicos,
} from "@/lib/integracao/sincronia";
import { processarPendentes, saudeDaFila } from "@/lib/asaas/processar";
import { ok, fail, handleError } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Cron da integração — entrega a fila de saída e reconcilia com a Dashboard.
 *
 * ⚠️ **O horário — 06:15 UTC — é escolhido, não sorteado.** Ele cai no meio
 * de uma cadeia que o Gate G0 (Ponto 3) já mediu e corrigiu uma vez:
 *
 *   06:00  recorrência daqui gera as contas do dia
 *   06:15  ESTE cron sincroniza o cadastro nos dois sentidos
 *   06:30  o cron de comissões da Dashboard lê os pagamentos (`D-20`)
 *
 * Antes do `D-20` o de lá rodava às 04:30 — 90 minutos ANTES da recorrência —
 * e a comissão lia sempre o estado de ontem, sem nada denunciar. Mover este
 * cron para fora dessa janela recria o mesmo defeito por outro caminho.
 *
 * Uma vez por dia porque é o que o plano Hobby da Vercel permite. Não é
 * limitação sentida no caso comum: a entrega imediata acontece logo depois da
 * resposta (`after()`), e este cron é a rede de segurança dela.
 */
export async function GET(req: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET;
    const auth = req.headers.get("authorization");
    if (secret && auth !== `Bearer ${secret}`) return fail("Não autorizado", 401);

    const supabase = createSupabaseAdmin();
    const enviados = await entregarFila(supabase);

    const recebidos = await reconciliarComDashboard(supabase);

    // ⚖️ O catálogo entra aqui pela mesma razão que os clientes (`D-90`): o
    // espelho só era escrito por evento, e evento não cobre o que foi
    // APAGADO. Sem esta passada, dado de demonstração apagado na Dashboard
    // ficava na tela `Serviços` daqui para sempre — foi o que aconteceu
    // entre 28 e 30/08/2026.
    const catalogo = await reconciliarServicos(supabase);

    // ⚖️ A varredura do Asaas entra aqui como TERCEIRA camada, não como a
    // principal. A primeira é o `after()` da própria rota do webhook; a
    // segunda é o workflow do GitHub Actions a cada 15 min. Esta é a que
    // sobra quando as duas falharem — e ela cabe neste cron porque o plano
    // Hobby da Vercel dá 2 crons por projeto, e os dois já estão usados.
    const asaas = await processarPendentes(supabase);
    const filaAsaas = await saudeDaFila(supabase);
    if (filaAsaas.alerta) console.error("[asaas][ALERTA]", filaAsaas.motivo);

    return ok({ ok: true, enviados, recebidos, catalogo, asaas, fila_asaas: filaAsaas });
  } catch (e) {
    return handleError(e);
  }
}
