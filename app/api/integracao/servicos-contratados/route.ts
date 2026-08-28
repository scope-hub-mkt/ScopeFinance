import { NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { rotaIntegracao } from "@/lib/integracao/rota";
import {
  servicosContratadosParaContrato,
  type LinhaAssinaturaContratada,
  type LinhaContrato,
} from "@/lib/integracao/contrato";

export const dynamic = "force-dynamic";

/**
 * `GET /api/integracao/servicos-contratados?ativos=1`
 *
 * **Quem contratou o quê** — a perna que faltava na ponte, medida em
 * 28/08/2026: a Dashboard tinha 36 clientes e 5 serviços no catálogo, e o tile
 * "Serviços mais contratados" mostrava zero em todas as linhas porque
 * `cliente_servicos` estava vazia do outro lado. O compromisso comercial mora
 * aqui — em `contratos` e `assinaturas` — e nada o atravessava.
 *
 * ⛔ **Não é `/vendas` com outro nome.** Lá a linha é a parcela; aqui é o
 * compromisso. Uma parcela chamada "Parcela 10 de 10." não diz qual serviço o
 * cliente tem, e é o serviço que a Dashboard precisa vincular.
 *
 * ⚖️ **O rótulo viaja como texto livre, de propósito.** Nem `contratos.servico`
 * nem `assinaturas.descricao` têm `servico_id`, e inventar aqui um palpite de
 * qual item do catálogo cada texto significa colocaria a decisão no lado
 * errado: **o catálogo é da Dashboard** (`servicos_espelho` é espelho dela,
 * não fonte). Quem casa rótulo com serviço é ela, com mapa que o dono edita.
 *
 * `?ativos=1` filtra para os compromissos vivos. Sem o parâmetro vem tudo,
 * com `ativo` declarado em cada linha — encerrar do outro lado depende de
 * enxergar o que morreu.
 */
export const GET = rotaIntegracao(async (req: Request) => {
  const somenteAtivos = new URL(req.url).searchParams.get("ativos") === "1";
  const supabase = createSupabaseAdmin();

  // Tetos declarados pela mesma doutrina de `/vendas`: folga de ordens de
  // grandeza sobre o volume real (3 contratos e 13 assinaturas hoje), não
  // aperto sobre o caso normal.
  const [rc, ra] = await Promise.all([
    supabase
      .from("contratos")
      .select("id, cliente_id, servico, valor, freq, categoria, inicio, fim, status")
      .limit(5_000),
    supabase
      .from("assinaturas")
      .select("id, direcao, cliente_id, descricao, plano, valor, ciclo, inicio, fim, status")
      .limit(5_000),
  ]);

  // ⛔ Erro vira erro, nunca lista vazia — a lição do `L-84`. Uma consulta que
  // quebra e responde `200 []` faz "quebrou" e "nenhum cliente contratou nada"
  // ficarem indistinguíveis, e é exatamente essa confusão que a Dashboard
  // acabou de pagar por um dia inteiro.
  const erro = rc.error ?? ra.error;
  if (erro) return NextResponse.json({ error: erro.message }, { status: 500 });

  const linhas = servicosContratadosParaContrato(
    (rc.data ?? []) as LinhaContrato[],
    (ra.data ?? []) as LinhaAssinaturaContratada[]
  );

  return NextResponse.json(somenteAtivos ? linhas.filter((l) => l.ativo) : linhas);
});
