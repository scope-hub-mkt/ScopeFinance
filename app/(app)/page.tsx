"use client";

import { useStore, useRecursos } from "@/lib/store";
import { MetricGrid, Empty, type ItemMetrica } from "@/components/ui";
import { fmt, fmtDate, today, monthlyValue } from "@/lib/format";

export default function DashboardPage() {
  const { db, getCN } = useStore();
  // `D-91`: esta tela pede o que usa — antes o provider trazia as 10 tabelas.
  useRecursos("assinaturas", "bancos", "cartoes", "clientes", "contas_pagar", "contas_receber", "contratos");
  const t = today();

  const saldo = db.bancos.reduce((a, b) => a + Number(b.saldo || 0), 0);
  const aRec = db.contas_receber.filter((r) => r.status === "Pendente").reduce((a, b) => a + Number(b.valor || 0), 0);
  const aPag = db.contas_pagar.filter((r) => r.status === "Pendente").reduce((a, b) => a + Number(b.valor || 0), 0);
  const mrr = db.assinaturas
    .filter((a) => a.status === "Ativa" && a.direcao === "receber")
    .reduce((a, b) => a + monthlyValue(Number(b.valor || 0), b.ciclo), 0);
  const vR = db.contas_receber.filter((r) => r.status === "Pendente" && r.vencimento && r.vencimento < t).length;
  const vP = db.contas_pagar.filter((r) => r.status === "Pendente" && r.vencimento && r.vencimento < t).length;

  /* `RNF-19` — cada numero declara de onde saiu. A `fonte` e obrigatoria no
     tipo `ItemMetrica`: nao e possivel exibir KPI sem procedencia. */
  const metrics: ItemMetrica[] = [
    { l: "Saldo total", v: fmt(saldo), c: "c-blue", icone: "building-bank",
      fonte: "soma do campo saldo das contas bancarias cadastradas" },
    { l: "A receber", v: fmt(aRec), c: "c-green", icone: "arrow-down-circle",
      fonte: "contas a receber com status Pendente" },
    { l: "A pagar", v: fmt(aPag), c: "c-red", icone: "arrow-up-circle",
      fonte: "contas a pagar com status Pendente" },
    { l: "MRR", v: fmt(mrr), c: "c-orange", icone: "repeat",
      fonte: "assinaturas Ativas a receber, normalizadas por ciclo" },
    { l: "Clientes ativos", v: db.clientes.filter((c) => c.status === "Ativo").length, c: "",
      icone: "users", fonte: "clientes com status Ativo" },
    { l: "Venc. receber", v: vR, c: vR > 0 ? "c-red" : "", icone: "alert-triangle",
      fonte: "contas a receber Pendentes com vencimento anterior a hoje" },
    { l: "Venc. pagar", v: vP, c: vP > 0 ? "c-red" : "", icone: "alert-triangle",
      fonte: "contas a pagar Pendentes com vencimento anterior a hoje" },
    { l: "Contratos ativos", v: db.contratos.filter((c) => c.status === "Ativo").length, c: "",
      icone: "file-text", fonte: "contratos com status Ativo" },
  ];

  const sortVenc = <T extends { vencimento: string | null }>(arr: T[]) =>
    [...arr].sort((a, b) => (a.vencimento || "") > (b.vencimento || "") ? 1 : -1).slice(0, 5);
  const p5r = sortVenc(db.contas_receber.filter((r) => r.status === "Pendente"));
  const p5p = sortVenc(db.contas_pagar.filter((r) => r.status === "Pendente"));

  return (
    <>
      <div className="ph">
        <div className="pt">Dashboard</div>
        <span className="tiny">
          {new Date().toLocaleDateString("pt-BR", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
        </span>
      </div>

      <MetricGrid items={metrics} />

      <div className="two">
        <div className="card">
          <div className="stitle">
            <i className="ti ti-arrow-down-circle c-green" />
            Próximos recebimentos
          </div>
          {p5r.length ? (
            <table>
              <tbody>
                {p5r.map((r) => (
                  <tr key={r.id}>
                    <td style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {getCN(r.cliente_id)}
                    </td>
                    <td className="c-green" style={{ fontWeight: 500 }}>{fmt(r.valor)}</td>
                    <td className="tiny">{fmtDate(r.vencimento)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>Sem pendências</Empty>
          )}
        </div>

        <div className="card">
          <div className="stitle">
            <i className="ti ti-arrow-up-circle c-red" />
            Próximos pagamentos
          </div>
          {p5p.length ? (
            <table>
              <tbody>
                {p5p.map((r) => (
                  <tr key={r.id}>
                    <td style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.fornecedor}
                    </td>
                    <td className="c-red" style={{ fontWeight: 500 }}>{fmt(r.valor)}</td>
                    <td className="tiny">{fmtDate(r.vencimento)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>Sem pendências</Empty>
          )}
        </div>
      </div>

      <div className="two">
        <div className="card">
          <div className="stitle">
            <i className="ti ti-building-bank c-orange" />
            Saldo nas contas
          </div>
          {db.bancos.length ? (
            <table>
              <tbody>
                {db.bancos.map((b) => (
                  <tr key={b.id}>
                    <td>{b.nome}</td>
                    <td className="c-green" style={{ fontWeight: 500 }}>{fmt(b.saldo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>Nenhuma conta</Empty>
          )}
        </div>

        <div className="card">
          <div className="stitle">
            <i className="ti ti-credit-card c-orange" />
            Limite de cartões
          </div>
          {db.cartoes.length ? (
            db.cartoes.map((c) => {
              const pct = Math.min(100, Math.round((Number(c.usado || 0) / Number(c.limite || 1)) * 100));
              const cl = pct > 80 ? "pfill-r" : pct > 60 ? "pfill-a" : "";
              return (
                <div key={c.id} style={{ marginBottom: 12 }}>
                  <div className="row" style={{ fontSize: 12, marginBottom: 4, color: "var(--tinta-2)" }}>
                    <span>{c.nome}</span>
                    <span style={{ color: "var(--tinta)" }}>{fmt(c.usado)} / {fmt(c.limite)}</span>
                  </div>
                  <div className="pbar">
                    <div className={`pfill ${cl}`} style={{ width: pct + "%" }} />
                  </div>
                </div>
              );
            })
          ) : (
            <Empty>Nenhum cartão</Empty>
          )}
        </div>
      </div>
    </>
  );
}
