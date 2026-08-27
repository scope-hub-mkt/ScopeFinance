import { NextRequest } from "next/server";
import { requireUser } from "@/lib/supabase/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { ok, fail, handleError } from "@/lib/api";
import { CICLOS_EMBUTIDOS, lerCiclos, type RegraVencimento } from "@/lib/ciclos";

export const dynamic = "force-dynamic";

/**
 * Ciclos de recorrência cadastráveis — `RF-63`, N2.
 *
 * ⚖️ **Por que rota própria e não o CRUD genérico de `lib/resources.ts`.**
 * O CRUD genérico grava o que recebe. Aqui há três invariantes que, violadas,
 * produzem cobrança errada em silêncio — e silêncio é o modo de falha que
 * este projeto trata como pior:
 *
 *   1. `dia-fixo` **sem** `dia` é um ciclo que não sabe quando vence.
 *   2. `meses` fora de 1–120 gera avanço absurdo ou laço travado no
 *      `MAX_CICLOS` do motor.
 *   3. `chave` duplicada torna indeterminado de quantos meses é o ciclo.
 *
 * O banco também trava as três (`check` + `unique`), de propósito: a UI não é
 * o único caminho de escrita. A rota existe para devolver **mensagem que se
 * lê** em vez de erro de constraint.
 */

const REGRAS: RegraVencimento[] = ["mesmo-dia", "dia-fixo", "ultimo-dia"];

/** A lista efetiva — embutidos + cadastrados —, dizendo a origem de cada um. */
export async function GET() {
  try {
    await requireUser();
    const supabase = createSupabaseAdmin();
    const ciclos = await lerCiclos(supabase);

    return ok({
      ciclos,
      // `RNF-19` — todo número declara sua fonte. Sem isto, o manager cadastra
      // um ciclo, não vê efeito, e não descobre que a tabela não foi aplicada.
      embutidos: CICLOS_EMBUTIDOS.map((c) => c.chave),
      fonte: ciclos.some((c) => !c.embutido) ? "cadastro" : "embutidos",
    });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = (await req.json()) as {
      id?: string;
      chave?: string;
      nome?: string;
      meses?: number | string;
      regra_vencimento?: string;
      dia?: number | string | null;
      ativo?: boolean;
    };

    // `mensal `, `MENSAL` e `mensal` seriam três ciclos distintos numa coluna
    // `unique` — normalizar aqui é o que faz a trava do banco valer.
    const chave = String(body.chave ?? "").trim().toLowerCase();
    if (!chave) return fail("A chave do ciclo é obrigatória.", 400);
    if (!/^[a-z0-9-]+$/.test(chave)) {
      return fail("A chave aceita apenas letras minúsculas, números e hífen.", 400);
    }

    const meses = Number(body.meses);
    if (!Number.isInteger(meses) || meses < 1 || meses > 120) {
      return fail("Meses deve ser um inteiro entre 1 e 120.", 400);
    }

    const regra = String(body.regra_vencimento ?? "mesmo-dia") as RegraVencimento;
    if (!REGRAS.includes(regra)) {
      return fail(`Regra de vencimento inválida. Use: ${REGRAS.join(", ")}.`, 400);
    }

    const dia = body.dia == null || body.dia === "" ? null : Number(body.dia);
    if (regra === "dia-fixo" && (dia == null || !Number.isInteger(dia) || dia < 1 || dia > 31)) {
      return fail("A regra 'dia-fixo' exige um dia entre 1 e 31.", 400);
    }
    if (dia != null && (dia < 1 || dia > 31)) {
      return fail("O dia deve estar entre 1 e 31.", 400);
    }

    const supabase = createSupabaseAdmin();
    const linha = {
      chave,
      nome: String(body.nome ?? "").trim() || chave,
      meses,
      regra_vencimento: regra,
      // ⛔ `dia` só é gravado quando a regra o usa: um `dia` pendurado numa
      // regra 'ultimo-dia' faria a tela mostrar um número que não tem efeito.
      dia: regra === "dia-fixo" ? dia : null,
      ativo: body.ativo !== false,
      atualizado_por: user?.email ?? null,
      atualizado_em: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("ciclos_recorrencia")
      .upsert(linha, { onConflict: "chave" })
      .select()
      .single();

    if (error) return fail(error.message, 500);
    return ok({ ok: true, ciclo: data });
  } catch (e) {
    return handleError(e);
  }
}

/**
 * Remove um ciclo cadastrado.
 *
 * ⚠️ Remover um cadastro que **sobrepunha** um embutido devolve o embutido —
 * não deixa as assinaturas daquele ciclo órfãs. Remover um ciclo próprio
 * (`semestral`) faz as assinaturas dele caírem em mensal, que é o fallback
 * declarado de `resolverCiclo`: cobra a mais, e **visivelmente**, em vez de
 * parar de gerar conta em silêncio.
 */
export async function DELETE(req: NextRequest) {
  try {
    await requireUser();
    const chave = new URL(req.url).searchParams.get("chave");
    if (!chave) return fail("Informe a chave do ciclo.", 400);

    const supabase = createSupabaseAdmin();
    const { error } = await supabase.from("ciclos_recorrencia").delete().eq("chave", chave);
    if (error) return fail(error.message, 500);

    return ok({ ok: true, restaurado_embutido: CICLOS_EMBUTIDOS.some((c) => c.chave === chave) });
  } catch (e) {
    return handleError(e);
  }
}
