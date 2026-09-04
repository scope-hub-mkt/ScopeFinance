"use client";

import { useState } from "react";
import Link from "next/link";
import { useStore, useRecursos } from "@/lib/store";
import { Badge, Field, Modal, MetricGrid, PageHeader, Dinheiro } from "@/components/ui";
import { BaixaModal } from "@/components/BaixaModal";
import { fmt, fmtDate, today } from "@/lib/format";

type Form = Record<string, any>;

/**
 * A lista e o formulário do recebível manual.
 *
 * ⚖️ **`origem_lancamento` não é campo do formulário, e isso é deliberado.**
 * A coluna tem default `'manual'` no banco e **não está** em
 * `resources.contas_receber.columns` — logo a tela não consegue gravá-la nem
 * por engano. Criar aqui produz `'manual'` porque o banco decide, não porque
 * o formulário lembrou. Deixar o campo editável abriria o caminho de marcar
 * uma linha digitada como se fosse do gateway, que é exatamente o que a
 * separação existe para impedir.
 */
export function RecebiveisManuais() {
  const { db, create, update, remove, getCN } = useStore();
  // `D-91`: a tela pede o que usa.
  useRecursos("clientes", "contas_receber");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>({});
  const [saving, setSaving] = useState(false);
  const [baixa, setBaixa] = useState<Form | null>(null);

  const novo = () => {
    setForm({ status: "Pendente", forma_pagamento: "PIX", vencimento: today() });
    setOpen(true);
  };
  const editar = (r: Form) => {
    setForm(r);
    setOpen(true);
  };

  const salvar = async () => {
    if (!form.descricao || !form.valor) {
      alert("Descrição e valor são obrigatórios");
      return;
    }
    setSaving(true);
    try {
      if (form.id) await update("contas_receber", form.id, form);
      else await create("contas_receber", form);
      setOpen(false);
    } catch {
      /* o store já reporta */
    } finally {
      setSaving(false);
    }
  };

  const excluir = async (id: string) => {
    if (confirm("Excluir recebível manual?")) await remove("contas_receber", id);
  };
  const set = (k: string) => (e: any) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const t = today();
  const list = [...db.contas_receber.filter((r) => r.origem_lancamento === "manual")].sort((a, b) =>
    (a.vencimento || "") > (b.vencimento || "") ? 1 : -1
  );

  const tot = list.reduce((s, r) => s + Number(r.valor || 0), 0);
  const pg = list.filter((r) => r.status === "Pago").reduce((s, r) => s + Number(r.valor || 0), 0);
  const pd = list.filter((r) => r.status === "Pendente").reduce((s, r) => s + Number(r.valor || 0), 0);
  const clientesAtivos = db.clientes.filter((c) => c.status === "Ativo");

  return (
    <>
      <PageHeader title="">
        <button className="btn btn-p" onClick={novo}>
          <i className="ti ti-plus" />
          Novo recebível manual
        </button>
      </PageHeader>

      <div className="recado">
        Estas cobranças <strong>não vieram do Asaas</strong>. Elas não entram no
        faturamento do gateway, não atravessam a ponte para a Dashboard e não
        servem de base para comissão (<code>RN-52</code>). O que o gateway cobrou
        está em <Link href="/receber">Contas a receber</Link>.
      </div>

      <MetricGrid
        items={[
          {
            l: "Total fora do gateway",
            v: fmt(tot),
            icone: "pencil",
            fonte: "contas a receber com origem manual",
          },
          {
            l: "Baixado à mão",
            v: fmt(pg),
            c: "c-green",
            icone: "circle-check",
            fonte: "contas a receber com origem manual e status Pago",
          },
          {
            l: "Pendente",
            v: fmt(pd),
            c: "c-orange",
            icone: "clock",
            fonte: "contas a receber com origem manual e status Pendente",
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
                    Nenhum recebível manual — e o normal é que continue assim
                  </div>
                </td>
              </tr>
            )}
            {list.map((r) => {
              const venc = r.vencimento && r.status === "Pendente" && r.vencimento < t;
              return (
                <tr key={r.id}>
                  <td className="sigilo">{getCN(r.cliente_id)}</td>
                  <td className="sigilo">{r.descricao}</td>
                  <td style={{ fontWeight: 500 }}>
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
                      {r.status === "Pendente" && (
                        <button
                          className="btn btn-sm btn-s"
                          title="Dar baixa"
                          onClick={() => setBaixa(r)}
                        >
                          <i className="ti ti-check" />
                        </button>
                      )}
                      <button className="btn btn-sm" onClick={() => editar(r)}>
                        <i className="ti ti-edit" />
                      </button>
                      <button className="btn btn-sm btn-d" onClick={() => excluir(r.id)}>
                        <i className="ti ti-trash" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {open && (
        <Modal title="Recebível manual" onClose={() => setOpen(false)}>
          <div className="fgrid">
            <Field label="Cliente" span>
              <select value={form.cliente_id || ""} onChange={set("cliente_id")}>
                <option value="">Selecione...</option>
                {clientesAtivos.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Descrição *" span>
              <input value={form.descricao || ""} onChange={set("descricao")} />
            </Field>
            <Field label="Valor (R$) *">
              <input type="number" value={form.valor ?? ""} onChange={set("valor")} />
            </Field>
            <Field label="Vencimento *">
              <input type="date" value={form.vencimento || ""} onChange={set("vencimento")} />
            </Field>
            <Field label="Forma de pagamento">
              <select value={form.forma_pagamento || "PIX"} onChange={set("forma_pagamento")}>
                <option>PIX</option>
                <option>Boleto</option>
                <option>Cartão de crédito</option>
                <option>Transferência</option>
                <option>Dinheiro</option>
              </select>
            </Field>
            <Field label="Status">
              <select value={form.status || "Pendente"} onChange={set("status")}>
                <option>Pendente</option>
                <option>Pago</option>
                <option>Vencido</option>
                <option>Cancelado</option>
              </select>
            </Field>
          </div>
          <div className="mact">
            <button className="btn" onClick={() => setOpen(false)}>
              Cancelar
            </button>
            <button className="btn btn-p" onClick={salvar} disabled={saving}>
              {saving ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </Modal>
      )}

      {baixa && (
        <BaixaModal tabela="contas_receber" item={baixa} onClose={() => setBaixa(null)} />
      )}
    </>
  );
}
