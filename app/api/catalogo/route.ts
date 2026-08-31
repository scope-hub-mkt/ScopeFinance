import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { handleError } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * `GET /api/catalogo` — o espelho do catálogo, **somente leitura**, para as
 * telas que precisam oferecer "qual serviço é este?" num seletor.
 *
 * ⚖️ **Por que não entrou em `lib/resources.ts` como os outros.** A API
 * genérica de `[resource]` dá as quatro operações de uma vez: quem entra na
 * lista ganha `POST`, `PATCH` e `DELETE` junto. Declarar `columns: []` impede
 * a escrita de campo, mas **não impede o `DELETE`** — e apagar uma linha de
 * `servicos_espelho` daqui seria apagar, do lado errado, um item de um catálogo
 * cuja dona é a Dashboard. A linha voltaria na próxima sincronização, e no
 * meio-tempo toda cobrança que apontasse para ela ficaria sem serviço.
 *
 * Uma rota só de `GET` é a forma de dizer "isto se lê, não se escreve" de um
 * jeito que o roteador garante, e não a boa intenção de quem chama.
 *
 * ⛔ Inativos entram na resposta com `ativo: false`, em vez de sumirem: um
 * contrato antigo pode apontar para serviço encerrado, e a tela precisa saber
 * o nome dele para exibir — some da escolha, não da leitura.
 */
export async function GET() {
  try {
    await requireUser();
    const supabase = createSupabaseAdmin();
    const { data, error } = await supabase
      .from("servicos_espelho")
      .select("id, nome, slug, area, tipo_cobranca, preco_tabela, recorrencia, ativo")
      .order("ativo", { ascending: false })
      .order("nome")
      // Teto declarado: o catálogo real tem 20 itens (medido em 31/08/2026).
      // Mil é folga de ordens de grandeza, não aperto sobre o caso normal.
      .limit(1_000);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data ?? []);
  } catch (e) {
    return handleError(e);
  }
}
