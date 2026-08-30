import { NextRequest, after } from "next/server";
import { requireUser } from "@/lib/supabase/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { isResource, sanitizeInput } from "@/lib/resources";
import { ok, fail, handleError } from "@/lib/api";
import { apagarSnapshots } from "@/lib/etl/snapshot";
import { enfileirarEvento, entregarFila } from "@/lib/integracao/sincronia";

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
    if (error) {
      if (error.code === "23505" && resource === "clientes") {
        return fail(
          "Já existe um cliente com este CPF/CNPJ. O documento é único (comparado só pelos dígitos).",
          409
        );
      }
      return fail(error.message, 500);
    }

    // A edição também replica: os dois sistemas compartilham o cadastro, e
    // um nome corrigido aqui que não chega lá recria a divergência que a
    // replicação existe para fechar.
    if (resource === "clientes") {
      await enfileirarEvento(supabase, "cliente.atualizado", {
        cliente_id: data.id,
        nome: data.nome,
        doc: data.doc,
        email: data.email,
        tel: data.tel,
        status: data.status,
        fonte: "scopefinance",
      });
      after(() => entregarFila(supabase, 10));
    }

    // `D-91` — quem escreve derruba o retrato do recurso. Sem isto, a tela
    // de Clientes mostraria a lista antiga até o TTL vencer: o pior sintoma
    // de cache, "salvei e não mudou", que some sozinho e ninguém reproduz.
    await apagarSnapshots(`${resource}:`);

    return ok(data);
  } catch (e) {
    return handleError(e);
  }
}

/**
 * DELETE /api/<recurso>/<id> — remove.
 *
 * ⛔ **Exclusão de cliente NÃO replica para a Dashboard, de propósito.** Lá o
 * cliente pode ter venda, comissão e serviço pendurados; propagar o DELETE
 * transformaria uma limpeza de cadastro daqui em perda de histórico
 * comercial. A divergência que isso cria — cliente que existe lá e não aqui —
 * é fechada pela reconciliação, que **recria** o cadastro na próxima passada.
 *
 * Se a intenção for encerrar de verdade, o caminho é `status = "Inativo"`, que
 * replica normalmente pelo `cliente.atualizado`.
 */
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
    // `D-91` — quem escreve derruba o retrato do recurso. Sem isto, a tela
    // de Clientes mostraria a lista antiga até o TTL vencer: o pior sintoma
    // de cache, "salvei e não mudou", que some sozinho e ninguém reproduz.
    await apagarSnapshots(`${resource}:`);

    return ok({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
