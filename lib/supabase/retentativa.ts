/**
 * A retentativa do `PGRST303` — "JWT issued at future".
 *
 * O que acontece: toda chamada ao PostgREST feita com a chave de serviço
 * (`sb_secret_…`) chega ao banco como um JWT recém-emitido pelo gateway do
 * Supabase. O PostgREST valida o `iat` desse token contra o próprio relógio,
 * com 30s de tolerância — e um defeito conhecido do cache de timestamp dele
 * (corrigido no PR #5159, versões 14.17 e 16.1) faz algumas threads validarem
 * contra um "agora" parado. O token nasce no futuro do ponto de vista de quem
 * o valida e a resposta volta 401 `{"code":"PGRST303"}`.
 *
 * Por que retentar é seguro: o `iat` é conferido ANTES de qualquer coisa
 * tocar o banco. Uma resposta com esta assinatura prova que a requisição não
 * executou — nem leitura, nem escrita. Retentar um POST aqui não duplica
 * nada, e é por isso que o gatilho é estreito de propósito: só este código,
 * só este status. Qualquer outro erro passa direto, sem segunda chance.
 *
 * Por que no `fetch` e não em cada consulta: são ~40 chamadas ao PostgREST
 * espalhadas por rotas, cron e webhook. Uma trava que dependesse de alguém
 * lembrar de embrulhar a consulta protegeria as que já existem e deixaria a
 * próxima desprotegida.
 */

/** Esperas entre as tentativas, em ms. O tamanho do array = nº de retentativas. */
export const ESPERAS_MS = [250, 750, 1500] as const;

/** O total que uma requisição pode ganhar de atraso no pior caso. */
export const ATRASO_MAXIMO_MS = ESPERAS_MS.reduce((a, b) => a + b, 0);

/**
 * Mensagem final, quando as quatro tentativas falham.
 *
 * A original — "JWT issued at future" — descreve o token, não o problema, e
 * manda quem lê procurar credencial errada onde não há nenhuma. Esta nomeia
 * a causa (relógio do PostgREST), o que já foi feito (as tentativas) e a
 * única ação que resolve de verdade (reiniciar o projeto no Supabase, que
 * reprovisiona o PostgREST corrigido).
 */
export const MENSAGEM_PGRST303 =
  `O banco recusou a credencial por relógio dessincronizado (PGRST303). ` +
  `Não é chave errada: o PostgREST do Supabase validou um token recém-emitido ` +
  `contra um relógio atrasado. Tentamos ${ESPERAS_MS.length + 1}x em ` +
  `${ATRASO_MAXIMO_MS}ms e todas falharam. Recarregue a página; se persistir, ` +
  `reinicie o projeto no painel do Supabase (Settings → General → Restart) ` +
  `para reprovisionar o PostgREST corrigido.`;

/** Assinatura do defeito: 401 do PostgREST com o código do `iat` no futuro. */
export function ehJwtNoFuturo(status: number, corpo: string): boolean {
  if (status !== 401) return false;
  return corpo.includes("PGRST303") || /JWT issued at future/i.test(corpo);
}

/**
 * Só retentamos o que dá para repetir sem inventar nada.
 *
 * `Request` e corpo em stream se consomem na primeira passada — repetir com
 * eles mandaria um corpo vazio, o que é pior que o erro que estamos tratando.
 */
function repetivel(input: unknown, init?: RequestInit): boolean {
  const alvoOk = typeof input === "string" || input instanceof URL;
  const corpo = init?.body;
  const corpoOk = corpo == null || typeof corpo === "string";
  return alvoOk && corpoOk;
}

const dormirDeVerdade = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Reescreve o corpo do PostgREST preservando `code`, trocando só a mensagem. */
function traduzir(resposta: Response, corpo: string): Response {
  let payload: Record<string, unknown>;
  try {
    payload = { ...(JSON.parse(corpo) as Record<string, unknown>) };
  } catch {
    payload = { code: "PGRST303" };
  }
  payload.message = MENSAGEM_PGRST303;
  payload.details = corpo.slice(0, 500);
  return new Response(JSON.stringify(payload), {
    status: resposta.status,
    statusText: resposta.statusText,
    headers: resposta.headers,
  });
}

/**
 * Embrulha um `fetch` para reagir ao `PGRST303`.
 *
 * `dormir` é injetável para o teste não gastar 2,5s de relógio de parede
 * provando que espera 2,5s.
 */
export function criarFetchComRetentativa(
  fetchBase: typeof fetch,
  dormir: (ms: number) => Promise<void> = dormirDeVerdade
): typeof fetch {
  return async function fetchComRetentativa(input, init) {
    let resposta = await fetchBase(input as never, init);

    // Só clonamos quando há chance de ser o defeito: ler o corpo de toda
    // resposta boa custaria memória em cima do caminho feliz.
    const suspeita = async (r: Response) =>
      r.status === 401 ? await r.clone().text() : null;

    let corpo = await suspeita(resposta);
    if (corpo === null || !ehJwtNoFuturo(resposta.status, corpo)) return resposta;
    if (!repetivel(input, init)) return traduzir(resposta, corpo);

    for (const espera of ESPERAS_MS) {
      await dormir(espera);
      resposta = await fetchBase(input as never, init);
      corpo = await suspeita(resposta);
      if (corpo === null || !ehJwtNoFuturo(resposta.status, corpo)) return resposta;
    }

    console.error("[supabase] PGRST303 persistiu após todas as tentativas", corpo);
    return traduzir(resposta, corpo);
  } as typeof fetch;
}
