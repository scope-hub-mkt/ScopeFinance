import { requireUser } from "@/lib/supabase/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import {
  entregarFila,
  reconciliarComDashboard,
  reconciliarServicos,
} from "@/lib/integracao/sincronia";
import { ok, handleError } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * `POST /api/integracao/sincronizar` — o botão "Sincronizar agora" da tela.
 *
 * ⚠️ **Exige sessão, não a chave da integração.** Quem aperta isto é uma
 * pessoa logada aqui; a chave da Dashboard não deve poder disparar trabalho
 * de reconciliação — ela é credencial de leitura.
 *
 * Faz as duas direções na mesma passada, e nesta ordem: **entregar antes de
 * reconciliar**. Ao contrário, a reconciliação puxaria da Dashboard um estado
 * que ainda não recebeu o que estava na nossa fila, e o relatório mostraria
 * uma divergência que já estava resolvida.
 */
export async function POST() {
  try {
    await requireUser();
    const supabase = createSupabaseAdmin();
    const enviados = await entregarFila(supabase);
    const recebidos = await reconciliarComDashboard(supabase);
    // O catálogo na mesma passada (`D-90`): quem aperta "Sincronizar agora"
    // espera que a palavra signifique tudo, não só cliente. E é esta chamada
    // que **poda** — a única que remove do espelho o que a Dashboard apagou.
    const catalogo = await reconciliarServicos(supabase);
    return ok({ ok: true, enviados, recebidos, catalogo });
  } catch (e) {
    return handleError(e);
  }
}
