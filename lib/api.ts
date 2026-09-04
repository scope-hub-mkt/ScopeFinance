import { NextResponse } from "next/server";
import { SemCadastroError, UnauthorizedError } from "./supabase/auth";

export function ok(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** Converte exceções em respostas JSON consistentes. */
export function handleError(e: unknown) {
  if (e instanceof UnauthorizedError) return fail("Não autenticado", 401);
  // Credencial boa, pessoa sem cadastro (ou desligada): 403 com o motivo.
  if (e instanceof SemCadastroError) return fail(e.message, 403);
  const msg = e instanceof Error ? e.message : "Erro interno";
  console.error("[api]", e);
  return fail(msg, 500);
}
