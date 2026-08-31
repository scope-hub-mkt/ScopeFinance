"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { apurarCarga, resumoDeFalhas, type Falha } from "./carga";
import type {
  Assinatura,
  Banco,
  Cartao,
  Cliente,
  ContaPagar,
  ContaReceber,
  Contrato,
  ContratoServico,
  Lancamento,
  NotaFiscal,
  RetencaoFiscal,
} from "./types";

export interface DB {
  clientes: Cliente[];
  contratos: Contrato[];
  contrato_servicos: ContratoServico[];
  assinaturas: Assinatura[];
  contas_receber: ContaReceber[];
  contas_pagar: ContaPagar[];
  lancamentos: Lancamento[];
  bancos: Banco[];
  cartoes: Cartao[];
  notas_fiscais: NotaFiscal[];
  retencoes_fiscais: RetencaoFiscal[];
}

export type ResourceKey = keyof DB;

const EMPTY: DB = {
  clientes: [],
  contratos: [],
  contrato_servicos: [],
  assinaturas: [],
  contas_receber: [],
  contas_pagar: [],
  lancamentos: [],
  bancos: [],
  cartoes: [],
  notas_fiscais: [],
  retencoes_fiscais: [],
};

const RESOURCE_KEYS = Object.keys(EMPTY) as ResourceKey[];

async function apiFetch<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error((data && data.error) || `Erro ${res.status}`);
  }
  return data as T;
}

type ToastType = "ok" | "err" | "info";
interface Toast {
  id: number;
  msg: string;
  type: ToastType;
}

interface StoreCtx {
  db: DB;
  loading: boolean;
  error: string | null;
  refresh: (key?: ResourceKey) => Promise<void>;
  /**
   * Carrega só o que ainda não veio — a porta da carga sob demanda (`D-91`).
   * Chamar de novo com a mesma chave não repete a busca.
   */
  garantir: (...keys: ResourceKey[]) => Promise<void>;
  /** Recarrega tudo do zero, com o mesmo ciclo de loading/erro da carga inicial. */
  recarregar: () => Promise<void>;
  /** Recursos que não responderam na última carga — degradação, não queda. */
  falhas: Falha[];
  /**
   * Cria e **devolve a linha gravada** — a API sempre a devolveu; o store é
   * que a descartava. Quem precisa do `id` recém-gerado (para pendurar filhos
   * nele, como os serviços de um contrato) não tem outra forma de obtê-lo sem
   * reler a lista inteira e adivinhar qual é o novo.
   */
  create: <K extends ResourceKey>(
    key: K,
    data: Record<string, unknown>
  ) => Promise<Record<string, unknown> | undefined>;
  update: <K extends ResourceKey>(key: K, id: string, data: Record<string, unknown>) => Promise<void>;
  remove: (key: ResourceKey, id: string) => Promise<void>;
  pagar: (opts: {
    tabela: "contas_receber" | "contas_pagar";
    id: string;
    conta_id?: string | null;
    data?: string;
    /** Só receber — o que entrou de fato (base da comissão da Dashboard). */
    valor_pago?: number;
    /** Só receber — tributos/taxas retidos (`RN-04`: a base é líquida). */
    deducoes?: number;
    registrar_lancamento?: boolean;
  }) => Promise<void>;
  gerarRecorrencias: () => Promise<{ geradas: number; receber: number; pagar: number }>;
  emitirNF: (opts: {
    conta_receber_id?: string;
    cliente_id?: string;
    descricao_servico?: string;
    valor?: number;
    municipalServiceCode?: string;
  }) => Promise<void>;
  getCN: (id: string | null | undefined) => string;
  getBN: (id: string | null | undefined) => string;
  notify: (msg: string, type?: ToastType) => void;
}

const Ctx = createContext<StoreCtx | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [db, setDb] = useState<DB>(EMPTY);
  // ⚖️ **Começa FALSO, não verdadeiro** (`D-91`). Antes, o provider nascia
  // carregando porque ele de fato buscava tudo ao montar; agora quem carrega é
  // a tela, declarando o que precisa. Nascer `true` deixaria uma página sem
  // recurso nenhum (Integração, por exemplo) presa no spinner para sempre.
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [falhas, setFalhas] = useState<Falha[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  /** O que esta sessão já pediu — a base do `loading` e do `recarregar`. */
  const pedidos = useRef<Set<ResourceKey>>(new Set());
  /** O que já chegou (com sucesso ou com falha declarada). */
  const chegados = useRef<Set<ResourceKey>>(new Set());
  /** Buscas em voo, por recurso — dedupe de montagens simultâneas e do
   *  efeito duplo do modo estrito do React. */
  const emVoo = useRef<Map<ResourceKey, Promise<void>>>(new Map());

  const notify = useCallback((msg: string, type: ToastType = "info") => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  /**
   * Busca um conjunto de recursos e funde no `db`. É o motor por trás de
   * `refresh` e de `garantir` — uma passada só, `allSettled`, para um recurso
   * quebrado degradar a tela em vez de apagá-la (ver `lib/carga.ts`).
   */
  const buscar = useCallback(async (keys: ResourceKey[]) => {
    const resultados = await Promise.allSettled(
      keys.map((k) => apiFetch<unknown[]>(`/api/${k}`))
    );
    const { dados, falhas: novas, queda } = apurarCarga(keys, resultados);

    setDb((prev) => {
      const next = { ...prev } as DB;
      for (const [k, rows] of dados) {
        (next as unknown as Record<string, unknown[]>)[k] = rows;
      }
      return next;
    });

    // As falhas dos recursos que ACABARAM de ser pedidos substituem as
    // anteriores; as dos que não entraram nesta passada continuam valendo.
    setFalhas((antes) => [
      ...antes.filter((f) => !keys.includes(f.recurso as ResourceKey)),
      ...novas,
    ]);

    // Chegou é chegou, mesmo com falha: a falha está declarada em `falhas`, e
    // marcar como pendente faria a tela tentar para sempre, em laço.
    for (const k of keys) chegados.current.add(k);

    if (queda) throw new Error(resumoDeFalhas(novas));
  }, []);

  const refresh = useCallback<StoreCtx["refresh"]>(
    async (key) => {
      // Sem chave: recarrega o que esta sessão já pediu — não as 10 tabelas.
      const keys = key ? [key] : [...pedidos.current];
      if (keys.length === 0) return;
      await buscar(keys);
    },
    [buscar]
  );

  /**
   * **A carga sob demanda** — `D-91` (30/08/2026).
   *
   * ⚠️ **O que ela substitui.** O provider buscava `RESOURCE_KEYS` inteiro num
   * `useEffect` de montagem: 10 requisições, cada uma trazendo uma tabela
   * completa com todas as colunas, **em toda navegação** — inclusive em
   * `/bancos`, que usa uma só, e em `/integracao`, que não usa nenhuma.
   *
   * ⛔ **Recurso já pedido não é pedido de novo.** O dedupe é por `emVoo` e
   * `chegados`, e não por dependência de efeito: o modo estrito do React monta
   * duas vezes em desenvolvimento, e sem isto toda tela pagaria a busca
   * dobrada — o tipo de custo que só aparece na conta do fim do mês.
   */
  const garantir = useCallback<StoreCtx["garantir"]>(
    async (...keys) => {
      for (const k of keys) pedidos.current.add(k);
      const faltando = keys.filter(
        (k) => !chegados.current.has(k) && !emVoo.current.has(k)
      );

      if (faltando.length === 0) {
        // Pode haver busca em voo pedida por outro componente: esperar por ela
        // é o que faz dois componentes irmãos resolverem juntos, em vez de um
        // deles seguir com a lista vazia.
        const esperando = keys
          .map((k) => emVoo.current.get(k))
          .filter((p): p is Promise<void> => Boolean(p));
        if (esperando.length) await Promise.allSettled(esperando);
        return;
      }

      setLoading(true);
      const busca = (async () => {
        try {
          await buscar(faltando);
          setError(null);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Erro ao carregar dados");
        }
      })();
      for (const k of faltando) emVoo.current.set(k, busca);

      try {
        await busca;
      } finally {
        for (const k of faltando) emVoo.current.delete(k);
        setLoading(false);
      }
    },
    [buscar]
  );

  /**
   * A carga inicial e o botão "Tentar novamente" são a MESMA função.
   *
   * Antes, falhar aqui era beco sem saída: a tela ficava no erro e a única
   * saída era o F5. Como a falha que mais aparece é transitória (o `PGRST303`
   * tratado em lib/supabase/retentativa.ts, que sobrevive a quatro tentativas
   * do servidor só num dia ruim), não oferecer a segunda chance transformava
   * um soluço de 2s numa página morta.
   */
  const carregar = useCallback(async () => {
    // ⚠️ Recarrega **o que esta sessão pediu**, não o catálogo inteiro de
    // recursos: repetir a carga completa aqui recriaria, no botão, o custo que
    // acabou de sair da montagem.
    try {
      setLoading(true);
      await refresh();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar dados");
    } finally {
      setLoading(false);
    }
  }, [refresh]);

  // ⛔ **Aqui havia o `useEffect` que buscava as 10 tabelas ao montar** — e o
  // provider mora em `AppFrame`, então isso acontecia em TODA navegação do
  // sistema, inclusive nas telas que usam uma tabela só ou nenhuma. Foi o
  // defeito que o dono nomeou em 30/08/2026 (`D-91`): *"o /clientes do
  // ScopeFinance continua baixando tudo no navegador"*.
  //
  // Agora quem carrega é a tela, declarando o que precisa com `useRecursos`.
  // Não há efeito de montagem no provider: um provider que busca sozinho é um
  // provider que não dá para a tela escolher.

  const create = useCallback<StoreCtx["create"]>(
    async (key, data) => {
      try {
        const criado = await apiFetch<Record<string, unknown>>(`/api/${key}`, {
          method: "POST",
          body: JSON.stringify(data),
        });
        await refresh(key);
        notify("Registro criado.", "ok");
        return criado;
      } catch (e) {
        notify(e instanceof Error ? e.message : "Erro ao criar", "err");
        throw e;
      }
    },
    [refresh, notify]
  );

  const update = useCallback<StoreCtx["update"]>(
    async (key, id, data) => {
      try {
        await apiFetch(`/api/${key}/${id}`, { method: "PATCH", body: JSON.stringify(data) });
        await refresh(key);
        notify("Registro atualizado.", "ok");
      } catch (e) {
        notify(e instanceof Error ? e.message : "Erro ao atualizar", "err");
        throw e;
      }
    },
    [refresh, notify]
  );

  const remove = useCallback<StoreCtx["remove"]>(
    async (key, id) => {
      try {
        await apiFetch(`/api/${key}/${id}`, { method: "DELETE" });
        // remoções podem afetar saldo (lançamentos) → recarrega bancos também
        await refresh(key);
        if (key === "lancamentos") await refresh("bancos");
        notify("Registro excluído.", "ok");
      } catch (e) {
        notify(e instanceof Error ? e.message : "Erro ao excluir", "err");
        throw e;
      }
    },
    [refresh, notify]
  );

  const pagar = useCallback<StoreCtx["pagar"]>(
    async (opts) => {
      try {
        await apiFetch(`/api/acoes/pagar`, { method: "POST", body: JSON.stringify(opts) });
        await refresh(opts.tabela);
        // A tela de Lançamentos saiu; o que a baixa muda e continua na tela é o saldo.
        await refresh("bancos");
        notify("Baixa registrada.", "ok");
      } catch (e) {
        notify(e instanceof Error ? e.message : "Erro ao dar baixa", "err");
        throw e;
      }
    },
    [refresh, notify]
  );

  const gerarRecorrencias = useCallback<StoreCtx["gerarRecorrencias"]>(async () => {
    try {
      const r = await apiFetch<{ geradas: number; receber: number; pagar: number }>(
        `/api/acoes/gerar-recorrencias`,
        { method: "POST" }
      );
      await refresh("contas_receber");
      await refresh("contas_pagar");
      await refresh("assinaturas");
      notify(
        r.geradas > 0
          ? `${r.geradas} conta(s) gerada(s): ${r.receber} a receber, ${r.pagar} a pagar.`
          : "Nenhuma cobrança pendente para gerar.",
        "ok"
      );
      return r;
    } catch (e) {
      notify(e instanceof Error ? e.message : "Erro ao gerar recorrências", "err");
      throw e;
    }
  }, [refresh, notify]);

  const emitirNF = useCallback<StoreCtx["emitirNF"]>(
    async (opts) => {
      try {
        await apiFetch(`/api/acoes/emitir-nf`, { method: "POST", body: JSON.stringify(opts) });
        await refresh("notas_fiscais");
        await refresh("clientes");
        notify("Nota fiscal solicitada ao Asaas.", "ok");
      } catch (e) {
        notify(e instanceof Error ? e.message : "Erro ao emitir NF", "err");
        throw e;
      }
    },
    [refresh, notify]
  );

  const getCN = useCallback(
    (id: string | null | undefined) => db.clientes.find((c) => c.id === id)?.nome || "—",
    [db.clientes]
  );
  const getBN = useCallback(
    (id: string | null | undefined) => db.bancos.find((b) => b.id === id)?.nome || "—",
    [db.bancos]
  );

  const value = useMemo<StoreCtx>(
    () => ({
      db, loading, error, falhas, refresh, garantir, recarregar: carregar, create, update, remove,
      pagar, gerarRecorrencias, emitirNF, getCN, getBN, notify,
    }),
    [db, loading, error, falhas, refresh, garantir, carregar, create, update, remove, pagar, gerarRecorrencias, emitirNF, getCN, getBN, notify]
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toast-host" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>
            {t.msg}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useStore() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useStore deve ser usado dentro de <StoreProvider>");
  return ctx;
}

/**
 * **A tela declara o que precisa** — `D-91` (30/08/2026).
 *
 * ⚖️ **É a metade que torna a carga sob demanda utilizável.** `garantir` sem
 * este gancho obrigaria cada página a montar o próprio `useEffect` com a lista
 * de dependências certa — e a página que errasse a lista buscaria em laço, ou
 * não buscaria nunca. Aqui a dependência é a lista de chaves **ordenada e
 * serializada**, que é estável entre renders mesmo com o array literal que a
 * chamada naturalmente escreve.
 *
 * ```tsx
 * const { db } = useStore();
 * useRecursos("clientes", "contratos");   // só estes dois saem do servidor
 * ```
 *
 * ⛔ Não devolve nada de propósito: quem lê continua lendo `db`, e uma segunda
 * forma de acessar o mesmo dado seria a porta para as duas divergirem.
 */
export function useRecursos(...keys: ResourceKey[]): void {
  const { garantir } = useStore();
  const assinatura = [...keys].sort().join(",");
  useEffect(() => {
    void garantir(...(assinatura.split(",").filter(Boolean) as ResourceKey[]));
    // `assinatura` é a identidade real do pedido; o array literal de `keys`
    // muda de referência a cada render e faria o efeito rodar para sempre.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assinatura, garantir]);
}
