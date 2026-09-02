import { NextRequest, after } from "next/server";
import { requireUser } from "@/lib/supabase/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { isResource, sanitizeInput, RESOURCES } from "@/lib/resources";
import { ok, fail, handleError } from "@/lib/api";
import { today } from "@/lib/format";
import { enfileirarEvento, entregarFila } from "@/lib/integracao/sincronia";
import { apagarSnapshots } from "@/lib/etl/snapshot";

export const dynamic = "force-dynamic";

/** Os recursos que só podem existir para um cliente de identidade conferida. */
const EXIGEM_CADASTRO_EFETIVO = new Set(["contas_receber", "assinaturas", "notas_fiscais"]);

/**
 * Recusa, com motivo, a criação de cobrança/assinatura/nota para cliente cuja
 * identidade ainda não foi conferida.
 *
 * Devolve `null` quando pode seguir — inclusive quando não há `cliente_id`,
 * porque conta sem cliente é caso legítimo aqui (despesa avulsa, conta que
 * espera conciliação) e não é isto que esta guarda protege.
 */
async function bloqueadoPorCadastroProvisorio(
  supabase: ReturnType<typeof createSupabaseAdmin>,
  resource: string,
  input: Record<string, unknown>
): Promise<string | null> {
  if (!EXIGEM_CADASTRO_EFETIVO.has(resource)) return null;
  const clienteId = input.cliente_id;
  if (typeof clienteId !== "string" || !clienteId) return null;

  const { data } = await supabase
    .from("clientes")
    .select("nome, status_cadastro")
    .eq("id", clienteId)
    .maybeSingle();

  const alvo = data as { nome: string; status_cadastro: string } | null;
  if (!alvo || alvo.status_cadastro === "efetivo") return null;

  // ⚠️ A mensagem aponta para **Clientes**, e não mais para uma fila própria:
  // a tela "Em revisão" foi removida em 02/09/2026. Uma recusa que manda a
  // pessoa a uma tela inexistente é pior que uma recusa seca — ela bloqueia e
  // ainda dá o caminho errado para desbloquear.
  return alvo.status_cadastro === "em_conflito"
    ? `"${alvo.nome}" está EM CONFLITO: o documento dele pertence a outro cadastro. ` +
        `Resolva o cadastro em Clientes antes de cobrar — cobrar agora emitiria nota ` +
        `contra uma identidade que ninguém confirmou, e isso não se desfaz.`
    : `"${alvo.nome}" é um cadastro PROVISÓRIO: falta o CPF/CNPJ. ` +
        `Complete o documento em Clientes antes de gerar cobrança — ` +
        `a nota fiscal é emitida contra o documento, e emiti-la errada é irreversível.`;
}

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

    // ⛔ **Nunca crie cobrança para cliente provisório** (§2.3 / §16, regra 14).
    //
    // ⚖️ Esta é a trava que torna o estado provisório REAL. Sem ela, ele seria
    // um rótulo bonito que não protege de nada: bastaria alguém emitir a
    // cobrança pela tela e o cadastro sem identidade conferida entraria no
    // financeiro do mesmo jeito — e, com a cobrança, viria a nota fiscal.
    // **Emitir nota contra a identidade errada não se desfaz.**
    //
    // A recusa é declarada e diz o caminho: quem está cadastrando descobre o
    // que fazer, em vez de receber um erro de banco.
    const bloqueio = await bloqueadoPorCadastroProvisorio(supabase, resource, input);
    if (bloqueio) return fail(bloqueio, 409);
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

    // `D-91` — quem escreve derruba o retrato do recurso. Sem isto, a tela
    // de Clientes mostraria a lista antiga até o TTL vencer: o pior sintoma
    // de cache, "salvei e não mudou", que some sozinho e ninguém reproduz.
    await apagarSnapshots(`${resource}:`);

    return ok(data, 201);
  } catch (e) {
    return handleError(e);
  }
}
