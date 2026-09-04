"use client";

import { useState } from "react";
import Link from "next/link";
import { useStore, useRecursos } from "@/lib/store";
import { Badge, MetricGrid, PageHeader, Dinheiro } from "@/components/ui";
import { fmt, fmtDate, today } from "@/lib/format";

/**
 * Contas a receber — **o que o gateway cobrou**, somente leitura.
 *
 * ⚖️ **Por que esta tela perdeu o botão de criar** (`RF-93`, `D-100`,
 * 03/09/2026). Decisão do dono: *"os dados financeiros que exibem da
 * dashboard vem exclusivamente da api do asaas"*. Um recebível digitado aqui
 * ficava indistinguível de uma cobrança real do Asaas — mesma tabela, mesma
 * lista, mesmo total — e escorria para o faturamento e para a Dashboard.
 *
 * O que se digita à mão continua existindo, em `/receber/manuais`. O que esta
 * tela mostra é só o que o Asaas criou, e por isso ela **não edita**: editar o
 * espelho de um gateway é escrever uma verdade que o gateway vai sobrescrever
 * na próxima varredura.
 *
 * ⛔ A baixa também saiu daqui. Quem baixa a cobrança do gateway é o gateway:
 * o webhook `PAYMENT_RECEIVED` grava `pago_em`, `valor_pago` e `deducoes`.
 * Um botão de baixa manual sobre linha do Asaas produziria um "pago" que o
 * extrato não confirma.
 */

type Tab = "todos" | "pendente" | "pago" | "vencido";

export default function ReceberPage() {
  const { db, emitirNF, getCN } = useStore();
  useRecursos("clientes", "contas_receber");
  const [tab, setTab] = useState<Tab>("todos");

  const t = today();

  // ⛔ O filtro de origem vem ANTES de qualquer outro. As abas recortam
  // dentro do que o gateway trouxe, nunca sobre o conjunto todo — senão a aba
  // "Pago" voltaria a somar baixa manual, que é justamente o que sai daqui.
  const doGateway = db.contas_receber.filter((r) => r.origem_lancamento === "asaas");
  const manuais = db.contas_receber.length - doGateway.length;

  let list = doGateway;
  if (tab === "pendente") list = list.filter((r) => r.status === "Pendente");
  else if (tab === "pago") list = list.filter((r) => r.status === "Pago");
  else if (tab === "vencido")
    list = list.filter(
      (r) => r.status === "Vencido" || (r.status === "Pendente" && r.vencimento && r.vencimento < t)
    );
  list = [...list].sort((a, b) => ((a.vencimento || "") > (b.vencimento || "") ? 1 : -1));

  const tot = list.reduce((s, r) => s + Number(r.valor || 0), 0);
  const pg = list.filter((r) => r.status === "Pago").reduce((s, r) => s + Number(r.valor || 0), 0);
  const pd = list.filter((r) => r.status === "Pendente").reduce((s, r) => s + Number(r.valor || 0), 0);

  return (
    <>
      <PageHeader title="Contas a receber">
        <Link className="btn" href="/receber/manuais">
          <i className="ti ti-pencil" />
          Recebíveis manuais{manuais ? ` (${manuais})` : ""}
        </Link>
      </PageHeader>

      <div className="recado">
        Esta tela mostra <strong>o que o Asaas cobrou</strong>, e por isso não se
        edita nem se baixa aqui: quem dá baixa é o próprio gateway, pelo webhook.
        Cobrança lançada à mão vive em <Link href="/receber/manuais">Recebíveis manuais</Link>.
      </div>

      <div className="tabs">
        {(["todos", "pendente", "pago", "vencido"] as Tab[]).map((f) => (
          <button key={f} className={`tab${tab === f ? " act" : ""}`} onClick={() => setTab(f)}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      <MetricGrid
        items={[
          {
            l: "Total",
            v: fmt(tot),
            icone: "receipt",
            fonte: "contas a receber de origem Asaas, no filtro da aba atual",
          },
          {
            l: "Recebido",
            v: fmt(pg),
            c: "c-green",
            icone: "circle-check",
            fonte: "contas a receber de origem Asaas com status Pago, no filtro atual",
          },
          {
            l: "Pendente",
            v: fmt(pd),
            c: "c-orange",
            icone: "clock",
            fonte: "contas a receber de origem Asaas com status Pendente, no filtro atual",
          },
        ]}
      />

      <div className="card tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Descrição</th>
              <th>Valor</th>
              <th>Vencimento</th>
              <th>Status</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {!list.length && (
              <tr>
                <td colSpan={6}>
                  <div className="empty">
                    Nenhuma cobrança do gateway neste filtro
                    {manuais > 0 && (
                      <>
                        {" — "}
                        <Link href="/receber/manuais">
                          há {manuais} recebível{manuais > 1 ? "eis" : ""} manual
                          {manuais > 1 ? "is" : ""}
                        </Link>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            )}
            {list.map((r) => {
              const venc = r.vencimento && r.status === "Pendente" && r.vencimento < t;
              return (
                <tr key={r.id}>
                  <td className="sigilo">
                    {getCN(r.cliente_id)}
                    {r.assinatura_id && <span className="tiny"> · assinatura</span>}
                  </td>
                  {/* `RF-90` — a descrição carrega o nome do cliente
                      ("Assinatura Scope System - Fulano"). Medido em 31/08/2026:
                      marcar só a coluna Cliente deixava o nome na coluna ao lado. */}
                  <td className="sigilo">{r.descricao}</td>
                  <td className="c-green" style={{ fontWeight: 500 }}>
                    <Dinheiro v={r.valor} />
                  </td>
                  <td className="tiny" style={venc ? { color: "var(--critico)" } : {}}>
                    {fmtDate(r.vencimento)}
                  </td>
                  <td>
                    <Badge s={r.status} />
                  </td>
                  <td>
                    <div className="actions">
                      <button
                        className="btn btn-sm"
                        title="Emitir NF"
                        onClick={() => emitirNF({ conta_receber_id: r.id })}
                      >
                        <i className="ti ti-receipt" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
