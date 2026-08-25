import { NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { verificarEntregaDaDashboard } from "@/lib/integracao/auth";
import { estadoIntegracao } from "@/lib/integracao/config";
import { aplicarEvento } from "@/lib/integracao/sincronia";
import type { Envelope } from "@/lib/integracao/contrato";

export const dynamic = "force-dynamic";

/**
 * `POST /api/integracao/eventos` — **o consumidor de `cliente.criado`.**
 *
 * Este é o trabalho que o Gate G0 nomeou em 21/08/2026 (Ponto 7, decisão
 * `D-21`) e que até 25/08/2026 não existia: *"não existe uma linha sequer
 * sobre webhook no ScopeFinance"*. Enquanto não existiu, todo cliente
 * cadastrado na Dashboard era um cliente que o financeiro não tinha — e a
 * divergência não disparava erro em lugar nenhum.
 *
 * ⚠️ **Não usa a chave de API, e sim a assinatura.** São coisas diferentes:
 * a chave prova *quem* chama, a assinatura prova que *o corpo não mudou no
 * caminho*. Aceitar evento por chave deixaria qualquer um com a chave de
 * leitura escrever no cadastro de clientes.
 *
 * Responde **200 mesmo quando ignora** o evento. A Dashboard trata não-2xx
 * como falha e reenfileira; um `cliente.criado` de perfil comercial (que não
 * tem efeito aqui) ficaria batendo até o dead-letter. O que ela precisa saber
 * é "recebi e resolvi", e o motivo vai no corpo para quem for auditar.
 */
export async function POST(req: Request) {
  const bruto = await req.text();

  const veredito = verificarEntregaDaDashboard(
    estadoIntegracao().webhookSecret,
    req.headers,
    bruto
  );
  if (!veredito.ok) {
    return NextResponse.json(
      { error: `Entrega recusada: ${veredito.motivo}` },
      { status: veredito.status }
    );
  }

  let envelope: Envelope;
  try {
    envelope = JSON.parse(bruto) as Envelope;
  } catch {
    return NextResponse.json({ error: "Corpo não é JSON válido" }, { status: 400 });
  }
  if (!envelope?.id || !envelope?.evento) {
    return NextResponse.json(
      { error: "Envelope inválido: exige `id` e `evento` (03 §4.2 da Dashboard)" },
      { status: 400 }
    );
  }

  const r = await aplicarEvento(createSupabaseAdmin(), envelope);

  // Erro de aplicação é 5xx de propósito: aí sim a Dashboard deve reenfileirar.
  // Um documento em conflito não se resolve sozinho, mas continuar tentando
  // mantém o evento vivo até alguém resolver — perdê-lo seria pior.
  if (r.estado === "erro") {
    return NextResponse.json({ recebido: true, ...r }, { status: 500 });
  }
  return NextResponse.json({ recebido: true, ...r });
}
