"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { Badge, Field, Modal, PageHeader } from "@/components/ui";

type Form = Record<string, any>;

export default function ClientesPage() {
  const { db, create, update, remove } = useStore();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>({});
  const [saving, setSaving] = useState(false);

  const novo = () => { setForm({ status: "Ativo", tipo: "Pessoa Física" }); setOpen(true); };
  const editar = (c: Form) => { setForm(c); setOpen(true); };

  const salvar = async () => {
    if (!form.nome) { alert("Nome é obrigatório"); return; }
    setSaving(true);
    try {
      if (form.id) await update("clientes", form.id, form);
      else await create("clientes", form);
      setOpen(false);
    } catch { /* toast já exibido */ } finally { setSaving(false); }
  };

  const excluir = async (id: string) => {
    if (confirm("Excluir cliente?")) await remove("clientes", id);
  };

  const set = (k: string) => (e: any) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const q = search.toLowerCase();
  const list = db.clientes.filter(
    (c) => !q || c.nome?.toLowerCase().includes(q) || (c.email || "").toLowerCase().includes(q)
  );

  return (
    <>
      <PageHeader title="Clientes">
        <button className="btn btn-p" onClick={novo}><i className="ti ti-plus" />Novo cliente</button>
      </PageHeader>

      <div className="sbar">
        <i className="ti ti-search muted" />
        <input placeholder="Buscar por nome ou email..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="tiny">{list.length} cliente(s)</span>
      </div>

      <div className="card tbl-wrap">
        <table>
          <thead>
            <tr><th>Nome</th><th>Tipo</th><th>Email</th><th>Telefone</th><th>Status</th><th>Ações</th></tr>
          </thead>
          <tbody>
            {!list.length && <tr><td colSpan={6}><div className="empty">Nenhum cliente cadastrado</div></td></tr>}
            {list.map((c) => (
              <tr key={c.id}>
                <td>
                  <strong>{c.nome}</strong>
                  {c.doc && <><br /><span className="tiny">{c.doc}</span></>}
                </td>
                <td className="muted">{c.tipo || "—"}</td>
                <td className="muted">{c.email || "—"}</td>
                <td className="muted">{c.tel || "—"}</td>
                <td><Badge s={c.status || "Ativo"} /></td>
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
        <Modal title="Cliente" onClose={() => setOpen(false)}>
          <div className="fgrid">
            <Field label="Nome *"><input value={form.nome || ""} onChange={set("nome")} placeholder="Nome completo" /></Field>
            <Field label="Tipo">
              <select value={form.tipo || "Pessoa Física"} onChange={set("tipo")}>
                <option>Pessoa Física</option><option>Pessoa Jurídica</option>
              </select>
            </Field>
            <Field label="CPF/CNPJ"><input value={form.doc || ""} onChange={set("doc")} /></Field>
            <Field label="Email"><input type="email" value={form.email || ""} onChange={set("email")} /></Field>
            <Field label="Telefone"><input value={form.tel || ""} onChange={set("tel")} /></Field>
            <Field label="Status">
              <select value={form.status || "Ativo"} onChange={set("status")}>
                <option>Ativo</option><option>Inativo</option><option>Prospect</option>
              </select>
            </Field>
            <Field label="Endereço" span><input value={form.endereco || ""} onChange={set("endereco")} /></Field>
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
