"use client";

import { useState } from "react";
import { useStore, useRecursos } from "@/lib/store";
import { Field, Modal, PageHeader, Dinheiro } from "@/components/ui";

type Form = Record<string, any>;

export default function BancosPage() {
  const { db, create, update, remove } = useStore();
  // `D-91`: esta tela pede o que usa — antes o provider trazia as 10 tabelas.
  useRecursos("bancos");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>({});
  const [saving, setSaving] = useState(false);

  const novo = () => { setForm({ tipo: "Conta corrente" }); setOpen(true); };
  const editar = (b: Form) => { setForm(b); setOpen(true); };

  const salvar = async () => {
    if (!form.nome) { alert("Nome da conta é obrigatório"); return; }
    setSaving(true);
    try {
      if (form.id) await update("bancos", form.id, form);
      else await create("bancos", form);
      setOpen(false);
    } catch { } finally { setSaving(false); }
  };

  const excluir = async (id: string) => { if (confirm("Excluir conta bancária?")) await remove("bancos", id); };
  const set = (k: string) => (e: any) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <>
      <PageHeader title="Contas bancárias">
        <button className="btn btn-p" onClick={novo}><i className="ti ti-plus" />Nova conta</button>
      </PageHeader>

      {!db.bancos.length && <div className="empty">Nenhuma conta cadastrada</div>}
      <div className="cardgrid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))" }}>
        {db.bancos.map((b) => (
          <div key={b.id} className="card">
            <div className="row" style={{ marginBottom: 12 }}>
              <div>
                <div style={{ fontWeight: 500 }}>{b.nome}</div>
                <div className="tiny">{[b.banco, b.tipo].filter(Boolean).join(" · ")}</div>
              </div>
              <div className="actions">
                <button className="btn btn-sm" onClick={() => editar(b)}><i className="ti ti-edit" /></button>
                <button className="btn btn-sm btn-d" onClick={() => excluir(b.id)}><i className="ti ti-trash" /></button>
              </div>
            </div>
            <div style={{ fontSize: 26, fontWeight: 500, color: "var(--ok)" }}><Dinheiro v={b.saldo} /></div>
            <div className="tiny" style={{ marginTop: 4 }}>Saldo atual</div>
          </div>
        ))}
      </div>

      {open && (
        <Modal title="Conta bancária" onClose={() => setOpen(false)}>
          <div className="fgrid">
            <Field label="Nome da conta *" span><input value={form.nome || ""} onChange={set("nome")} /></Field>
            <Field label="Banco"><input value={form.banco || ""} onChange={set("banco")} /></Field>
            <Field label="Saldo atual (R$)"><input type="number" value={form.saldo ?? ""} onChange={set("saldo")} /></Field>
            <Field label="Tipo" span>
              <select value={form.tipo || "Conta corrente"} onChange={set("tipo")}>
                <option>Conta corrente</option><option>Conta poupança</option><option>Conta digital</option>
              </select>
            </Field>
          </div>
          <div className="tiny" style={{ marginTop: 4 }}>
            O saldo é ajustado automaticamente pelos lançamentos vinculados a esta conta.
          </div>
          <div className="mact">
            <button className="btn" onClick={() => setOpen(false)}>Cancelar</button>
            <button className="btn btn-p" onClick={salvar} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</button>
          </div>
        </Modal>
      )}
    </>
  );
}
