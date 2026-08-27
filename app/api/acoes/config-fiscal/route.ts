import { NextRequest } from "next/server";
import { requireUser } from "@/lib/supabase/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { ok, fail, handleError } from "@/lib/api";
import { lerConfigFiscal } from "@/lib/fiscal";
import { defaultMunicipalServiceCode } from "@/lib/asaas";

export const dynamic = "force-dynamic";

/**
 * Configuração fiscal que **não** é datada — `RF-61`, N2.
 *
 * ⚖️ **Por que não virou recurso do CRUD genérico.** `config_fiscal` é uma
 * linha só, com `id = 1` fixo. O CRUD de `lib/resources.ts` cria e apaga por
 * id; apontá-lo para uma tabela singleton daria ao formulário o poder de criar
 * uma segunda configuração fiscal — e duas linhas aqui significam que ninguém
 * sabe qual código de serviço a nota vai levar.
 *
 * ⛔ **E por que ela não tem vigência, ao contrário das retenções.** O código
 * de serviço municipal muda quando o município troca de tabela, não por
 * competência: não existe "a nota de junho usava o código antigo" no sentido
 * em que existe "a nota de junho usava a alíquota antiga". Versionar aqui seria
 * cerimônia sem auditoria a proteger. A assimetria é decisão declarada de
 * `RF-61`, não esquecimento.
 */

/** O que está valendo hoje — e **de onde vem**, que é o que a tela declara. */
export async function GET() {
  try {
    await requireUser();
    const config = await lerConfigFiscal();
    const doAmbiente = defaultMunicipalServiceCode() ?? null;

    return ok({
      config,
      // `RNF-19` — todo número declara sua fonte. Sem isto, o manager cadastra
      // o código, não vê efeito, e não tem como descobrir que o ambiente
      // nunca estava sendo usado (ou que ainda está).
      fonte: config?.municipal_service_code ? "cadastro" : doAmbiente ? "ambiente" : "ausente",
      fallback_do_ambiente: doAmbiente,
    });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = (await req.json()) as {
      municipal_service_code?: string | null;
      municipal_service_id?: string | null;
      municipal_service_name?: string | null;
    };

    const limpa = (v: string | null | undefined) => {
      const s = (v ?? "").trim();
      return s === "" ? null : s;
    };

    const supabase = createSupabaseAdmin();
    const { data, error } = await supabase
      .from("config_fiscal")
      .upsert(
        {
          id: 1,
          municipal_service_code: limpa(body.municipal_service_code),
          municipal_service_id: limpa(body.municipal_service_id),
          municipal_service_name: limpa(body.municipal_service_name),
          atualizado_por: user?.email ?? null,
          atualizado_em: new Date().toISOString(),
        },
        // ⛔ `onConflict` explícito: sem ele o upsert vira insert e a segunda
        // gravação estoura na primary key em vez de atualizar a linha.
        { onConflict: "id" }
      )
      .select()
      .single();

    if (error) return fail(error.message, 500);
    return ok({ ok: true, config: data });
  } catch (e) {
    return handleError(e);
  }
}
