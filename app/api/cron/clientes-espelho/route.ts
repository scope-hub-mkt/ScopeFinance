import { NextRequest } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { enfileirarEvento, entregarFila } from "@/lib/integracao/sincronia";
import { ok, fail, handleError } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Reconciliação do cadastro de clientes **daqui para a Dashboard**.
 *
 * ⚠️ **Por que precisou existir, medido em 28/08/2026.** O ScopeFinance tinha
 * **35 clientes** e a Dashboard **13** — 28 nunca atravessaram. E a fila de
 * saída estava **vazia**: não era entrega travada, era evento que nunca foi
 * gerado.
 *
 * A causa é a mesma em dois lugares:
 *
 * | Origem | Quantos | Por quê |
 * |---|---|---|
 * | `asaas` | 26 | o backfill escreveu **direto no banco**, sem passar por quem emite |
 * | `crm` | 2 | criados antes de `replicarParaDashboard` existir |
 *
 * ⛔ **É o mesmo defeito de sempre, na terceira variação do dia:** o caminho
 * novo cuida do que acontece de agora em diante, e nada cuida do que já
 * estava lá. Um sistema que só replica o futuro deixa os dois lados
 * divergentes **para sempre**, e a divergência não acende luz nenhuma — a
 * Dashboard simplesmente mostra menos clientes, com cara de estar certa.
 *
 * ⚖️ **É reconciliação, não migração de uma vez.** A Dashboard faz `upsert`
 * por `id` (`ESTADO §8.4`), então reemitir é idempotente: conserta o que
 * faltou e não toca no que já está lá. Serve também para o dia em que um
 * evento esgotar as 5 tentativas e cair no dead-letter.
 *
 * ⛔ **Não replica cliente com `origem = 'dashboard'`** — ele nasceu lá.
 * Reemitir seria mandar de volta o que veio de lá, e é assim que um cadastro
 * fica indo e voltando para sempre (`ESTADO §8.5`, supressão de eco).
 *
 * Protegida por `CRON_SECRET`.
 */
export async function GET(req: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET;
    const auth = req.headers.get("authorization");
    if (secret && auth !== `Bearer ${secret}`) return fail("Não autorizado", 401);

    const supabase = createSupabaseAdmin();

    const { data, error } = await supabase
      .from("clientes")
      .select("id, nome, doc, email, tel, status, origem")
      .neq("origem", "dashboard")
      .limit(5000);

    if (error) return fail(error.message, 500);
    const clientes = (data ?? []) as Array<Record<string, unknown>>;

    let emitidos = 0;
    for (const c of clientes) {
      const id = await enfileirarEvento(supabase, "cliente.criado", {
        cliente_id: c.id,
        nome: c.nome,
        doc: c.doc,
        email: c.email,
        tel: c.tel,
        // ⚠️ `status` VIAJA aqui, e é de propósito. `ESTADO §5.5` proíbe o
        // consumidor de **inventar** um padrão quando o campo não vem — não
        // proíbe o dono do campo de enviá-lo. Quem é dono do status é este
        // sistema, e omiti-lo faria a Dashboard receber cliente inativo sem
        // saber que é inativo.
        status: c.status,
        fonte: "scopefinance",
      });
      if (id) emitidos++;
    }

    // ⛔ Enfileirar não é entregar — a lição que custou três defeitos num dia
    // só. A fila é drenada aqui, em lote maior que a quantidade emitida.
    const entrega = emitidos ? await entregarFila(supabase, emitidos + 10) : null;

    return ok({
      ok: true,
      no_cadastro: clientes.length,
      emitidos,
      entrega,
    });
  } catch (e) {
    return handleError(e);
  }
}
