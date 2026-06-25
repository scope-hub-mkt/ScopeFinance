"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { Field, Modal, MetricGrid, PageHeader } from "@/components/ui";
import { fmt, fmtDate, today } from "@/lib/format";

type Form = Record<string, any>;
type Tab = "todos" | "entrada" | "saida";

export default function LancamentosPage() {
  const { db, create, remove, getBN } = useStore();
  const [tab, setTab] = useState<Tab>("todos");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>({});
  const [saving, setSaving] = useState(false);

  const novo = (tipo: "entrada" | "saida") => {
    setForm({ tipo, data: today(), categoria: tipo === "entrada" ? "Serviço" : "Infraestrutura" });
    setOpen(true);
  };

  const salvar = async () => {
    if (!form.descricao || !form.valor) { alert("Descrição e valor são obrigatórios"); return; }
    setSaving(true);
    try {
      await create("lancamentos", form);
      setOpen(false);
    } catch { } finally { setSaving(false); }
  };

  const excluir = async (id: string) => { if (confirm("Excluir lançamento? O saldo será revertido.")) await remove("lancamentos", id); };
  const set = (k: string) => (e: any) => setForm((f) => ({ ...f, [k]: e.target.value }));

  let list = db.lancamentos;
  if (tab === "entrada") list = list.filter((l) => l.tipo === "entrada");
  else if (tab === "saida") list = list.filter((l) => l.tipo === "saida");
  list = [...list].sort((a, b) => (b.data > a.data ? 1 : -1));

  const ent = db.lancamentos.filter((l) => l.tipo === "entrada").reduce((s, l) => s + Number(l.valor || 0), 0);
  const sai = db.lancamentos.filter((l) => l.tipo === "saida").reduce((s, l) => s + Number(l.valor || 0), 0);

  return (
    <>
      <PageHeader title="Lançamentos">
        <button className="btn btn-s" onClick={() => novo("entrada")}><i className="ti ti-plus" />Entrada</button>
        <button className="btn btn-d" onClick={() => novo("saida")}><i className="ti ti-minus" />Saída</button>
      </PageHeader>

      <div className="tabs">
        {(["todos", "entrada", "saida"] as Tab[]).map((f) => (
          <button key={f} className={`tab${tab === f ? " act" : ""}`} onClick={() => setTab(f)}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      <MetricGrid items={[
        { l: "Entradas", v: fmt(ent), c: "c-green" },
        { l: "Saídas", v: fmt(sai), c: "c-red" },
        { l: "Saldo", v: fmt(ent - sai), c: ent - sai >= 0 ? "c-green" : "c-red" },
      ]} />

      <div className="card tbl-wrap">
        <table>
          <thead>
            <tr><th>Data</th><th>Tipo</th><th>Descrição</th><th>Categoria</th><th>Conta</th><th>Valor</th><th></th></tr>
          </thead>
          <tbody>
            {!list.length && <tr><td colSpan={7}><div className="empty">Nenhum lançamento</div></td></tr>}
            {list.map((l) => (
              <tr key={l.id}>
                <td className="tiny">{fmtDate(l.data)}</td>
                <td><span className={`bdg ${l.tipo === "entrada" ? "bdg-g" : "bdg-r"}`}>{l.tipo === "entrada" ? "Entrada" : "Saída"}</span></td>
                <td>{l.descricao}{l.origem !== "manual" && <span className="tiny"> · auto</span>}</td>
                <td><span className="bdg bdg-x">{l.categoria || "—"}</span></td>
                <td className="tiny">{getBN(l.conta_id)}</td>
                <td style={{ fontWeight: 500, color: `var(${l.tipo === "entrada" ? "--green" : "--red"})` }}>
                  {l.tipo === "entrada" ? "+" : "-"}{fmt(l.valor)}
                </td>
                <td>
                  <button className="btn btn-sm btn-d" onClick={() => excluir(l.id)}><i className="ti ti-trash" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && (
        <Modal title={form.tipo === "entrada" ? "Registrar entrada" : "Registrar saída"} onClose={() => setOpen(false)}>
          <div className="fgrid">
            <Field label="Descrição *" span><input value={form.descricao || ""} onChange={set("descricao")} /></Field>
            <Field label="Valor (R$) *"><input type="number" value={form.valor ?? ""} onChange={set("valor")} /></Field>
            <Field label="Data *"><input type="date" value={form.data || ""} onChange={set("data")} /></Field>
            <Field label="Categoria">
              <select value={form.categoria || ""} onChange={set("categoria")}>
                {form.tipo === "entrada"
                  ? ["Serviço", "Assinatura CRM", "Projeto", "Consultoria", "Outro"].map((o) => <option key={o}>{o}</option>)
                  : ["Infraestrutura", "Software/SaaS", "Marketing", "Pessoal", "Impostos", "Outros"].map((o) => <option key={o}>{o}</option>)}
              </select>
            </Field>
            <Field label="Conta bancária" span>
              <select value={form.conta_id || ""} onChange={set("conta_id")}>
                <option value="">Nenhuma (não afeta saldo)</option>
                {db.bancos.map((b) => <option key={b.id} value={b.id}>{b.nome}</option>)}
              </select>
            </Field>
          </div>
          <div className="mact">
            <button className="btn" onClick={() => setOpen(false)}>Cancelar</button>
            <button className="btn btn-p" onClick={salvar} disabled={saving}>{saving ? "Salvando..." : "Registrar"}</button>
          </div>
        </Modal>
      )}
    </>
  );
}
