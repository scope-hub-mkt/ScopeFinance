import { NextRequest } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { gerarRecorrencias } from "@/lib/recorrencia";
import { ok, fail, handleError } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Endpoint chamado pelo Vercel Cron (config em vercel.json).
 * Protegido por CRON_SECRET: o Vercel envia `Authorization: Bearer <CRON_SECRET>`.
 */
export async function GET(req: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET;
    const auth = req.headers.get("authorization");
    if (secret && auth !== `Bearer ${secret}`) {
      return fail("Não autorizado", 401);
    }
    const supabase = createSupabaseAdmin();
    const result = await gerarRecorrencias(supabase);
    return ok({ ok: true, ...result });
  } catch (e) {
    return handleError(e);
  }
}
