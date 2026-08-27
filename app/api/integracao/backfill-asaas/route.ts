import { NextRequest } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import {
  backfillAssinaturas,
  backfillClientes,
  backfillClientesOrfaos,
  backfillCobrancas,
  backfillNotas,
  religarOrfaos,
  type Etapa,
} from "@/lib/asaas/backfill";
import { ok, fail, handleError } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `GET /api/integracao/backfill-asaas?etapa=…&offset=…&seco=true`
 *
 * Traz para cá o que o gateway já sabia antes de o webhook existir.
 *
 * ⚖️ **Por que uma rota e não um script.** O ScopeFinance não tem `tsx` nem
 * `server-only` instalados, e adicioná-los para rodar um script seria trocar
 * duas dependências novas por uma conveniência. Mais importante: a rota
 * reaproveita **o mesmo `lib/asaas/mapear.ts` que o webhook usa**. Um script
 * com tradução própria criaria duas versões da mesma verdade, e a divergência
 * só apareceria meses depois — num relatório em que a cobrança importada e a
 * recebida ao vivo não batem, sem ninguém saber qual das duas está certa.
 *
 * ⛔ **Uma etapa e uma página por chamada, de propósito.** São 180 cobranças e
 * 51 notas, cada uma com ida e volta ao banco para resolver vínculo. Uma
 * função serverless que tenta tudo de uma vez esbarra no teto de duração e
 * morre no meio — deixando metade importada, que é o pior estado possível: nem
 * o antes, nem o depois, e nada que diga onde parou. Com `proximo_offset` na
 * resposta, quem chama retoma exatamente de onde ficou.
 *
 * ⚖️ **A ordem das etapas não é arbitrária.** `clientes` primeiro, porque as
 * outras três resolvem `cliente_id` por vínculo já gravado; `religar` por
 * último, para pegar o que o webhook tenha gravado órfão no meio do caminho.
 *
 *   clientes → assinaturas → cobrancas → notas → clientes-orfaos → religar
 *
 * `clientes-orfaos` vem DEPOIS das cobranças de propósito: ela descobre quem
 * importar lendo as linhas que ficaram sem dono, e por isso precisa que elas
 * já existam.
 *
 * ⚠️ **Rode com `seco=true` antes.** A passada seca lê tudo, decide tudo,
 * reporta os conflitos e **não grava nada**. É a única forma de saber o que a
 * importação faria com dado real antes de ela fazer.
 */
export async function GET(req: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET;
    const auth = req.headers.get("authorization");
    if (secret && auth !== `Bearer ${secret}`) return fail("Não autorizado", 401);

    const url = new URL(req.url);
    const etapa = (url.searchParams.get("etapa") ?? "clientes") as Etapa;
    const offset = Number(url.searchParams.get("offset") ?? 0) || 0;
    const limite = Number(url.searchParams.get("limite") ?? 0) || undefined;
    // ⛔ O default é SECO. Um parâmetro esquecido não pode ser o que grava em
    // produção — o esquecimento tem de errar para o lado que não escreve.
    const seco = url.searchParams.get("seco") !== "false";

    const supabase = createSupabaseAdmin();

    switch (etapa) {
      case "clientes":
        return ok(await backfillClientes(supabase, { offset, limite, seco }));
      case "clientes-orfaos":
        return ok(await backfillClientesOrfaos(supabase, { seco }));
      case "assinaturas":
        return ok(await backfillAssinaturas(supabase, { offset, limite, seco }));
      case "cobrancas":
        return ok(await backfillCobrancas(supabase, { offset, limite, seco }));
      case "notas":
        return ok(await backfillNotas(supabase, { offset, limite, seco }));
      case "religar":
        return ok(await religarOrfaos(supabase, seco));
      default:
        return fail(
          `etapa "${etapa}" não existe — use clientes | clientes-orfaos | assinaturas | cobrancas | notas | religar`,
          400
        );
    }
  } catch (e) {
    return handleError(e);
  }
}
