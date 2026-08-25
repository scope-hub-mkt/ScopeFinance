import { NextRequest } from "next/server";
import { requireUser } from "@/lib/supabase/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { ok, fail, handleError } from "@/lib/api";
import { today } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Dá baixa em uma conta a receber/pagar.
 * body: {
 *   tabela: "contas_receber" | "contas_pagar",
 *   id: string,
 *   conta_id?: string,                // conta bancária da liquidação
 *   data?: string,                    // data do pagamento (default hoje)
 *   valor_pago?: number,              // o que entrou de fato (só receber)
 *   deducoes?: number,                // tributos/taxas retidos (só receber)
 *   registrar_lancamento?: boolean    // cria lançamento no caixa (default: true se houver conta_id)
 * }
 *
 * ⚠️ **`valor_pago` e `deducoes` decidem a comissão da Dashboard** (`RN-04`
 * de lá: a base é líquida). Quem dá a baixa raramente pensa nisso — por isso
 * os dois campos têm default seguro (`valor` cobrado e zero) e a tela explica
 * o efeito, em vez de exigir o número.
 */
export async function POST(req: NextRequest) {
  try {
    await requireUser();
    const body = (await req.json()) as {
      tabela?: string;
      id?: string;
      conta_id?: string | null;
      data?: string;
      valor_pago?: number | string | null;
      deducoes?: number | string | null;
      registrar_lancamento?: boolean;
    };

    const { tabela, id } = body;
    if (tabela !== "contas_receber" && tabela !== "contas_pagar") {
      return fail("tabela inválida", 400);
    }
    if (!id) return fail("id obrigatório", 400);

    const supabase = createSupabaseAdmin();
    const pagoEm = body.data || today();
    const contaId = body.conta_id ?? null;
    const registrar = body.registrar_lancamento ?? !!contaId;

    const updatePayload: Record<string, unknown> = { status: "Pago", pago_em: pagoEm };
    if (contaId) updatePayload.conta_id = contaId;

    // Só contas a receber carregam base de comissão. Deduções em conta a
    // pagar não significariam nada — a Scope não retém imposto de si mesma.
    if (tabela === "contas_receber") {
      const pago = numeroOuNulo(body.valor_pago);
      const deducoes = numeroOuNulo(body.deducoes);
      if (pago !== null) {
        if (pago < 0) return fail("valor_pago não pode ser negativo", 400);
        updatePayload.valor_pago = pago;
      }
      if (deducoes !== null) {
        if (deducoes < 0) return fail("deducoes não pode ser negativo", 400);
        updatePayload.deducoes = deducoes;
      }
    }

    const { data: conta, error: upErr } = await supabase
      .from(tabela)
      .update(updatePayload)
      .eq("id", id)
      .select()
      .single();
    if (upErr) return fail(upErr.message, 500);

    // Opcional: registra o movimento no caixa (o trigger ajusta o saldo do banco).
    // Entra o que ENTROU, não o que foi cobrado — senão o saldo do banco
    // divergiria do extrato sempre que houvesse desconto ou pagamento parcial.
    let lancamento = null;
    if (registrar && contaId) {
      const tipo = tabela === "contas_receber" ? "entrada" : "saida";
      const categoria =
        tabela === "contas_receber"
          ? "Serviço"
          : (conta as { categoria?: string }).categoria || "Outros";
      const valorLancado =
        tabela === "contas_receber"
          ? Number((conta as { valor_pago?: number | null; valor: number }).valor_pago ??
              (conta as { valor: number }).valor)
          : (conta as { valor: number }).valor;

      const { data: lanc, error: lancErr } = await supabase
        .from("lancamentos")
        .insert({
          tipo,
          descricao: (conta as { descricao?: string }).descricao || "Baixa",
          valor: valorLancado,
          data: pagoEm,
          categoria,
          conta_id: contaId,
          origem: tabela === "contas_receber" ? "receber" : "pagar",
          origem_id: id,
        })
        .select()
        .single();
      if (lancErr) return fail(lancErr.message, 500);
      lancamento = lanc;
    }

    return ok({ ok: true, conta, lancamento });
  } catch (e) {
    return handleError(e);
  }
}

/** `""`/ausente → null (não mexe na coluna); número inválido → null também. */
function numeroOuNulo(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
