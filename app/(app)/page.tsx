"use client";

import { useStore, useRecursos } from "@/lib/store";
import { MetricGrid, Empty, type ItemMetrica, Dinheiro, Sigilo } from "@/components/ui";
import { fmt, fmtDate, today, monthlyValue } from "@/lib/format";
import { usePainelAsaas } from "./usePainelAsaas";

export default function DashboardPage() {
  const { db, getCN } = useStore();
  // `D-91`: esta tela pede o que usa — antes o provider trazia as 10 tabelas.
  useRecursos("assinaturas", "clientes", "contas_pagar", "contas_receber", "contratos");
  // ⚖️ 02/09/2026: saldo e cartões deixaram de sair de `bancos`/`cartoes` e
  // passam a vir do Asaas ao vivo. O motivo está em `lib/asaas/conta.ts` — a
  // soma de `bancos.saldo` exibia R$ 429,47 com o gateway em R$ 13,79.
  const asaas = usePainelAsaas();
  const t = today();
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
    /* `RNF-19` — a fonte mudou junto com o numero: ela agora nomeia o
       endpoint, nao uma coluna que alguem digitou. Ela e literal mesmo quando a
       leitura falha: a ORIGEM do numero nao muda com a rede caida. Quem conta a
       falha e o valor (`—`, nunca zero) e o card de extrato logo abaixo. */
    { l: "Saldo na conta Asaas",
      v: asaas.saldo === null ? "—" : fmt(asaas.saldo),
      c: "c-blue", icone: "building-bank",
      fonte: "GET /finance/balance do Asaas, lido ao abrir a tela" },
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
                    <td className="sigilo" style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {getCN(r.cliente_id)}
                    </td>
                    <td className="c-green" style={{ fontWeight: 500 }}><Dinheiro v={r.valor} /></td>
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
                    <td className="sigilo" style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.fornecedor}
                    </td>
                    <td className="c-red" style={{ fontWeight: 500 }}><Dinheiro v={r.valor} /></td>
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
            Últimas movimentações no Asaas
          </div>
          {asaas.erro ? (
            <div className="recado recado-erro" role="status">
              Não foi possível ler o extrato do Asaas: {asaas.erro}
            </div>
          ) : asaas.extrato.length ? (
            <table>
              <tbody>
                {asaas.extrato.map((l) => (
                  <tr key={l.id}>
                    <Sigilo as="td" className="tiny">{l.descricao}</Sigilo>
                    <td className={l.valor < 0 ? "c-red" : "c-green"} style={{ fontWeight: 500 }}>
                      <Dinheiro v={l.valor} />
                    </td>
                    <td className="tiny">{fmtDate(l.data)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>{asaas.carregando ? "Lendo o extrato no Asaas..." : "Sem movimentação"}</Empty>
          )}
        </div>

        <div className="card">
          <div className="stitle">
            <i className="ti ti-credit-card c-orange" />
            Recebimentos no cartão
          </div>
          {/* ⛔ Era "Limite de cartões", e o limite nunca existiu: a tabela
              `cartoes` estava vazia e o Asaas nao conhece limite de cartao de
              cliente. O que existe, e e real, e quanto entrou por cada cartao. */}
          {asaas.erro ? (
            <div className="recado recado-erro" role="status">
              Não foi possível ler os cartões do Asaas: {asaas.erro}
            </div>
          ) : asaas.cartoes.length ? (
            <table>
              <tbody>
                {asaas.cartoes.map((c) => (
                  <tr key={c.chave}>
                    <Sigilo as="td" className="tiny">
                      {c.bandeira} {c.final ? `•••• ${c.final}` : ""}
                    </Sigilo>
                    <td className="c-green" style={{ fontWeight: 500 }}>
                      <Dinheiro v={c.liquidado} />
                    </td>
                    <td className="tiny">{c.cobrancas} cobr.</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>
              {asaas.carregando ? "Lendo os cartões no Asaas..." : "Nenhuma cobrança no cartão"}
            </Empty>
          )}
        </div>
      </div>
    </>
  );
}
