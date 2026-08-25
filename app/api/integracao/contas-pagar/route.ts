import { NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { rotaIntegracao, recusa } from "@/lib/integracao/rota";
import { today } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * `POST /api/integracao/contas-pagar` — a comissão aprovada na Dashboard
 * vira despesa aqui (`RF-38` / `RN-14` de lá).
 *
 * **Idempotente por `referencia_externa`.** A Dashboard tem escada de retry;
 * sem esta garantia, um timeout de rede que na verdade gravou lançaria a
 * mesma comissão duas vezes — e ninguém notaria até o fechamento do mês.
 * Repetição devolve **200 com a linha original**, não 201 e não erro: quem
 * repete precisa saber que o efeito existe, não que houve conflito.
 *
 * ⚠️ `fornecedor` é `not null` neste banco e a Dashboard não o mandava.
 * Aceitamos derivá-lo da descrição em vez de recusar: recusar mandaria a
 * comissão para a fila de retry até esgotar, e o erro só apareceria no
 * dead-letter de lá.
 */
export const POST = rotaIntegracao(async (req) => {
  let corpo: Record<string, unknown>;
  try {
    corpo = (await req.json()) as Record<string, unknown>;
  } catch {
    return recusa("Corpo não é JSON válido", 400);
  }

  const descricao = typeof corpo.descricao === "string" ? corpo.descricao.trim() : "";
  const valor = Number(corpo.valor);
  if (!descricao) return recusa("Campo obrigatório: descricao", 400);
  if (!Number.isFinite(valor) || valor <= 0) {
    return recusa("Campo obrigatório: valor (numérico, maior que zero)", 400);
  }

  const referencia =
    typeof corpo.referencia_externa === "string" && corpo.referencia_externa.trim()
      ? corpo.referencia_externa.trim()
      : null;

  const supabase = createSupabaseAdmin();

  // Consulta antes de inserir: o caminho comum do retry não deveria depender
  // de provocar uma violação de constraint para descobrir o que já existe.
  if (referencia) {
    const { data: existente } = await supabase
      .from("contas_pagar")
      .select("id")
      .eq("referencia_externa", referencia)
      .maybeSingle();
    if (existente) {
      return NextResponse.json({ ...existente, repetido: true }, { status: 200 });
    }
  }

  const registro = {
    fornecedor:
      (typeof corpo.fornecedor === "string" && corpo.fornecedor.trim()) ||
      descricao.split("—").pop()?.trim() ||
      "Dashboard",
    descricao,
    valor,
    vencimento: typeof corpo.vencimento === "string" ? corpo.vencimento : today(),
    categoria: typeof corpo.categoria === "string" ? corpo.categoria : "Comissão",
    status: "Pendente",
    referencia_externa: referencia,
  };

  const { data, error } = await supabase
    .from("contas_pagar")
    .insert(registro)
    .select("id")
    .single();

  if (error) {
    // Corrida entre dois retries simultâneos: o perdedor encontra a linha do
    // vencedor e devolve o mesmo id. É o desfecho certo — o efeito é único.
    if (error.code === "23505" && referencia) {
      const { data: existente } = await supabase
        .from("contas_pagar")
        .select("id")
        .eq("referencia_externa", referencia)
        .maybeSingle();
      if (existente) return NextResponse.json({ ...existente, repetido: true }, { status: 200 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
});
