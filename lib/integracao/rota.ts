import "server-only";
import { NextResponse } from "next/server";
import { autenticarChave } from "./auth";
import { estadoIntegracao } from "./config";

/**
 * A guarda única das rotas `/api/integracao/*`.
 *
 * ⚠️ **Por que estas rotas não usam `requireUser()`** como o resto da API: o
 * chamador é a Scope Dashboard, um servidor — não existe cookie de sessão do
 * lado dela. Autenticar por sessão aqui equivaleria a não expor a integração.
 *
 * Em compensação, a superfície é **estreita de propósito**: só as leituras que
 * a Dashboard consome e um único POST. O CRUD genérico (`/api/[resource]`)
 * continua exigindo sessão, e nenhuma chave de integração abre caminho para
 * ele — é o que impede a chave de virar acesso irrestrito ao banco.
 */

export function recusa(motivo: string, status: number) {
  return NextResponse.json({ error: motivo }, { status });
}

export type Guardado<T> = { ok: true; valor: T } | { ok: false; resposta: NextResponse };

/** Confere a chave da Dashboard; devolve a resposta pronta quando recusa. */
export function exigirChave(req: Request): Guardado<null> {
  const veredito = autenticarChave(
    estadoIntegracao().apiKey,
    req.headers.get("authorization")
  );
  if (!veredito.ok) {
    return { ok: false, resposta: recusa(veredito.motivo, veredito.status) };
  }
  return { ok: true, valor: null };
}

/**
 * Envolve o handler com a guarda e com a conversão de exceção em JSON.
 *
 * O erro vai para o log com o caminho, e para a resposta sem detalhe interno:
 * quem chama precisa saber que falhou, não a mensagem do Postgres.
 */
export function rotaIntegracao(handler: (req: Request) => Promise<NextResponse>) {
  return async (req: Request): Promise<NextResponse> => {
    const guarda = exigirChave(req);
    if (!guarda.ok) return guarda.resposta;
    try {
      return await handler(req);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[integracao]", new URL(req.url).pathname, e);
      return recusa("Erro interno ao atender a integração", 500);
    }
  };
}
