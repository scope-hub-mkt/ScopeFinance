"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { Badge, Field, Modal, PageHeader } from "@/components/ui";
import { fmt, fmtDate } from "@/lib/format";

type Form = Record<string, any>;

export default function ContratosPage() {
  const { db, create, update, remove, getCN } = useStore();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>({});
  const [saving, setSaving] = useState(false);

  const novo = () => { setForm({ status: "Ativo", freq: "Único", categoria: "WebDesign" }); setOpen(true); };
  const editar = (c: Form) => { setForm(c); setOpen(true); };

  const salvar = async () => {
    if (!form.servico || !form.valor) { alert("Serviço e valor são obrigatórios"); return; }
    setSaving(true);
    try {
      if (form.id) await update("contratos", form.id, form);
      else await create("contratos", form);
      setOpen(false);
    } catch { } finally { setSaving(false); }
  };

  const excluir = async (id: string) => { if (confirm("Excluir contrato?")) await remove("contratos", id); };
  const set = (k: string) => (e: any) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const clientesAtivos = db.clientes.filter((c) => c.status === "Ativo");

  return (
    <>
      <PageHeader title="Contratos">
        <button className="btn btn-p" onClick={novo}><i className="ti ti-plus" />Novo contrato</button>
      </PageHeader>

      <div className="card tbl-wrap">
        <table>
          <thead>
            <tr><th>Cliente</th><th>Serviço</th><th>Valor</th><th>Início</th><th>Término</th><th>Status</th><th>Ações</th></tr>
          </thead>
          <tbody>
            {!db.contratos.length && <tr><td colSpan={7}><div className="empty">Nenhum contrato</div></td></tr>}
            {db.contratos.map((c) => (
              <tr key={c.id}>
                <td>{getCN(c.cliente_id)}</td>
                <td>{c.servico}</td>
                <td className="c-orange" style={{ fontWeight: 500 }}>{fmt(c.valor)}<br /><span className="tiny">{c.freq}</span></td>
                <td className="tiny">{fmtDate(c.inicio)}</td>
                <td className="tiny">{fmtDate(c.fim)}</td>
                <td><Badge s={c.status} /></td>
                <td>
                  <div className="actions">
                    <button className="btn btn-sm" onClick={() => editar(c)}><i className="ti ti-edit" /></button>
                    <button className="btn btn-sm btn-d" onClick={() => excluir(c.id)}><i className="ti ti-trash" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && (
        <Modal title="Contrato" onClose={() => setOpen(false)}>
          <div className="fgrid">
            <Field label="Cliente" span>
              <select value={form.cliente_id || ""} onChange={set("cliente_id")}>
                <option value="">Selecione...</option>
                {clientesAtivos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </Field>
            <Field label="Serviço *" span><input value={form.servico || ""} onChange={set("servico")} /></Field>
            <Field label="Valor (R$) *"><input type="number" value={form.valor ?? ""} onChange={set("valor")} /></Field>
            <Field label="Frequência">
              <select value={form.freq || "Único"} onChange={set("freq")}>
                <option>Único</option><option>Mensal</option><option>Trimestral</option><option>Anual</option>
              </select>
            </Field>
            <Field label="Início"><input type="date" value={form.inicio || ""} onChange={set("inicio")} /></Field>
            <Field label="Término"><input type="date" value={form.fim || ""} onChange={set("fim")} /></Field>
            <Field label="Status">
              <select value={form.status || "Ativo"} onChange={set("status")}>
                <option>Ativo</option><option>Pausado</option><option>Encerrado</option><option>Em negociação</option>
              </select>
            </Field>
            <Field label="Categoria">
              <select value={form.categoria || "WebDesign"} onChange={set("categoria")}>
                <option>WebDesign</option><option>Automação</option><option>IA</option><option>CRM</option><option>Consultoria</option><option>Outro</option>
              </select>
            </Field>
            <Field label="Observações" span><textarea value={form.obs || ""} onChange={set("obs")} /></Field>
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
