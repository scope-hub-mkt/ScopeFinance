import { NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { rotaIntegracao } from "@/lib/integracao/rota";
import { clienteParaContrato, type LinhaCliente } from "@/lib/integracao/contrato";

export const dynamic = "force-dynamic";

/**
 * `GET /api/integracao/clientes` — o cadastro deste lado, no formato que a
 * Dashboard consome (`ClienteFinance` em `lib/scopefinance.ts` de lá).
 *
 * A troca de nome `id` → `cliente_id` não é enfeite: é o contrato de lá, e
 * respeitá-lo aqui é o que dispensa qualquer adaptador do lado da Dashboard.
 *
 * ♻️ **Desde 04/09/2026 devolve `cliente_desde`** (`D-107`): a data da primeira
 * cobrança do cliente. Nenhum `created_at` serve para isso — os 31 clientes
 * deste banco nasceram no mesmo minuto da importação do Asaas, e a Dashboard
 * estava exibindo essa data como se fosse desde quando a relação existe.
 */
export const GET = rotaIntegracao(async () => {
  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase
    .from("clientes")
    .select("id, nome, doc, email, tel, status, status_cadastro")
    .order("nome");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // ⚖️ **Uma consulta a mais, não N.** Um `min(vencimento)` por cliente seriam
  // 31 idas ao banco numa rota que hoje faz uma; agrupar em memória custa uma
  // varredura das cobranças e mantém a rota em duas consultas fixas,
  // independentemente do tamanho da carteira.
  //
  // ⛔ **Sem `origem_lancamento` filtrada aqui, de propósito.** `RN-51`/`D-100`
  // mandam a ponte entregar só fato nascido no gateway, e isso vale para
  // DINHEIRO. Esta coluna não é dinheiro, é data de início de relação: se um
  // recebível manual é a cobrança mais antiga que existe de um cliente, ele é
  // a melhor evidência de quando essa relação começou, e descartá-lo faria a
  // tela mostrar uma data mais recente do que a verdade.
  const { data: cobrancas, error: erroCobrancas } = await supabase
    .from("contas_receber")
    .select("cliente_id, vencimento")
    .not("cliente_id", "is", null)
    .not("vencimento", "is", null);

  // ⚠️ Falha aqui NÃO derruba a rota: sem a agregação, `cliente_desde` volta
  // `null` e a Dashboard cai no comportamento anterior. Uma coluna a menos é
  // muito melhor que o cadastro inteiro indisponível.
  const primeiro = new Map<string, string>();
  if (!erroCobrancas) {
    for (const c of cobrancas ?? []) {
      const id = c.cliente_id as string;
      const v = String(c.vencimento).slice(0, 10);
      const atual = primeiro.get(id);
      if (!atual || v < atual) primeiro.set(id, v);
    }
  }

  const linhas = ((data ?? []) as LinhaCliente[]).map((c) => ({
    ...c,
    primeiro_vencimento: primeiro.get(c.id) ?? null,
  }));

  return NextResponse.json(linhas.map(clienteParaContrato));
});