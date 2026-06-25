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
 *   registrar_lancamento?: boolean    // cria lançamento no caixa (default: true se houver conta_id)
 * }
 */
export async function POST(req: NextRequest) {
  try {
    await requireUser();
    const body = (await req.json()) as {
      tabela?: string;
      id?: string;
      conta_id?: string | null;
      data?: string;
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

    // Atualiza a conta para "Pago"
    const updatePayload: Record<string, unknown> = { status: "Pago", pago_em: pagoEm };
    if (contaId) updatePayload.conta_id = contaId;

    const { data: conta, error: upErr } = await supabase
      .from(tabela)
      .update(updatePayload)
      .eq("id", id)
      .select()
      .single();
    if (upErr) return fail(upErr.message, 500);

    // Opcional: registra o movimento no caixa (o trigger ajusta o saldo do banco)
    let lancamento = null;
    if (registrar && contaId) {
      const tipo = tabela === "contas_receber" ? "entrada" : "saida";
      const categoria =
        tabela === "contas_receber"
          ? "Serviço"
          : (conta as { categoria?: string }).categoria || "Outros";
      const { data: lanc, error: lancErr } = await supabase
        .from("lancamentos")
        .insert({
          tipo,
          descricao: (conta as { descricao?: string }).descricao || "Baixa",
          valor: (conta as { valor: number }).valor,
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
