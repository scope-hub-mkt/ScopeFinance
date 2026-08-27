import { NextRequest } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { processarPendentes, saudeDaFila } from "@/lib/asaas/processar";
import { ok, fail, handleError } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * A rede de segurança do webhook do Asaas — §4.5 e §4.9 do plano.
 *
 * Faz duas coisas, e as duas existem por falharem de jeitos diferentes:
 *
 *   1. **Varre o que ficou `pending` ou `failed`.** Em serverless a função
 *      morre ao responder; o `after()` da rota a mantém viva depois do `200`,
 *      mas não promete sobreviver a um encerramento abrupto da instância.
 *      Sem esta varredura, um evento gravado e não processado ficaria
 *      `pending` para sempre — e `pending` não acende luz nenhuma.
 *
 *   2. **Mede o silêncio.** Se nenhum evento chega há muito tempo, alguma
 *      coisa parou: a fila pausou (`RN-AS-04`), ou a URL do painel mudou. É a
 *      mesma classe de defeito do §0.1 — a integração morre, a tela fica
 *      verde, e ninguém descobre por dias. **Ausência de dado tem que ser um
 *      sinal ativo**, porque silêncio se parece demais com "está tudo calmo".
 *
 * ⚠️ **Cadência.** O plano Hobby da Vercel entrega cron uma vez por dia, o
 * que é rede de segurança aceitável e **não** é caminho principal para
 * pagamento (o §4.5 diz isso com todas as letras). Por isso quem chama esta
 * rota de verdade é um workflow do GitHub Actions a cada 15 minutos — lá a
 * granularidade é de minutos e não custa nada. A Vercel continua chamando
 * junto com `/api/cron/integracao`, como terceira camada.
 *
 * Protegida por `CRON_SECRET`, como as demais: uma rota que reprocessa
 * evento financeiro não pode ficar aberta.
 */
export async function GET(req: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET;
    const auth = req.headers.get("authorization");
    if (secret && auth !== `Bearer ${secret}`) return fail("Não autorizado", 401);

    const supabase = createSupabaseAdmin();
    const varredura = await processarPendentes(supabase);
    const fila = await saudeDaFila(supabase);

    // O alerta vai para o log com nível de erro de propósito: é o que a
    // Vercel destaca e o que um monitor externo consegue pescar sem que
    // ninguém precise abrir uma tela.
    if (fila.alerta) console.error("[asaas][ALERTA]", fila.motivo);

    return ok({ ok: true, varredura, fila });
  } catch (e) {
    return handleError(e);
  }
}
