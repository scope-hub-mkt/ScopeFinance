"use client";

import { useState } from "react";
import { useStore, useRecursos } from "@/lib/store";
import type { Banco } from "@/lib/types";
import { Field, Modal, Dinheiro, Empty } from "@/components/ui";

type Form = Record<string, unknown>;

/**
 * As contas do **caixa interno** — o que sobrou da tela antiga de `/bancos`.
 *
 * ⚖️ **Por que este pedaço continua existindo depois de a tela virar leitura
 * do Asaas.** `contas_receber.conta_id`, `contas_pagar.conta_id`,
 * `assinaturas.conta_id` e `lancamentos.conta_id` todos apontam para `bancos`:
 * é aqui que a baixa de uma cobrança diz *onde* o dinheiro entrou. Apagar a
 * tabela para "ficar tudo real" deixaria toda baixa sem destino.
 *
 * ⛔ **O que mudou é o que a tela AFIRMA.** Antes a linha "Asaas" exibia
 * R$ 429,47 como se fosse o saldo do gateway — e o saldo do gateway era
 * R$ 13,79. Agora o saldo do Asaas vem do Asaas, no bloco de cima, e o número
 * daqui é declarado pelo que ele é: **soma dos lançamentos que esta conta
 * recebeu neste sistema**, mantida pelo gatilho `apply_lancamento_saldo`. Dois
 * números continuam existindo porque medem coisas diferentes; o defeito era
 * um deles se apresentar como o outro.
 */
export function ContasInternas() {
  const { db, create, update, remove } = useStore();
  // `D-91`: esta tela pede o que usa — antes o provider trazia as 10 tabelas.
  useRecursos("bancos");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>({});
  const [saving, setSaving] = useState(false);

  const novo = () => {
    setForm({ tipo: "Conta corrente" });
    setOpen(true);
  };
  const editar = (b: Banco) => {
    setForm({ ...b });
    setOpen(true);
  };

  const salvar = async () => {
    if (!form.nome) {
      alert("Nome da conta é obrigatório");
      return;
    }
    setSaving(true);
    try {
      if (form.id) await update("bancos", String(form.id), form);
      else await create("bancos", form);
      setOpen(false);
    } catch {
      /* o store já notifica */
    } finally {
      setSaving(false);
    }
  };

  const excluir = async (id: string) => {
    // ⚠️ Confirmação NOMINAL: a conta é destino de lançamento, e apagá-la
    // deixa a baixa já feita apontando para lugar nenhum (`on delete set null`).
    if (
      confirm(
        "Excluir esta conta do caixa interno?\n\n" +
          "Baixas e lançamentos já registrados nela ficam SEM conta de destino — " +
          "o valor não some, mas deixa de ter onde entrou."
      )
    ) {
      await remove("bancos", id);
    }
  };

  const set = (k: string) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <section>
      <div className="row" style={{ marginBottom: "var(--e-3)" }}>
        <h2 className="pt" style={{ fontSize: "1rem" }}>
          Contas do caixa interno <span className="tiny muted">({db.bancos.length})</span>
        </h2>
        <button className="btn btn-sm" onClick={novo}>
          <i className="ti ti-plus" />
          Nova conta
        </button>
      </div>

      <div className="card" style={{ marginBottom: "var(--e-4)" }}>
        <p className="tiny muted" style={{ margin: 0 }}>
          Estas contas <strong>não são lidas do banco nem do Asaas</strong>. Elas existem para que
          uma baixa possa dizer onde o dinheiro entrou, e o saldo abaixo é a soma dos lançamentos
          registrados aqui — não o extrato de uma instituição. O saldo que vale como dinheiro real
          é o da conta Asaas, no topo desta tela.
        </p>
      </div>

      {!db.bancos.length ? (
        <Empty icone="ti-building-bank">
          Nenhuma conta de caixa cadastrada — as baixas ficarão sem destino.
        </Empty>
      ) : (
        <div className="card tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Conta</th>
                <th>Instituição</th>
                <th>Tipo</th>
                <th>Soma dos lançamentos</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {db.bancos.map((b) => (
                <tr key={b.id}>
                  <td style={{ fontWeight: 500 }}>{b.nome}</td>
                  <td>{b.banco || "—"}</td>
                  <td>{b.tipo}</td>
                  <td>
                    <Dinheiro v={b.saldo} />
                  </td>
                  <td>
                    <div className="actions">
                      <button className="btn btn-sm" onClick={() => editar(b)}>
                        <i className="ti ti-edit" />
                      </button>
                      <button className="btn btn-sm btn-d" onClick={() => excluir(b.id)}>
                        <i className="ti ti-trash" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <Modal title="Conta do caixa interno" onClose={() => setOpen(false)}>
          <div className="fgrid">
            <Field label="Nome da conta *" span>
              <input value={String(form.nome ?? "")} onChange={set("nome")} />
            </Field>
            <Field label="Instituição">
              <input value={String(form.banco ?? "")} onChange={set("banco")} />
            </Field>
            <Field label="Tipo">
              <select value={String(form.tipo ?? "Conta corrente")} onChange={set("tipo")}>
                <option>Conta corrente</option>
                <option>Conta poupança</option>
                <option>Conta digital</option>
              </select>
            </Field>
          </div>
          <div className="tiny" style={{ marginTop: "var(--e-2)" }}>
            {/* ⛔ O saldo saiu do formulário em 02/09/2026. Digitar saldo à mão foi
                exatamente o que produziu a linha "Asaas: R$ 429,47" ao lado de um
                gateway com R$ 13,79. Aqui o saldo só se move por lançamento. */}
            O saldo não é digitado: ele é a soma dos lançamentos vinculados a esta conta.
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
    </section>
  );
}
