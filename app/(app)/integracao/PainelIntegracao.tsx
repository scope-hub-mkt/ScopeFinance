"use client";

import { useState } from "react";
import { PageHeader } from "@/components/ui";
import { useStore } from "@/lib/store";
import type { ItemDiagnostico } from "@/lib/integracao/config";

interface Veredito {
  pronta: boolean;
  faltando: string[];
  entrada: boolean;
  saida: boolean;
}

export function PainelIntegracao({
  itens,
  veredito,
}: {
  itens: ItemDiagnostico[];
  veredito: Veredito;
}) {
  const { notify } = useStore();
  const [testando, setTestando] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [saude, setSaude] = useState<Record<string, any> | null>(null);
  const [sonda, setSonda] = useState<Record<string, any> | null>(null);
  const [ultimaSync, setUltimaSync] = useState<Record<string, any> | null>(null);

  /**
   * ⚖️ **Duas perguntas, não uma** — corrigido em 26/08/2026.
   *
   * Até aqui este botão só chamava o nosso próprio `/saude` e anunciava
   * "Serviço de integração no ar". Isso é verdade e é insuficiente: a
   * reconciliação estava falhando com 401 **em toda passada** enquanto os
   * três indicadores do topo diziam "Pronto". O botão media se NÓS estamos
   * de pé; ninguém media se a Dashboard nos aceita.
   *
   * Agora ele faz as duas, e o veredito é o da segunda — porque é a que pode
   * estar vermelha com todas as variáveis preenchidas.
   */
  const testar = async () => {
    setTestando(true);
    try {
      // 1. Sem Authorization de propósito: o que um chamador anônimo enxerga.
      //    Se esta rota não responder, nada do resto responde.
      const res = await fetch("/api/integracao/saude", { cache: "no-store" });
      setSaude(await res.json());
      if (!res.ok) {
        notify(`Nosso /saude falhou: HTTP ${res.status}`, "err");
        return;
      }

      // 2. A chamada real à Dashboard, com a chave de saída — a mesma que a
      //    reconciliação faz. É esta que distingue preenchido de funcionando.
      const resSonda = await fetch("/api/integracao/testar", { method: "POST" });
      const s = await resSonda.json();
      setSonda(s);
      notify(s?.ok ? s.mensagem : `Dashboard: ${s?.mensagem ?? `HTTP ${resSonda.status}`}`, s?.ok ? "ok" : "err");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Erro de rede", "err");
    } finally {
      setTestando(false);
    }
  };

  const sincronizar = async () => {
    setSincronizando(true);
    try {
      const res = await fetch("/api/integracao/sincronizar", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setUltimaSync(body);
      const env = body.enviados ?? {};
      const rec = body.recebidos ?? {};
      notify(
        `Enviados: ${env.entregues ?? 0} de ${env.processados ?? 0} · ` +
          `Recebidos: ${rec.criados ?? 0} novos, ${rec.atualizados ?? 0} atualizados`,
        "ok"
      );
    } catch (e) {
      notify(e instanceof Error ? e.message : "Erro ao sincronizar", "err");
    } finally {
      setSincronizando(false);
    }
  };

  return (
    <>
      <PageHeader title="Integração · Scope Dashboard">
        <button className="btn" onClick={testar} disabled={testando}>
          <i className="ti ti-plug-connected" />
          {testando ? "Testando..." : "Testar conexão"}
        </button>
        <button className="btn btn-p" onClick={sincronizar} disabled={sincronizando}>
          <i className="ti ti-refresh" />
          {sincronizando ? "Sincronizando..." : "Sincronizar agora"}
        </button>
      </PageHeader>

      <div className="mgrid">
        <div className="met">
          <div className="met-l">Recebe da Dashboard</div>
          <div className={`met-v ${veredito.entrada ? "c-green" : "c-red"}`}>
            {veredito.entrada ? "Pronto" : "Falta configurar"}
          </div>
        </div>
        <div className="met">
          <div className="met-l">Envia para a Dashboard</div>
          <div className={`met-v ${veredito.saida ? "c-green" : "c-red"}`}>
            {veredito.saida ? "Pronto" : "Falta configurar"}
          </div>
        </div>
        <div className="met">
          <div className="met-l">Variáveis pendentes</div>
          <div className={`met-v ${veredito.pronta ? "c-green" : "c-orange"}`}>
            {veredito.faltando.length}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="stitle">Como os dois sistemas se falam</div>
        <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.7 }}>
          A Scope Dashboard e o ScopeFinance têm poder equivalente e papéis
          distintos — a Dashboard é o CEO, o financeiro é o CFO, e o cadastro de
          cliente é <strong>núcleo compartilhado</strong>. Um cliente nasce em
          qualquer um dos dois e replica para o outro <strong>com o mesmo id</strong>;
          é esse id único que impede a mesma empresa de virar duas identidades.
          A Dashboard lê daqui o dado financeiro e nunca o recalcula.
        </p>
        <p className="tiny" style={{ marginTop: 8, lineHeight: 1.7 }}>
          ⚠ A tabela abaixo mede <strong>presença da variável</strong>, não que o
          valor esteja certo — uma chave truncada aparece como “Configurada”.
          Quem distingue preenchido de funcionando é o botão “Testar conexão”,
          que desde 26/08/2026 chama a Dashboard de verdade com a chave de
          saída, em vez de só perguntar se nós estamos de pé.
        </p>
      </div>

      <div className="tbl-wrap card" style={{ padding: 0 }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Variável</th>
              <th>O que ela liga</th>
              <th>Onde pegar o valor</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {itens.map((i) => (
              <tr key={i.chave}>
                <td>
                  <code style={{ fontSize: 11.5 }}>{i.chave}</code>
                  <div className="tiny">{i.rotulo}</div>
                </td>
                <td className="muted" style={{ fontSize: 12 }}>{i.obrigatorioPara}</td>
                <td className="tiny">{i.ajuda}</td>
                <td>
                  <span className={`bdg ${i.configurado ? "bdg-g" : "bdg-r"}`}>
                    {i.configurado ? "Configurada" : "Faltando"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sonda && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="stitle">
            Chamada real à Dashboard{" "}
            <span className={`bdg ${sonda.ok ? "bdg-g" : "bdg-r"}`}>
              {sonda.ok ? "aceita" : "recusada"}
            </span>
          </div>
          <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.7 }}>{sonda.mensagem}</p>
          {sonda.acao && (
            <p className="tiny" style={{ marginTop: 8, lineHeight: 1.7 }}>
              <strong>O que fazer:</strong> {sonda.acao}
            </p>
          )}
        </div>
      )}

      {saude && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="stitle">Resposta de /api/integracao/saude</div>
          <pre className="tiny" style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
            {JSON.stringify(saude, null, 2)}
          </pre>
        </div>
      )}

      {ultimaSync && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="stitle">Última sincronização</div>
          <pre className="tiny" style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
            {JSON.stringify(ultimaSync, null, 2)}
          </pre>
        </div>
      )}
    </>
  );
}
