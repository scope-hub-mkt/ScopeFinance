"use client";

import { useStore } from "@/lib/store";
import { Empty, PageHeader } from "@/components/ui";
import { fmt, monthlyValue } from "@/lib/format";

function Bars({ data }: { data: { k: string; v: number }[] }) {
  if (!data.length) return <Empty>Sem dados suficientes</Empty>;
  const max = Math.max(...data.map((d) => d.v));
  return (
    <>
      {data.slice(0, 6).map((it, i) => {
        const pct = max ? Math.round((it.v / max) * 100) : 0;
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, marginBottom: 8 }}>
            <div style={{ width: 110, textAlign: "right", color: "var(--text2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={it.k}>
              {it.k}
            </div>
            <div style={{ flex: 1, background: "var(--bg4)", borderRadius: 999, height: 12, overflow: "hidden", border: "1px solid var(--border)" }}>
              <div style={{ height: "100%", borderRadius: 999, background: "var(--orange)", width: pct + "%" }} />
            </div>
            <div style={{ width: 90, fontWeight: 500, fontSize: 11 }}>{fmt(it.v)}</div>
          </div>
        );
      })}
    </>
  );
}

export default function RelatoriosPage() {
  const { db, getCN } = useStore();

  const group = (rows: { key: string; valor: number }[]) => {
    const m: Record<string, number> = {};
    rows.forEach((r) => { m[r.key] = (m[r.key] || 0) + Number(r.valor || 0); });
    return Object.entries(m).map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v);
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
  const sld = db.bancos.reduce((s, b) => s + Number(b.saldo || 0), 0);

  const Linha = ({ label, valor, cor, top }: { label: string; valor: number; cor: string; top?: boolean }) => (
    <tr style={top ? { borderTop: "1px solid var(--border)" } : {}}>
      <td className="muted" style={{ padding: "7px 0" }}>{label}</td>
      <td style={{ textAlign: "right", fontWeight: 500, color: cor }}>{fmt(valor)}</td>
    </tr>
  );

  return (
    <>
      <PageHeader title="Relatórios e análises" />
      <div className="two">
        <div className="card">
          <div className="stitle"><i className="ti ti-chart-pie c-orange" />Receita por serviço</div>
          <Bars data={receitaServico} />
        </div>
        <div className="card">
          <div className="stitle"><i className="ti ti-chart-bar c-orange" />Despesas por categoria</div>
          <Bars data={despesaCategoria} />
        </div>
      </div>
      <div className="two">
        <div className="card">
          <div className="stitle"><i className="ti ti-users c-orange" />Top clientes por receita</div>
          <Bars data={topClientes} />
        </div>
        <div className="card">
          <div className="stitle"><i className="ti ti-trending-up c-orange" />Resumo financeiro</div>
          <table>
            <tbody>
              <Linha label="Receita confirmada" valor={tR} cor="var(--green)" />
              <Linha label="Despesas pagas" valor={tP} cor="var(--red)" />
              <tr style={{ borderTop: "1px solid var(--border)" }}>
                <td style={{ padding: "7px 0", fontWeight: 500, color: "var(--orange-l)" }}>Lucro líquido</td>
                <td style={{ textAlign: "right", fontWeight: 500, color: `var(${tR - tP >= 0 ? "--green" : "--red"})` }}>{fmt(tR - tP)}</td>
              </tr>
              <tr><td colSpan={2} style={{ padding: 4 }} /></tr>
              <Linha label="Previsão a receber" valor={aR} cor="var(--orange-l)" />
              <Linha label="Previsão a pagar" valor={aP} cor="var(--orange-l)" />
              <tr><td colSpan={2} style={{ padding: 4 }} /></tr>
              <Linha label="MRR (assinaturas)" valor={mrr} cor="var(--blue)" />
              <Linha label="Saldo total" valor={sld} cor="var(--blue)" />
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
