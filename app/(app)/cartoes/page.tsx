"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { Field, Modal, PageHeader } from "@/components/ui";
import { fmt } from "@/lib/format";

type Form = Record<string, any>;

export default function CartoesPage() {
  const { db, create, update, remove } = useStore();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>({});
  const [saving, setSaving] = useState(false);

  const novo = () => { setForm({ bandeira: "Visa" }); setOpen(true); };
  const editar = (c: Form) => { setForm(c); setOpen(true); };

  const salvar = async () => {
    if (!form.nome || !form.limite) { alert("Nome e limite são obrigatórios"); return; }
    setSaving(true);
    try {
      if (form.id) await update("cartoes", form.id, form);
      else await create("cartoes", form);
      setOpen(false);
    } catch { } finally { setSaving(false); }
  };

  const excluir = async (id: string) => { if (confirm("Excluir cartão?")) await remove("cartoes", id); };
  const set = (k: string) => (e: any) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <>
      <PageHeader title="Cartões">
        <button className="btn btn-p" onClick={novo}><i className="ti ti-plus" />Novo cartão</button>
      </PageHeader>

      {!db.cartoes.length && <div className="empty">Nenhum cartão cadastrado</div>}
      <div className="cardgrid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))" }}>
        {db.cartoes.map((c) => {
          const us = Number(c.usado || 0), lim = Number(c.limite || 1);
          const pct = Math.min(100, Math.round((us / lim) * 100));
          const cl = pct > 80 ? "pfill-r" : pct > 60 ? "pfill-a" : "";
          return (
            <div key={c.id} className="card">
              <div className="row" style={{ marginBottom: 14 }}>
                <div>
                  <div style={{ fontWeight: 500 }}>{c.nome}</div>
                  <div className="tiny">{c.bandeira} · Fecha dia {c.fechamento || "—"} · Vence dia {c.vencimento || "—"}</div>
                </div>
                <div className="actions">
                  <button className="btn btn-sm" onClick={() => editar(c)}><i className="ti ti-edit" /></button>
                  <button className="btn btn-sm btn-d" onClick={() => excluir(c.id)}><i className="ti ti-trash" /></button>
                </div>
              </div>
              <div className="row" style={{ fontSize: 12, marginBottom: 5, color: "var(--tinta-2)" }}>
                <span>Usado: <strong style={{ color: "var(--tinta)" }}>{fmt(us)}</strong></span>
                <span style={{ fontWeight: 500, color: pct > 80 ? "var(--critico)" : "var(--marca-tinta)" }}>{pct}%</span>
              </div>
              <div className="pbar" style={{ marginBottom: 6 }}>
                <div className={`pfill ${cl}`} style={{ width: pct + "%" }} />
              </div>
              <div className="row" style={{ fontSize: 11, color: "var(--tinta-3)" }}>
                <span>Disponível: <strong style={{ color: "var(--ok)" }}>{fmt(lim - us)}</strong></span>
                <span>Limite: {fmt(lim)}</span>
              </div>
            </div>
          );
        })}
      </div>

      {open && (
        <Modal title="Cartão" onClose={() => setOpen(false)}>
          <div className="fgrid">
            <Field label="Nome do cartão *" span><input value={form.nome || ""} onChange={set("nome")} /></Field>
            <Field label="Bandeira">
              <select value={form.bandeira || "Visa"} onChange={set("bandeira")}>
                <option>Visa</option><option>Mastercard</option><option>Elo</option><option>American Express</option>
              </select>
            </Field>
            <Field label="Limite total (R$) *"><input type="number" value={form.limite ?? ""} onChange={set("limite")} /></Field>
            <Field label="Limite usado (R$)"><input type="number" value={form.usado ?? ""} onChange={set("usado")} /></Field>
            <Field label="Fechamento (dia)"><input type="number" min={1} max={31} value={form.fechamento ?? ""} onChange={set("fechamento")} /></Field>
            <Field label="Vencimento (dia)"><input type="number" min={1} max={31} value={form.vencimento ?? ""} onChange={set("vencimento")} /></Field>
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
