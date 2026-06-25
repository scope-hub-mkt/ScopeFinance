import { requireUser } from "@/lib/supabase/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { gerarRecorrencias } from "@/lib/recorrencia";
import { ok, handleError } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Geração manual das recorrências (botão "Gerar cobranças" em Assinaturas). */
export async function POST() {
  try {
    await requireUser();
    const supabase = createSupabaseAdmin();
    const result = await gerarRecorrencias(supabase);
    return ok({ ok: true, ...result });
  } catch (e) {
    return handleError(e);
  }
}
