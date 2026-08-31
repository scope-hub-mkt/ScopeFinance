import { NextRequest } from "next/server";
import { requireUser } from "@/lib/supabase/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { ok, fail, handleError } from "@/lib/api";
import { apagarSnapshots } from "@/lib/etl/snapshot";

export const dynamic = "force-dynamic";

/** Um item como a tela o manda. `id` ausente = item novo. */
interface ItemEntrada {
  id?: string | null;
  servico_id?: string | null;
  descricao?: string | null;
  quantidade?: number | string | null;
  valor?: number | string | null;
  recorrencia?: string | null;
  obs?: string | null;
}

/**
 * `PUT /api/contratos/{id}/servicos` — **substitui a lista inteira** de
 * serviços de um contrato.
 *
 * ⚖️ **Por que existe, tendo a API CRUD genérica ao lado.** Salvar um contrato
 * de três serviços por ela são quatro requisições sem transação entre si: uma
 * falha na terceira deixa o contrato gravado com dois serviços, e o resultado
 * não é "incompleto", é **errado** — um contrato de R$ 3.000 exibindo R$ 2.000
 * em serviços, sem nada dizendo que faltou algo. A função
 * `definir_servicos_do_contrato` faz tudo numa transação só: ou os três ficam,
 * ou nenhum fica.
 *
 * ⛔ **É PUT, e o verbo está certo:** o corpo é a lista final, não um delta.
 * Item que estava lá e não vem no corpo é removido — é assim que a tela
 * consegue apagar uma linha sem uma segunda chamada, e é por isso que um
 * cliente parcial não deve usar esta rota.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireUser();
    const { id } = await params;

    const corpo = (await req.json()) as { itens?: unknown };
    if (!Array.isArray(corpo?.itens)) {
      return fail("Corpo inválido: esperado { itens: [...] }.", 400);
    }

    // Saneamento aqui, e não só no banco: a função aceita `jsonb` e confiaria
    // no que chegasse. Campo que a tela não deve escrever não vira coluna.
    const itens = (corpo.itens as ItemEntrada[]).map((i) => ({
      id: i.id ?? null,
      servico_id: i.servico_id ?? null,
      descricao: String(i.descricao ?? "").trim(),
      quantidade: Math.max(1, Math.trunc(Number(i.quantidade ?? 1)) || 1),
      valor: Number(i.valor ?? 0) || 0,
      recorrencia: i.recorrencia ?? null,
      obs: i.obs ?? null,
    }));

    // ⛔ Recusa ANTES de abrir a transação. O `check` do banco também barraria,
    // mas com "violates check constraint" — que não diz a quem cadastra o que
    // fazer. A regra é a mesma; a diferença é quem consegue agir sobre ela.
    const semNome = itens.findIndex((i) => !i.descricao);
    if (semNome >= 0) {
      return fail(
        `O serviço na posição ${semNome + 1} está sem descrição. ` +
          `Todo serviço precisa de um nome — é ele que aparece na cobrança.`,
        400
      );
    }

    const supabase = createSupabaseAdmin();
    const { data, error } = await supabase.rpc("definir_servicos_do_contrato", {
      p_contrato: id,
      p_itens: itens,
    });

    if (error) {
      // A função levanta esta mensagem quando o contrato não existe; 404 é a
      // resposta honesta, e não o 500 genérico que um erro de RPC viraria.
      if (error.message.includes("não existe")) return fail(error.message, 404);
      return fail(error.message, 500);
    }

    // `contratos.servico` é resumo mantido por gatilho: mudou o item, mudou o
    // contrato. Sem derrubar os dois retratos, a tela mostraria a lista velha
    // até o TTL vencer — o sintoma "salvei e não mudou" do `D-91`.
    await apagarSnapshots("contrato_servicos:");
    await apagarSnapshots("contratos:");

    return ok(data);
  } catch (e) {
    return handleError(e);
  }
}
