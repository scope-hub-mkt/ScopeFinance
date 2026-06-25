import { NextRequest } from "next/server";
import { requireUser } from "@/lib/supabase/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { isResource, sanitizeInput } from "@/lib/resources";
import { ok, fail, handleError } from "@/lib/api";

export const dynamic = "force-dynamic";

// PATCH /api/<recurso>/<id> — atualiza
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ resource: string; id: string }> }
) {
  try {
    await requireUser();
    const { resource, id } = await params;
    if (!isResource(resource)) return fail("Recurso inválido", 404);
    const body = (await req.json()) as Record<string, unknown>;
    const input = sanitizeInput(resource, body);
    const supabase = createSupabaseAdmin();
    const { data, error } = await supabase
      .from(resource)
      .update(input)
      .eq("id", id)
      .select()
      .single();
    if (error) return fail(error.message, 500);
    return ok(data);
  } catch (e) {
    return handleError(e);
  }
}

// DELETE /api/<recurso>/<id> — remove
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ resource: string; id: string }> }
) {
  try {
    await requireUser();
    const { resource, id } = await params;
    if (!isResource(resource)) return fail("Recurso inválido", 404);
    const supabase = createSupabaseAdmin();
    const { error } = await supabase.from(resource).delete().eq("id", id);
    if (error) return fail(error.message, 500);
    return ok({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
