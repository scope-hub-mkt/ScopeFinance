"use client";

import { useState } from "react";
import { useStore, useRecursos } from "@/lib/store";
import { Badge, Field, Modal, PageHeader } from "@/components/ui";
import { fmt, fmtDate } from "@/lib/format";

type Form = Record<string, any>;

export default function NotasFiscaisPage() {
  const { db, emitirNF, getCN } = useStore();
  // `D-91`: esta tela pede o que usa — antes o provider trazia as 10 tabelas.
  useRecursos("clientes", "notas_fiscais");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>({});
  const [saving, setSaving] = useState(false);

  const novo = () => { setForm({}); setOpen(true); };
  const set = (k: string) => (e: any) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const emitir = async () => {
    if (!form.cliente_id) { alert("Selecione o cliente"); return; }
    if (!form.valor) { alert("Informe o valor"); return; }
    setSaving(true);
    try {
      await emitirNF({
        cliente_id: form.cliente_id,
        descricao_servico: form.descricao_servico,
        valor: Number(form.valor),
        municipalServiceCode: form.municipalServiceCode || undefined,
      });
      setOpen(false);
    } catch { } finally { setSaving(false); }
  };

  const reemitir = async (n: Form) => {
    if (!confirm("Tentar emitir novamente esta nota?")) return;
    await emitirNF({
      cliente_id: n.cliente_id,
      conta_receber_id: n.conta_receber_id || undefined,
      descricao_servico: n.descricao_servico,
      valor: Number(n.valor),
    });
  };

  return (
    <>
      <PageHeader title="Notas fiscais">
        <button className="btn btn-p" onClick={novo}><i className="ti ti-plus" />Emitir NF</button>
      </PageHeader>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="tiny">
          <i className="ti ti-info-circle" /> A emissão usa a integração de NFS-e do <strong>Asaas</strong>. É preciso
          configurar no painel do Asaas: certificado/portal de notas, dados da empresa e o código de serviço municipal.
          O cliente precisa ter <strong>CPF/CNPJ</strong> cadastrado. Defina <code>ASAAS_API_KEY</code> no ambiente.
        </div>
      </div>

      <div className="card tbl-wrap">
        <table>
          <thead>
            <tr><th>Data</th><th>Cliente</th><th>Descrição</th><th>Valor</th><th>Número</th><th>Status</th><th>Ações</th></tr>
          </thead>
          <tbody>
            {!db.notas_fiscais.length && <tr><td colSpan={7}><div className="empty">Nenhuma nota emitida</div></td></tr>}
            {db.notas_fiscais.map((n) => (
              <tr key={n.id}>
                <td className="tiny">{fmtDate(n.data_emissao || n.created_at?.slice(0, 10))}</td>
                <td>{getCN(n.cliente_id)}</td>
                <td>
                  {n.descricao_servico || "—"}
                  {n.status === "Erro" && n.erro && <><br /><span className="tiny c-red">{n.erro}</span></>}
                </td>
                <td className="c-orange" style={{ fontWeight: 500 }}>{fmt(n.valor)}</td>
                <td className="tiny">{n.numero || "—"}</td>
                <td><Badge s={n.status} /></td>
                <td>
                  <div className="actions">
                    {n.pdf_url && (
                      <a className="btn btn-sm" href={n.pdf_url} target="_blank" rel="noreferrer" title="PDF"><i className="ti ti-file-type-pdf" /></a>
                    )}
                    {n.xml_url && (
                      <a className="btn btn-sm" href={n.xml_url} target="_blank" rel="noreferrer" title="XML"><i className="ti ti-file-code" /></a>
                    )}
                    {n.status === "Erro" && (
                      <button className="btn btn-sm" title="Tentar novamente" onClick={() => reemitir(n)}><i className="ti ti-refresh" /></button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && (
        <Modal title="Emitir nota fiscal (NFS-e)" onClose={() => setOpen(false)}>
          <div className="fgrid">
            <Field label="Cliente *" span>
              <select value={form.cliente_id || ""} onChange={set("cliente_id")}>
                <option value="">Selecione...</option>
                {db.clientes.map((c) => (
                  <option key={c.id} value={c.id}>{c.nome}{c.doc ? ` (${c.doc})` : " — sem CPF/CNPJ"}</option>
                ))}
              </select>
            </Field>
            <Field label="Descrição do serviço" span>
              <textarea value={form.descricao_servico || ""} onChange={set("descricao_servico")} placeholder="Ex: Desenvolvimento de site institucional" />
            </Field>
            <Field label="Valor (R$) *"><input type="number" value={form.valor ?? ""} onChange={set("valor")} /></Field>
            <Field label="Cód. serviço municipal"><input value={form.municipalServiceCode || ""} onChange={set("municipalServiceCode")} placeholder="opcional (usa padrão do .env)" /></Field>
          </div>
          <div className="tiny" style={{ marginTop: 8 }}>
            A nota é criada e autorizada no Asaas. O PDF/XML aparecem aqui quando a prefeitura processar.
          </div>
          <div className="mact">
            <button className="btn" onClick={() => setOpen(false)}>Cancelar</button>
            <button className="btn btn-p" onClick={emitir} disabled={saving}>{saving ? "Emitindo..." : "Emitir"}</button>
          </div>
        </Modal>
      )}
    </>
  );
}
