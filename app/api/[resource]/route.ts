import { NextRequest, after } from "next/server";
import { requireUser } from "@/lib/supabase/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { isResource, sanitizeInput, RESOURCES } from "@/lib/resources";
import { ok, fail, handleError } from "@/lib/api";
import { today } from "@/lib/format";
import { enfileirarEvento, entregarFila } from "@/lib/integracao/sincronia";

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
    if (error) {
      // O índice único do documento (Gate G0 Ponto 1, `D-19`) precisa explicar
      // o que impediu — "duplicate key value violates unique constraint
      // ux_clientes_doc_norm" não diz nada a quem está cadastrando.
      if (error.code === "23505" && resource === "clientes") {
        return fail(
          "Já existe um cliente com este CPF/CNPJ. O documento é único (comparado só pelos dígitos).",
          409
        );
      }
      return fail(error.message, 500);
    }

    // Cliente nascido AQUI replica para a Dashboard — a via de volta da
    // decisão do dono de 25/08/2026. Cliente que chegou de lá tem
    // `origem = 'dashboard'` e não é reemitido: sem essa condição, o cadastro
    // ficaria em ping-pong entre os dois sistemas.
    if (resource === "clientes" && data?.origem !== "dashboard") {
      await enfileirarEvento(supabase, "cliente.criado", {
        cliente_id: data.id,
        nome: data.nome,
        doc: data.doc,
        email: data.email,
        tel: data.tel,
        status: data.status,
        fonte: "scopefinance",
      });
      // Entrega depois da resposta: quem cadastrou não espera a rede da
      // Dashboard, e a outbox garante o evento mesmo se esta passada falhar.
      after(() => entregarFila(supabase, 10));
    }

    return ok(data, 201);
  } catch (e) {
    return handleError(e);
  }
}
