import { NextRequest } from "next/server";
import { requireUser } from "@/lib/supabase/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { isResource, sanitizeInput, RESOURCES } from "@/lib/resources";
import { ok, fail, handleError } from "@/lib/api";
import { today } from "@/lib/format";

export const dynamic = "force-dynamic";

// GET /api/<recurso> — lista todos
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ resource: string }> }
) {
  try {
    await requireUser();
    const { resource } = await params;
    if (!isResource(resource)) return fail("Recurso inválido", 404);
    const cfg = RESOURCES[resource];
    const supabase = createSupabaseAdmin();
    const { data, error } = await supabase
      .from(resource)
      .select("*")
      .order(cfg.orderBy, { ascending: cfg.ascending });
    if (error) return fail(error.message, 500);
    return ok(data);
  } catch (e) {
    return handleError(e);
  }
}

// POST /api/<recurso> — cria
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ resource: string }> }
) {
  try {
    await requireUser();
    const { resource } = await params;
    if (!isResource(resource)) return fail("Recurso inválido", 404);
    const body = (await req.json()) as Record<string, unknown>;
    const input = sanitizeInput(resource, body);

    // Assinatura: se não veio a próxima data de cobrança, usa o início.
    if (resource === "assinaturas" && !input.proximo_venc) {
      input.proximo_venc = input.inicio ?? today();
    }

    const supabase = createSupabaseAdmin();
    const { data, error } = await supabase.from(resource).insert(input).select().single();
    if (error) return fail(error.message, 500);
    return ok(data, 201);
  } catch (e) {
    return handleError(e);
  }
}
