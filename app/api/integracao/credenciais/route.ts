import { NextRequest } from "next/server";
import { requireUser } from "@/lib/supabase/auth";
import { ok, fail, handleError } from "@/lib/api";
import {
  estadoDasCredenciais,
  removerCredencial,
  renomearCredencial,
  salvarCredencial,
  tabelaDisponivel,
} from "@/lib/integracao/credenciais";

export const dynamic = "force-dynamic";

/**
 * Credenciais de integração — o "Gerenciar" do painel.
 *
 * ⚠️ **Exige sessão, não a chave da integração** — mesma razão de
 * `/testar` e `/sincronizar`: quem gerencia credencial é uma pessoa logada
 * aqui, e uma rota que troca segredo jamais pode ser acionável por credencial
 * de leitura.
 *
 * ⛔ **O valor nunca sai daqui.** `GET` devolve prefixo mascarado e origem; o
 * inteiro não trafega em nenhum sentido de leitura. Renomear move a linha no
 * servidor, justamente para o segredo não ter de dar a volta pelo navegador.
 */
export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const chaves = (req.nextUrl.searchParams.get("chaves") ?? "")
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    if (chaves.length === 0) return fail("Informe ?chaves=A,B,C", 400);
    return ok({
      editavel: await tabelaDisponivel(),
      credenciais: await estadoDasCredenciais(chaves),
    });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = (await req.json().catch(() => ({}))) as {
      acao?: "salvar" | "renomear" | "remover";
      chave?: string;
      valor?: string;
      novoNome?: string;
    };
    if (!body.chave) return fail("chave é obrigatória", 400);

    const r =
      body.acao === "renomear"
        ? await renomearCredencial(body.chave, body.novoNome ?? "", user.id)
        : body.acao === "remover"
          ? await removerCredencial(body.chave)
          : await salvarCredencial(body.chave, body.valor ?? "", user.id);

    return r.ok ? ok({ ok: true }) : fail(r.erro, 400);
  } catch (e) {
    return handleError(e);
  }
}
