"use client";

import { useStore } from "@/lib/store";
import { BarrasH, PageHeader, serie } from "@/components/ui";
import { fmt, monthlyValue } from "@/lib/format";

export default function RelatoriosPage() {
  const { db, getCN } = useStore();

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
  const sld = db.bancos.reduce((s, b) => s + Number(b.saldo || 0), 0);

  const Linha = ({ label, valor, cor, top }: { label: string; valor: number; cor: string; top?: boolean }) => (
    <tr style={top ? { borderTop: "1px solid var(--linha)" } : {}}>
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
          <BarrasH itens={topClientes} formatar={fmt} cor={serie(0)}
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
                <td style={{ textAlign: "right", fontWeight: 500, color: `var(${tR - tP >= 0 ? "--ok" : "--critico"})` }}>{fmt(tR - tP)}</td>
              </tr>
              <tr><td colSpan={2} style={{ padding: 4 }} /></tr>
              <Linha label="Previsão a receber" valor={aR} cor="var(--marca-tinta)" />
              <Linha label="Previsão a pagar" valor={aP} cor="var(--marca-tinta)" />
              <tr><td colSpan={2} style={{ padding: 4 }} /></tr>
              <Linha label="MRR (assinaturas)" valor={mrr} cor="var(--info)" />
              <Linha label="Saldo total" valor={sld} cor="var(--info)" />
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
