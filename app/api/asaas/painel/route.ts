import { requireUser } from "@/lib/supabase/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { ok, handleError } from "@/lib/api";
import { saldoAsaas, extratoAsaas, type Leitura } from "@/lib/asaas/conta";
import { lerResumoDeCartoes, nomesPorCustomerAsaas } from "@/lib/asaas/cartoes";

export const dynamic = "force-dynamic";

/**
 * `GET /api/asaas/painel` — o dinheiro real para a Dashboard interna.
 *
 * ⚖️ **Por que a Dashboard precisou de uma rota, e não de mais uma tabela.**
 * `app/(app)/page.tsx` é Client Component e somava `bancos.saldo` para exibir
 * "Saldo total". Em 02/09/2026 essa soma dava **R$ 429,47** com o gateway em
 * **R$ 13,79**. Trocar a fonte por uma cópia sincronizada só adiaria a
 * divergência; a rota lê do Asaas na hora, e é a **mesma** leitura que as
 * telas `/bancos` e `/cartoes` fazem — um número, uma origem (`RN-01`).
 *
 * ⛔ **Exige sessão** (`requireUser`), ao contrário de `/api/integracao/*`:
 * quem chama aqui é o próprio navegador de quem está logado, não a Scope
 * Dashboard externa. Uma rota que expõe saldo e nome de pagador sem sessão
 * seria a superfície mais cara do sistema.
 *
 * ⚠️ Cada bloco devolve `Leitura<T>`: falha vira `{ ok: false, erro }`, nunca
 * zero. Zero é uma afirmação sobre o dinheiro; falha é uma afirmação sobre a
 * rede, e a tela precisa saber qual das duas recebeu.
 */
export async function GET() {
  try {
    await requireUser();
    const supabase = createSupabaseAdmin();

    const [saldo, extrato, cartoes] = await Promise.all([
      envolver(() => saldoAsaas()),
      envolver(() => extratoAsaas(5)),
      nomesPorCustomerAsaas(supabase).then((nomes) => lerResumoDeCartoes(nomes)),
    ]);

    return ok({
      saldo,
      extrato,
      // A Dashboard só precisa dos totais e dos cartões de maior volume — a
      // lista inteira é assunto da tela `/cartoes`.
      cartoes: cartoes.ok
        ? { ok: true as const, valor: { total: cartoes.valor.total, topo: cartoes.valor.cartoes.slice(0, 5) } }
        : cartoes,
      lido_em: new Date().toISOString(),
    });
  } catch (e) {
    return handleError(e);
  }
}

async function envolver<T>(o: () => Promise<T>): Promise<Leitura<T>> {
  try {
    return { ok: true, valor: await o() };
  } catch (e) {
    const erro = e instanceof Error ? e.message : "falha ao consultar o Asaas";
    console.error("[api/asaas/painel]", erro);
    return { ok: false, erro };
  }
}
