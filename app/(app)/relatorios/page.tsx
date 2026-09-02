"use client";

import { useStore, useRecursos } from "@/lib/store";
import { BarrasH, PageHeader, serie, Dinheiro } from "@/components/ui";
import { fmt, monthlyValue } from "@/lib/format";
import { usePainelAsaas } from "../usePainelAsaas";

export default function RelatoriosPage() {
  const { db, getCN } = useStore();
  // `D-91`: esta tela pede o que usa — antes o provider trazia as 10 tabelas.
  useRecursos("assinaturas", "contas_pagar", "contas_receber");
  // ⚖️ 02/09/2026: "Saldo total" saiu da soma de `bancos.saldo`. Ali o número
  // era digitado e valia R$ 429,47 enquanto a conta tinha R$ 13,79 — um
  // relatório é o pior lugar possível para um saldo que ninguém conferiu.
  const asaas = usePainelAsaas();

  const group = (rows: { key: string; valor: number }[]) => {
    const m: Record<string, number> = {};
    rows.forEach((r) => { m[r.key] = (m[r.key] || 0) + Number(r.valor || 0); });
    return Object.entries(m)
      .map(([rotulo, valor]) => ({ rotulo, valor }))
      .sort((a, b) => b.valor - a.valor);
  };

  const receberPagos = db.contas_receber.filter((r) => r.status === "Pago");
  const pagarPagos = db.contas_pagar.filter((p) => p.status === "Pago");

  const receitaServico = group(receberPagos.map((r) => ({ key: r.descricao, valor: r.valor })));
  const despesaCategoria = group(pagarPagos.map((p) => ({ key: p.categoria || "Outros", valor: p.valor })));
  const topClientes = group(receberPagos.map((r) => ({ key: getCN(r.cliente_id), valor: r.valor })));

  const tR = receberPagos.reduce((s, r) => s + Number(r.valor || 0), 0);
  const tP = pagarPagos.reduce((s, p) => s + Number(p.valor || 0), 0);
  const aR = db.contas_receber.filter((r) => r.status === "Pendente").reduce((s, r) => s + Number(r.valor || 0), 0);
  const aP = db.contas_pagar.filter((p) => p.status === "Pendente").reduce((s, p) => s + Number(p.valor || 0), 0);
  const mrr = db.assinaturas
    .filter((a) => a.status === "Ativa" && a.direcao === "receber")
    .reduce((s, a) => s + monthlyValue(Number(a.valor || 0), a.ciclo), 0);

  const Linha = ({ label, valor, cor, top }: { label: string; valor: number; cor: string; top?: boolean }) => (
    <tr style={top ? { borderTop: "1px solid var(--linha)" } : {}}>
      <td className="muted" style={{ padding: "7px 0" }}>{label}</td>
      <td style={{ textAlign: "right", fontWeight: 500, color: cor }}><Dinheiro v={valor} /></td>
    </tr>
  );

  return (
    <>
      <PageHeader title="Relatórios e análises" />
      <div className="two">
        <div className="card">
          <div className="stitle"><i className="ti ti-chart-pie c-orange" />Receita por serviço</div>
          <BarrasH itens={receitaServico} formatar={fmt} cor={serie(0)}
            vazio="Nenhuma conta a receber foi baixada ainda" />
        </div>
        <div className="card">
          <div className="stitle"><i className="ti ti-chart-bar c-orange" />Despesas por categoria</div>
          <BarrasH itens={despesaCategoria} formatar={fmt} cor={serie(7)}
            vazio="Nenhuma conta a pagar foi baixada ainda" />
        </div>
      </div>
      <div className="two">
        <div className="card">
          <div className="stitle"><i className="ti ti-users c-orange" />Top clientes por receita</div>
          <BarrasH itens={topClientes} formatar={fmt} cor={serie(0)} rotuloSigiloso
            vazio="Nenhuma receita confirmada para ranquear" />
        </div>
        <div className="card">
          <div className="stitle"><i className="ti ti-trending-up c-orange" />Resumo financeiro</div>
          <table>
            <tbody>
              <Linha label="Receita confirmada" valor={tR} cor="var(--ok)" />
              <Linha label="Despesas pagas" valor={tP} cor="var(--critico)" />
              <tr style={{ borderTop: "1px solid var(--linha)" }}>
                <td style={{ padding: "7px 0", fontWeight: 500, color: "var(--marca-tinta)" }}>Lucro líquido</td>
                <td style={{ textAlign: "right", fontWeight: 500, color: `var(${tR - tP >= 0 ? "--ok" : "--critico"})` }}><Dinheiro v={tR - tP} /></td>
              </tr>
              <tr><td colSpan={2} style={{ padding: 4 }} /></tr>
              <Linha label="Previsão a receber" valor={aR} cor="var(--marca-tinta)" />
              <Linha label="Previsão a pagar" valor={aP} cor="var(--marca-tinta)" />
              <tr><td colSpan={2} style={{ padding: 4 }} /></tr>
              <Linha label="MRR (assinaturas)" valor={mrr} cor="var(--info)" />
              {/* ⛔ Sem número quando o gateway não respondeu: um relatório que
                  troca "não consegui perguntar" por R$ 0,00 mente com autoridade. */}
              <tr>
                <td className="muted" style={{ padding: "7px 0" }}>Saldo na conta Asaas</td>
                <td style={{ textAlign: "right", fontWeight: 500, color: "var(--info)" }}>
                  {asaas.saldo === null ? "—" : <Dinheiro v={asaas.saldo} />}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
