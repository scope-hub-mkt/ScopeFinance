"use client";

import { useEffect, useState } from "react";

/**
 * O dinheiro real do Asaas para a Dashboard — 02/09/2026.
 *
 * ⚖️ **Por que um hook próprio e não mais uma chave no store.** O store de
 * `lib/store.tsx` é o CRUD de tabelas do Supabase: tudo ali é `GET
 * /api/<recurso>` e tem `create`/`update`/`remove`. Saldo do gateway não é
 * recurso — não se cria, não se edita, e principalmente **não se guarda**.
 * Enfiá-lo no store convidaria a primeira pessoa que precisasse do número a
 * gravá-lo em algum lugar, que é exatamente como nasceu o saldo de R$ 429,47
 * que esta mudança removeu.
 *
 * ⚠️ **`erro` e `null` são coisas diferentes na saída, de propósito.**
 * `saldo === null` durante o carregamento significa *ainda não sei*; `erro`
 * preenchido significa *perguntei e não obtive resposta*. A tela mostra "—" nos
 * dois casos e a `fonte` do KPI diz qual dos dois é — nunca `R$ 0,00`, que
 * seria uma afirmação sobre o caixa da empresa.
 */

export interface LinhaExtratoUI {
  id: string;
  data: string;
  descricao: string;
  valor: number;
}

export interface CartaoUI {
  chave: string;
  bandeira: string;
  final: string | null;
  liquidado: number;
  cobrancas: number;
}

export interface PainelAsaasUI {
  carregando: boolean;
  erro: string | null;
  saldo: number | null;
  extrato: LinhaExtratoUI[];
  cartoes: CartaoUI[];
}

type Leitura<T> = { ok: true; valor: T } | { ok: false; erro: string };

interface Resposta {
  saldo: Leitura<number>;
  extrato: Leitura<LinhaExtratoUI[]>;
  cartoes: Leitura<{ topo: CartaoUI[] }>;
}

export function usePainelAsaas(): PainelAsaasUI {
  const [estado, setEstado] = useState<PainelAsaasUI>({
    carregando: true,
    erro: null,
    saldo: null,
    extrato: [],
    cartoes: [],
  });

  useEffect(() => {
    // ⛔ `AbortController` porque esta leitura é lenta (vai ao gateway) e a
    // navegação para outra tela antes da resposta chamaria `setState` num
    // componente já desmontado.
    const corte = new AbortController();

    (async () => {
      try {
        const r = await fetch("/api/asaas/painel", {
          signal: corte.signal,
          cache: "no-store",
        });
        if (!r.ok) {
          const corpo = await r.json().catch(() => null);
          throw new Error(corpo?.error || `o servidor respondeu ${r.status}`);
        }
        const d = (await r.json()) as Resposta;

        setEstado({
          carregando: false,
          // O erro que a tela mostra é o do saldo: é o número central desta
          // leitura, e repetir três motivos diferentes no mesmo card confunde
          // mais do que informa. Cada bloco cai sozinho no que exibe.
          erro: d.saldo.ok ? null : d.saldo.erro,
          saldo: d.saldo.ok ? d.saldo.valor : null,
          extrato: d.extrato.ok ? d.extrato.valor : [],
          cartoes: d.cartoes.ok ? d.cartoes.valor.topo : [],
        });
      } catch (e) {
        if (corte.signal.aborted) return;
        setEstado({
          carregando: false,
          erro: e instanceof Error ? e.message : "falha ao ler o Asaas",
          saldo: null,
          extrato: [],
          cartoes: [],
        });
      }
    })();

    return () => corte.abort();
  }, []);

  return estado;
}
