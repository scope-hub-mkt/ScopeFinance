"use client";

import { useState } from "react";
import { useStore, useRecursos } from "@/lib/store";
import { Badge, Field, Modal, PageHeader, Dinheiro } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import {
  ItensDoContrato,
  rascunhoDe,
  somaItens,
  type ItemRascunho,
} from "./ItensDoContrato";

type Form = Record<string, any>;

export default function ContratosPage() {
  const { db, create, update, remove, getCN, refresh } = useStore();
  // `D-91`: esta tela pede o que usa — antes o provider trazia as 10 tabelas.
  // `contrato_servicos` entrou em 31/08/2026, com a ligação 1:N.
  useRecursos("clientes", "contratos", "contrato_servicos");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>({});
  const [itens, setItens] = useState<ItemRascunho[]>([]);
  const [saving, setSaving] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);

  const itensDo = (contratoId: string) =>
    db.contrato_servicos.filter((i) => i.contrato_id === contratoId);

  const novo = () => {
    setForm({ status: "Ativo", freq: "Único", categoria: "WebDesign" });
    setItens([]);
    setOpen(true);
  };

  const editar = (c: Form) => {
    setForm(c);
    setItens(itensDo(c.id).map(rascunhoDe));
    setOpen(true);
  };

  /**
   * Grava o contrato e, em seguida, **substitui a lista de serviços dele**.
   *
   * ⚖️ **A ordem importa e não é negociável:** o contrato primeiro, os itens
   * depois. `contrato_servicos.contrato_id` é `not null` — é a regra do dono,
   * *"um serviço deve possuir um contrato"*, e ela existe no banco justamente
   * para que a ordem inversa seja impossível, não só desaconselhada.
   *
   * ⛔ **Os itens vão numa requisição só, de propósito.** Gravá-los um a um
   * pela API CRUD seriam N chamadas sem transação entre elas: uma falha no
   * meio deixaria o contrato com parte dos serviços — dado errado, não
   * incompleto. `PUT /api/contratos/{id}/servicos` faz a troca inteira dentro
   * de uma transação do Postgres.
   */
  const salvar = async () => {
    if (!form.cliente_id) {
      alert("Selecione o cliente. Todo contrato tem um cliente.");
      return;
    }
    if (!itens.length) {
      alert("Adicione ao menos um serviço ao contrato.");
      return;
    }
    if (itens.some((i) => !i.descricao.trim())) {
      alert("Todo serviço precisa de uma descrição.");
      return;
    }
    if (!form.valor) {
      alert("Informe o valor do contrato.");
      return;
    }

    setSaving(true);
    try {
      // `create` devolve a linha gravada — é de lá que sai o id do contrato
      // novo. Na edição o id já está no formulário. Sem id não há onde
      // pendurar os itens, e seguir em frente criaria órfãos que o banco
      // recusaria um a um, com o contrato já gravado.
      let contratoId = String(form.id ?? "");
      if (contratoId) {
        await update("contratos", contratoId, form);
      } else {
        const criado = await create("contratos", form);
        contratoId = typeof criado?.id === "string" ? criado.id : "";
      }
      if (!contratoId) throw new Error("Contrato sem id após gravar.");

      const resposta = await fetch(`/api/contratos/${contratoId}/servicos`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itens: itens.map((i) => ({
            id: i.id ?? null,
            servico_id: i.servico_id,
            descricao: i.descricao.trim(),
            quantidade: i.quantidade,
            valor: i.valor,
            recorrencia: i.recorrencia,
          })),
        }),
      });
      if (!resposta.ok) {
        const corpo = await resposta.json().catch(() => ({}));
        throw new Error(corpo?.error ?? `Erro ${resposta.status} ao gravar os serviços.`);
      }

      // Dois recursos releem: os itens porque acabaram de mudar, e os
      // contratos porque `contratos.servico` é resumo escrito por GATILHO —
      // ele muda no banco sem que esta tela tenha pedido, e sem reler a tabela
      // mostraria o texto anterior até a próxima navegação.
      await refresh("contrato_servicos");
      await refresh("contratos");
      setOpen(false);
    } catch (e) {
      // O store notifica o que passa por ele; o `PUT` dos serviços não passa,
      // então o erro dele precisa aparecer aqui — senão o salvamento falha em
      // silêncio e o modal fica aberto sem explicar por quê.
      alert(e instanceof Error ? e.message : "Erro ao salvar o contrato.");
    } finally {
      setSaving(false);
    }
  };

  const excluir = async (id: string) => {
    if (confirm("Excluir contrato? Os serviços dele vão junto.")) {
      await remove("contratos", id);
      await refresh("contrato_servicos");
    }
  };

  const set = (k: string) => (e: any) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const clientesAtivos = db.clientes.filter((c) => c.status === "Ativo");

  return (
    <>
      <PageHeader title="Contratos">
        <button className="btn btn-p" onClick={novo}>
          <i className="ti ti-plus" />
          Novo contrato
        </button>
      </PageHeader>

      <div className="card tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Serviços</th>
              <th>Valor</th>
              <th>Início</th>
              <th>Término</th>
              <th>Status</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {!db.contratos.length && (
              <tr>
                <td colSpan={7}>
                  <div className="empty">Nenhum contrato</div>
                </td>
              </tr>
            )}
            {db.contratos.map((c) => {
              const meus = itensDo(c.id);
              const soma = somaItens(meus.map(rascunhoDe));
              // Comparação em centavos — ver `somaItens`.
              const diverge =
                meus.length > 0 &&
                Math.round(soma * 100) !== Math.round(Number(c.valor ?? 0) * 100);
              const expandido = aberto === c.id;
              return (
                <tr key={c.id}>
                  <td className="sigilo">{getCN(c.cliente_id)}</td>
                  <td>
                    {!meus.length ? (
                      // Contrato sem item não atravessa a ponte — a Dashboard o
                      // encerra. Dizer isso aqui é mais barato que descobrir
                      // depois, do outro lado, por ausência.
                      <span className="bdg bdg-r">Sem serviços</span>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="link"
                          aria-expanded={expandido}
                          onClick={() => setAberto(expandido ? null : c.id)}
                        >
                          {meus.length === 1 ? "1 serviço" : `${meus.length} serviços`}
                          <i className={`ti ti-chevron-${expandido ? "up" : "down"}`} />
                        </button>
                        {expandido && (
                          <ul className="contrato-servicos">
                            {meus.map((i) => (
                              <li key={i.id}>
                                <span>{i.descricao}</span>
                                {Number(i.quantidade) > 1 && (
                                  <span className="tiny">×{i.quantidade}</span>
                                )}
                                <span className="tiny"><Dinheiro v={i.valor} /></span>
                                {!i.servico_id && (
                                  <span className="bdg bdg-x" title="Não vinculado ao catálogo">
                                    sob medida
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </>
                    )}
                  </td>
                  <td className="c-orange" style={{ fontWeight: 500 }}>
                    <Dinheiro v={c.valor} />
                    <br />
                    <span className="tiny">{c.freq}</span>
                    {/* A divergência é declarada, nunca corrigida sozinha:
                        `contratos.valor` é o acordado, e é dele que a cobrança
                        sai. Ver `vw_contrato_servicos_totais`. */}
                    {diverge && (
                      <>
                        <br />
                        <span className="bdg bdg-r" title="A soma dos serviços não bate com o valor do contrato">
                          serviços somam <Dinheiro v={soma} />
                        </span>
                      </>
                    )}
                  </td>
                  <td className="tiny">{fmtDate(c.inicio)}</td>
                  <td className="tiny">{fmtDate(c.fim)}</td>
                  <td>
                    <Badge s={c.status} />
                  </td>
                  <td>
                    <div className="actions">
                      <button className="btn btn-sm" onClick={() => editar(c)}>
                        <i className="ti ti-edit" />
                      </button>
                      <button className="btn btn-sm btn-d" onClick={() => excluir(c.id)}>
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
        <Modal title="Contrato" onClose={() => setOpen(false)} largo>
          <div className="fgrid">
            <Field
              label="Cliente *"
              span
              ajuda="Todo contrato tem um cliente — a regra vale no banco, não só aqui."
            >
              <select value={form.cliente_id || ""} onChange={set("cliente_id")}>
                <option value="">Selecione...</option>
                {clientesAtivos.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </Field>

            <ItensDoContrato
              itens={itens}
              onChange={setItens}
              freqContrato={form.freq || "Único"}
              valorContrato={Number(form.valor) || 0}
            />

            <Field
              label="Valor do contrato (R$) *"
              ajuda="O valor acordado. É dele que a cobrança sai — a soma dos serviços é conferida, não imposta."
            >
              <input type="number" value={form.valor ?? ""} onChange={set("valor")} />
            </Field>
            <Field label="Frequência">
              <select value={form.freq || "Único"} onChange={set("freq")}>
                <option>Único</option>
                <option>Mensal</option>
                <option>Trimestral</option>
                <option>Anual</option>
              </select>
            </Field>
            <Field label="Início">
              <input type="date" value={form.inicio || ""} onChange={set("inicio")} />
            </Field>
            <Field label="Término">
              <input type="date" value={form.fim || ""} onChange={set("fim")} />
            </Field>
            <Field label="Status">
              <select value={form.status || "Ativo"} onChange={set("status")}>
                <option>Ativo</option>
                <option>Pausado</option>
                <option>Encerrado</option>
                <option>Em negociação</option>
              </select>
            </Field>
            <Field label="Categoria">
              <select value={form.categoria || "WebDesign"} onChange={set("categoria")}>
                <option>WebDesign</option>
                <option>Automação</option>
                <option>IA</option>
                <option>CRM</option>
                <option>Consultoria</option>
                <option>Outro</option>
              </select>
            </Field>
            <Field label="Observações" span>
              <textarea value={form.obs || ""} onChange={set("obs")} />
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
    </>
  );
}
