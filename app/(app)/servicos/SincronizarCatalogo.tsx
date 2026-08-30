"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * "Sincronizar agora" do catálogo — `D-90` (30/08/2026).
 *
 * ⚖️ **Por que ele fica NESTA tela, e não só em `/integracao`.** Quem percebe
 * que o espelho está velho é quem está olhando para o catálogo. Mandar essa
 * pessoa procurar outra tela para consertar o que ela está vendo é o mesmo
 * que não ter conserto — foi assim que 7 linhas `[DEMO]` ficaram dois dias na
 * tela depois de terem sido apagadas na Dashboard.
 *
 * ⛔ **É um botão, não um `setInterval`.** O caminho rápido já é o evento
 * empurrado pela Dashboard, que chega em segundos. Isto é a rede de segurança
 * — e rede de segurança que dispara sozinha a cada minuto vira custo fixo
 * para cobrir um caso raro.
 */
export function SincronizarCatalogo() {
  const router = useRouter();
  const [rodando, setRodando] = useState(false);
  const [resumo, setResumo] = useState<string | null>(null);
  const [erro, setErro] = useState(false);

  const sincronizar = async () => {
    setRodando(true);
    setResumo(null);
    setErro(false);
    try {
      const res = await fetch("/api/integracao/sincronizar", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      const c = body?.catalogo ?? {};
      if (c.motivo) {
        setErro(true);
        setResumo(String(c.motivo));
      } else {
        const partes = [
          c.criados ? `${c.criados} novo(s)` : null,
          c.atualizados ? `${c.atualizados} atualizado(s)` : null,
          // O que sumiu é dito pelo nome: "3 podados" não deixa ninguém
          // conferir se o que sumiu era o que devia sumir.
          c.podados ? `${c.podados} removido(s): ${(c.podados_nomes ?? []).join(", ")}` : null,
        ].filter(Boolean);
        setResumo(partes.length ? partes.join(" · ") : "Já estava em dia.");
      }
      router.refresh();
    } catch (e) {
      setErro(true);
      setResumo(e instanceof Error ? e.message : "Erro de rede");
    } finally {
      setRodando(false);
    }
  };

  return (
    <>
      {resumo && <span className={`tiny ${erro ? "c-red" : "muted"}`}>{resumo}</span>}
      <button className="btn" type="button" onClick={sincronizar} disabled={rodando}>
        <i className="ti ti-refresh" />
        {rodando ? "Sincronizando..." : "Sincronizar agora"}
      </button>
    </>
  );
}
