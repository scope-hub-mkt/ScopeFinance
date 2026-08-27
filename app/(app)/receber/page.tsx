"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { Badge, Field, Modal, MetricGrid, PageHeader } from "@/components/ui";
import { BaixaModal } from "@/components/BaixaModal";
import { fmt, fmtDate, today } from "@/lib/format";

type Form = Record<string, any>;
type Tab = "todos" | "pendente" | "pago" | "vencido";

export default function ReceberPage() {
  const { db, create, update, remove, emitirNF, getCN } = useStore();
  const [tab, setTab] = useState<Tab>("todos");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>({});
  const [saving, setSaving] = useState(false);
  const [baixa, setBaixa] = useState<Form | null>(null);

  const novo = () => { setForm({ status: "Pendente", forma_pagamento: "PIX", vencimento: today() }); setOpen(true); };
  const editar = (r: Form) => { setForm(r); setOpen(true); };

  const salvar = async () => {
    if (!form.descricao || !form.valor) { alert("Descrição e valor são obrigatórios"); return; }
    setSaving(true);
    try {
      if (form.id) await update("contas_receber", form.id, form);
      else await create("contas_receber", form);
      setOpen(false);
    } catch { } finally { setSaving(false); }
  };

  const excluir = async (id: string) => { if (confirm("Excluir cobrança?")) await remove("contas_receber", id); };
  const set = (k: string) => (e: any) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const t = today();
  let list = db.contas_receber;
  if (tab === "pendente") list = list.filter((r) => r.status === "Pendente");
  else if (tab === "pago") list = list.filter((r) => r.status === "Pago");
  else if (tab === "vencido") list = list.filter((r) => r.status === "Vencido" || (r.status === "Pendente" && r.vencimento && r.vencimento < t));
  list = [...list].sort((a, b) => ((a.vencimento || "") > (b.vencimento || "") ? 1 : -1));

  const tot = list.reduce((s, r) => s + Number(r.valor || 0), 0);
  const pg = list.filter((r) => r.status === "Pago").reduce((s, r) => s + Number(r.valor || 0), 0);
  const pd = list.filter((r) => r.status === "Pendente").reduce((s, r) => s + Number(r.valor || 0), 0);
  const clientesAtivos = db.clientes.filter((c) => c.status === "Ativo");

  return (
    <>
      <PageHeader title="Contas a receber">
        <button className="btn btn-p" onClick={novo}><i className="ti ti-plus" />Nova cobrança</button>
      </PageHeader>

      <div className="tabs">
        {(["todos", "pendente", "pago", "vencido"] as Tab[]).map((f) => (
          <button key={f} className={`tab${tab === f ? " act" : ""}`} onClick={() => setTab(f)}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      <MetricGrid items={[
        { l: "Total", v: fmt(tot), icone: "receipt",
          fonte: "contas a receber no filtro da aba atual" },
        { l: "Recebido", v: fmt(pg), c: "c-green", icone: "circle-check",
          fonte: "contas a receber com status Pago, no filtro atual" },
        { l: "Pendente", v: fmt(pd), c: "c-orange", icone: "clock",
          fonte: "contas a receber com status Pendente, no filtro atual" },
      ]} />

      <div className="card tbl-wrap">
        <table>
          <thead>
            <tr><th>Cliente</th><th>Descrição</th><th>Valor</th><th>Vencimento</th><th>Status</th><th>Ações</th></tr>
          </thead>
          <tbody>
            {!list.length && <tr><td colSpan={6}><div className="empty">Nenhum registro</div></td></tr>}
            {list.map((r) => {
              const venc = r.vencimento && r.status === "Pendente" && r.vencimento < t;
              return (
                <tr key={r.id}>
                  <td>{getCN(r.cliente_id)}{r.assinatura_id && <span className="tiny"> · assinatura</span>}</td>
                  <td>{r.descricao}</td>
                  <td className="c-green" style={{ fontWeight: 500 }}>{fmt(r.valor)}</td>
                  <td className="tiny" style={venc ? { color: "var(--critico)" } : {}}>{fmtDate(r.vencimento)}</td>
                  <td><Badge s={r.status} /></td>
                  <td>
                    <div className="actions">
                      {r.status === "Pendente" && (
                        <button className="btn btn-sm btn-s" title="Dar baixa" onClick={() => setBaixa(r)}><i className="ti ti-check" /></button>
                      )}
                      <button className="btn btn-sm" title="Emitir NF" onClick={() => emitirNF({ conta_receber_id: r.id })}><i className="ti ti-receipt" /></button>
                      <button className="btn btn-sm" onClick={() => editar(r)}><i className="ti ti-edit" /></button>
                      <button className="btn btn-sm btn-d" onClick={() => excluir(r.id)}><i className="ti ti-trash" /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {open && (
        <Modal title="Cobrança" onClose={() => setOpen(false)}>
          <div className="fgrid">
            <Field label="Cliente" span>
              <select value={form.cliente_id || ""} onChange={set("cliente_id")}>
                <option value="">Selecione...</option>
                {clientesAtivos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </Field>
            <Field label="Descrição *" span><input value={form.descricao || ""} onChange={set("descricao")} /></Field>
            <Field label="Valor (R$) *"><input type="number" value={form.valor ?? ""} onChange={set("valor")} /></Field>
            <Field label="Vencimento *"><input type="date" value={form.vencimento || ""} onChange={set("vencimento")} /></Field>
            <Field label="Forma de pagamento">
              <select value={form.forma_pagamento || "PIX"} onChange={set("forma_pagamento")}>
                <option>PIX</option><option>Boleto</option><option>Cartão de crédito</option><option>Transferência</option><option>Dinheiro</option>
              </select>
            </Field>
            <Field label="Status">
              <select value={form.status || "Pendente"} onChange={set("status")}>
                <option>Pendente</option><option>Pago</option><option>Vencido</option><option>Cancelado</option>
              </select>
            </Field>
          </div>
          <div className="mact">
            <button className="btn" onClick={() => setOpen(false)}>Cancelar</button>
            <button className="btn btn-p" onClick={salvar} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</button>
          </div>
        </Modal>
      )}

      {baixa && <BaixaModal tabela="contas_receber" item={baixa} onClose={() => setBaixa(null)} />}
    </>
  );
}
