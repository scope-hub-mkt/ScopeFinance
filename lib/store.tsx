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
import type {
  Assinatura,
  Banco,
  Cartao,
  Cliente,
  ContaPagar,
  ContaReceber,
  Contrato,
  Lancamento,
  NotaFiscal,
} from "./types";

export interface DB {
  clientes: Cliente[];
  contratos: Contrato[];
  assinaturas: Assinatura[];
  contas_receber: ContaReceber[];
  contas_pagar: ContaPagar[];
  lancamentos: Lancamento[];
  bancos: Banco[];
  cartoes: Cartao[];
  notas_fiscais: NotaFiscal[];
}

export type ResourceKey = keyof DB;

const EMPTY: DB = {
  clientes: [],
  contratos: [],
  assinaturas: [],
  contas_receber: [],
  contas_pagar: [],
  lancamentos: [],
  bancos: [],
  cartoes: [],
  notas_fiscais: [],
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
  create: <K extends ResourceKey>(key: K, data: Record<string, unknown>) => Promise<void>;
  update: <K extends ResourceKey>(key: K, id: string, data: Record<string, unknown>) => Promise<void>;
  remove: (key: ResourceKey, id: string) => Promise<void>;
  pagar: (opts: {
    tabela: "contas_receber" | "contas_pagar";
    id: string;
    conta_id?: string | null;
    data?: string;
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const notify = useCallback((msg: string, type: ToastType = "info") => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  const refresh = useCallback(
    async (key?: ResourceKey) => {
      const keys = key ? [key] : RESOURCE_KEYS;
      const results = await Promise.all(
        keys.map(async (k) => [k, await apiFetch<unknown[]>(`/api/${k}`)] as const)
      );
      setDb((prev) => {
        const next = { ...prev } as DB;
        for (const [k, rows] of results) {
          (next as unknown as Record<string, unknown[]>)[k] = rows;
        }
        return next;
      });
    },
    []
  );

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setLoading(true);
        await refresh();
        if (active) setError(null);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Erro ao carregar dados");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [refresh]);

  const create = useCallback<StoreCtx["create"]>(
    async (key, data) => {
      try {
        await apiFetch(`/api/${key}`, { method: "POST", body: JSON.stringify(data) });
        await refresh(key);
        notify("Registro criado.", "ok");
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
        await refresh("lancamentos");
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
      db, loading, error, refresh, create, update, remove,
      pagar, gerarRecorrencias, emitirNF, getCN, getBN, notify,
    }),
    [db, loading, error, refresh, create, update, remove, pagar, gerarRecorrencias, emitirNF, getCN, getBN, notify]
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
