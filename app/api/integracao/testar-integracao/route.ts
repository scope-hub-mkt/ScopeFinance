import { NextRequest } from "next/server";
import { requireUser } from "@/lib/supabase/auth";
import { ok, fail, handleError } from "@/lib/api";
import { testarIntegracao, SLUGS } from "@/lib/integracao/teste";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/integracao/testar-integracao` — o botão **Testar** de cada bloco.
 *
 * ⛔ Só leitura em todo provedor: nada é criado no Asaas nem no CRM. Botão de
 * teste que cria dado real é armadilha — quem clica não espera consequência.
 */
export async function POST(req: NextRequest) {
  try {
    await requireUser();
    const { slug } = (await req.json().catch(() => ({}))) as { slug?: string };
    if (!slug || !SLUGS.includes(slug)) {
      return fail(`slug inválido — use um de: ${SLUGS.join(", ")}`, 400);
    }
    return ok(await testarIntegracao(slug));
  } catch (e) {
    return handleError(e);
  }
}
