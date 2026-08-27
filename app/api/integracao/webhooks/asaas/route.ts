import { NextResponse } from "next/server";
import { after } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { autenticarAsaas, lerEnvelope } from "@/lib/asaas/webhook";
import { processarEvento, registrarEvento, saudeDaFila } from "@/lib/asaas/processar";

export const dynamic = "force-dynamic";

/**
 * `POST /api/integracao/webhooks/asaas` — a entrada do gateway no financeiro.
 *
 * ⚖️ **Rota dedicada, e no domínio do ScopeFinance.** As duas coisas, pelos
 * dois motivos que o §0.1 do plano mede:
 *
 *   · **Domínio** — a URL cadastrada até 28/08/2026 apontava para a
 *     *Dashboard*. O Asaas alimenta o *financeiro*; o dado chegava no sistema
 *     que não é dono dele.
 *   · **Handler** — aquela rota valida `X-Hub-Signature-256` (HMAC sobre o
 *     corpo, segredo do ScopeFinance). O Asaas manda `asaas-access-token` e
 *     **nenhum HMAC**. Medido: toda entrega recebia `401`. E `401` está fora
 *     da faixa 2xx — `RN-AS-04`, 15 falhas consecutivas pausam a fila;
 *     `RN-AS-05`, o evento é retido 14 dias e depois apagado em definitivo.
 *
 * ⛔ **Não reaproveite `/api/integracao/eventos`** (que recebe da Dashboard)
 * nem nenhuma outra. Dois formatos no mesmo handler significam que a falha de
 * um derruba o outro — e o dado de negócio morre junto com o de monitoramento.
 *
 * ─────────────────────────────────────────────────────────────────────
 * **A ordem, que é a regra `RN-AS-03` e não uma preferência:**
 *
 *   1. valida o token                    (`RN-AS-01`)
 *   2. **grava o payload cru**           (`RN-AS-02` — idempotente pelo banco)
 *   3. **responde 200**                  (`RN-AS-06`)
 *   4. processa depois, em `after()`     (§4.5)
 *
 * Processar dentro da requisição aumenta o risco de timeout, e timeout vira
 * falha de entrega, que vira fila pausada. O `after()` mantém a função viva
 * **depois** da resposta — é a mesma mecânica que a ponte Dashboard → Finance
 * já usa em produção, não um padrão novo. A rede de segurança dele é o cron
 * de `/api/cron/asaas`, que varre o que ficou `pending`.
 */
export async function POST(req: Request) {
  const veredito = autenticarAsaas(
    process.env.ASAAS_WEBHOOK_TOKEN ?? null,
    req.headers.get("asaas-access-token")
  );

  if (!veredito.ok) {
    // ⚠️ **A única resposta fora de 2xx desta rota, e ela é deliberada.**
    // `RN-AS-06` fala de erro de PAYLOAD: payload estranho se grava e se
    // responde 200. Token que não confere é outra coisa — é uma requisição
    // que não veio do Asaas, e aceitá-la deixaria o endpoint aberto para
    // qualquer um escrever no financeiro (`RN-AS-01`).
    //
    // ⛔ O risco que isto cria é real e tem nome: se o token do painel for
    // cadastrado errado, TODA entrega recebe 401 e a fila pausa em 15. As
    // duas defesas são `GET` nesta mesma rota (que diz se o token está
    // provisionado, sem revelá-lo) e o alerta de silêncio do §4.9.
    console.error("[asaas] entrega recusada:", veredito.motivo);
    return NextResponse.json({ erro: veredito.motivo }, { status: veredito.status });
  }

  // A partir daqui, NADA pode produzir resposta fora de 2xx.
  const bruto = await req.text();

  let corpo: unknown;
  try {
    corpo = bruto ? JSON.parse(bruto) : null;
  } catch {
    // Corpo ilegível: 200 mesmo assim. Devolver 400 para o Asaas é
    // tecnicamente correto e operacionalmente suicida — 15 payloads
    // estranhos seguidos e a fila do financeiro para.
    console.error("[asaas] corpo não é JSON:", bruto.slice(0, 200));
    return NextResponse.json({ recebido: true, processado: false, motivo: "corpo não é JSON" });
  }

  const leitura = lerEnvelope(corpo);
  if (!leitura.ok) {
    console.error("[asaas] envelope inválido:", leitura.motivo);
    return NextResponse.json({ recebido: true, processado: false, motivo: leitura.motivo });
  }

  const env = leitura.envelope;
  const supabase = createSupabaseAdmin();

  const registro = await registrarEvento(supabase, env);

  if (registro.erro) {
    // Nem gravar deu. Ainda assim 200 — o Asaas reentrega (`at least once`) e
    // a próxima tentativa provavelmente grava. Responder erro aqui gastaria
    // uma das 15 vidas da fila para relatar um problema nosso.
    console.error("[asaas] falha ao gravar evento", env.id, registro.erro);
    return NextResponse.json({ recebido: true, processado: false, motivo: "falha ao gravar" });
  }

  if (!registro.novo) {
    // `RN-AS-02`: reentrega do mesmo evento. Nenhuma regra de negócio roda de
    // novo — é isso que impede a receita de ser contada duas vezes.
    return NextResponse.json({ recebido: true, duplicado: true, evento: env.id });
  }

  // Só depois da resposta. O `after()` não atrasa o 200 e não pode derrubá-lo:
  // `processarEvento` nunca lança, por contrato.
  after(async () => {
    await processarEvento(createSupabaseAdmin(), env);
  });

  return NextResponse.json({ recebido: true, evento: env.id, tipo: env.event });
}

/**
 * `GET` na mesma URL — o "isto está plugado?" de quem configura o painel.
 *
 * ⚖️ Existe porque a configuração do webhook acontece numa tela de terceiro,
 * onde um token colado com um espaço a mais fica visualmente idêntico ao
 * certo. Sem esta rota, o primeiro sinal de token errado seria a fila pausada
 * — 15 entregas depois, com 14 dias de prazo correndo.
 *
 * ⛔ **Nunca devolve o token**, nem parte dele. Diz se existe, e o que a fila
 * tem recebido — que é o suficiente para distinguir "não plugado" de
 * "plugado e mudo".
 */
export async function GET() {
  const provisionado = Boolean(process.env.ASAAS_WEBHOOK_TOKEN);

  const base = {
    rota: "asaas",
    aceita: "POST com header asaas-access-token",
    provisionado,
    ajuda: provisionado
      ? "Cadastre esta URL no painel do Asaas com o MESMO token de ASAAS_WEBHOOK_TOKEN."
      : "Defina ASAAS_WEBHOOK_TOKEN no ambiente do ScopeFinance. É o token do webhook — NÃO é a API Key.",
  };

  if (!provisionado) return NextResponse.json(base);

  try {
    const fila = await saudeDaFila(createSupabaseAdmin());
    return NextResponse.json({ ...base, fila });
  } catch (e) {
    // Saúde que quebra não pode virar 500 numa rota que também é webhook: o
    // Asaas não chama o GET, mas quem depura chama, e um 500 aqui manda
    // procurar o problema no lugar errado.
    return NextResponse.json({
      ...base,
      fila: { erro: e instanceof Error ? e.message : "falha ao ler a caixa de entrada" },
    });
  }
}
