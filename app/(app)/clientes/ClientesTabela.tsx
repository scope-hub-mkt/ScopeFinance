"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Field, Modal } from "@/components/ui";
import { useStore } from "@/lib/store";
import type { ClienteLista } from "@/lib/etl/alimentadores";

type Form = Record<string, unknown>;

/**
 * A ilha de cliente da tela de Clientes — `D-91` (30/08/2026).
 *
 * ⚖️ **Por que uma ilha, e não a tela inteira no cliente.** A lista é dado que
 * o servidor já preparou; só a *edição* precisa de estado no navegador. Manter
 * a tabela no servidor e trazer para cá apenas busca, modal e as três chamadas
 * de escrita é o que faz o front ficar leve sem perder nada de interação.
 *
 * ⛔ **Escrever aqui NÃO recarrega a tabela pelo navegador.** Depois de gravar,
 * a ilha pede `router.refresh()` e o servidor devolve a lista já triturada —
 * era exatamente a segunda carga completa que o `useStore().refresh()` fazia.
 */
export function ClientesTabela({
  clientes,
  truncado,
  idadeS,
}: {
  clientes: ClienteLista[];
  truncado: boolean;
  idadeS: number;
}) {
  const router = useRouter();
  const { notify } = useStore();
  const [pendente, iniciar] = useTransition();
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState<Form>({});
  const [salvando, setSalvando] = useState(false);

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return clientes;
    return clientes.filter(
      (c) =>
        c.nome?.toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q) ||
        (c.doc ?? "").toLowerCase().includes(q)
    );
  }, [clientes, busca]);

  const novo = () => {
    setForm({ status: "Ativo", tipo: "Pessoa Física" });
    setAberto(true);
  };
  const editar = (c: ClienteLista) => {
    setForm({ ...c });
    setAberto(true);
  };

  async function chamar(url: string, init: RequestInit) {
    const res = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init.headers || {}) },
    });
    const texto = await res.text();
    const corpo = texto ? JSON.parse(texto) : null;
    if (!res.ok) throw new Error(corpo?.error || `Erro ${res.status}`);
    return corpo;
  }

  const salvar = async () => {
    if (!form.nome) {
      notify("Nome é obrigatório", "err");
      return;
    }
    setSalvando(true);
    try {
      if (form.id) {
        await chamar(`/api/clientes/${form.id}`, { method: "PATCH", body: JSON.stringify(form) });
      } else {
        await chamar("/api/clientes", { method: "POST", body: JSON.stringify(form) });
      }
      setAberto(false);
      notify(form.id ? "Registro atualizado." : "Registro criado.", "ok");
      iniciar(() => router.refresh());
    } catch (e) {
      notify(e instanceof Error ? e.message : "Erro ao salvar", "err");
    } finally {
      setSalvando(false);
    }
  };

  const excluir = async (id: string) => {
    if (!confirm("Excluir cliente?")) return;
    try {
      await chamar(`/api/clientes/${id}`, { method: "DELETE" });
      notify("Registro removido.", "ok");
      iniciar(() => router.refresh());
    } catch (e) {
      notify(e instanceof Error ? e.message : "Erro ao excluir", "err");
    }
  };

  const set = (k: string) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <>
      <div className="sbar">
        <i className="ti ti-search muted" />
        <input
          placeholder="Buscar por nome, email ou documento..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
        <span className="tiny">{lista.length} cliente(s)</span>
        {/* RNF-19 da Dashboard, mesma doutrina: retrato datado se declara. */}
        <span className="tiny muted">
          retrato de {idadeS < 60 ? `${idadeS}s` : `${Math.round(idadeS / 60)} min`}
          {pendente ? " · atualizando…" : ""}
        </span>
        <button className="btn btn-p" style={{ marginLeft: "auto" }} onClick={novo}>
          <i className="ti ti-plus" />
          Novo cliente
        </button>
      </div>

      {truncado && (
        // RNF-20: lista cortada se declara cortada. Uma tabela que mostra as
        // primeiras 2000 linhas sem dizer nada é indistinguível de completa.
        <div className="aviso-parcial" role="status">
          <i className="ti ti-alert-triangle" />
          <span>
            A carteira passou do teto desta tela e a lista está cortada — use a
            busca para chegar a quem não aparece.
          </span>
        </div>
      )}

      <div className="card tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Tipo</th>
              <th>Email</th>
              <th>Telefone</th>
              <th>Origem</th>
              <th>Status</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {!lista.length && (
              <tr>
                <td colSpan={7}>
                  <div className="empty">Nenhum cliente cadastrado</div>
                </td>
              </tr>
            )}
            {lista.map((c) => (
              <tr key={c.id}>
                <td>
                  <strong>{c.nome}</strong>
                  {c.doc && (
                    <>
                      <br />
                      <span className="tiny">{c.doc}</span>
                    </>
                  )}
                </td>
                <td className="muted">{c.tipo || "—"}</td>
                <td className="muted">{c.email || "—"}</td>
                <td className="muted">{c.tel || "—"}</td>
                <td>
                  {/* Procedência declarada (RNF-19 da Dashboard): um cliente
                      que chegou pela replicação e um que foi digitado aqui não
                      são a mesma coisa na hora de auditar uma divergência. */}
                  <span className={`bdg ${c.origem === "dashboard" ? "bdg-b" : "bdg-x"}`}>
                    {c.origem === "dashboard" ? "Dashboard" : "Finance"}
                  </span>
                </td>
                <td>
                  <Badge s={c.status || "Ativo"} />
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
            ))}
          </tbody>
        </table>
      </div>

      {aberto && (
        <Modal title="Cliente" onClose={() => setAberto(false)}>
          <div className="fgrid">
            <Field label="Nome *">
              <input
                value={(form.nome as string) || ""}
                onChange={set("nome")}
                placeholder="Nome completo"
              />
            </Field>
            <Field label="Tipo">
              <select value={(form.tipo as string) || "Pessoa Física"} onChange={set("tipo")}>
                <option>Pessoa Física</option>
                <option>Pessoa Jurídica</option>
              </select>
            </Field>
            <Field label="CPF/CNPJ">
              <input value={(form.doc as string) || ""} onChange={set("doc")} />
            </Field>
            <Field label="Email">
              <input type="email" value={(form.email as string) || ""} onChange={set("email")} />
            </Field>
            <Field label="Telefone">
              <input value={(form.tel as string) || ""} onChange={set("tel")} />
            </Field>
            <Field label="Status">
              <select value={(form.status as string) || "Ativo"} onChange={set("status")}>
                <option>Ativo</option>
                <option>Inativo</option>
                <option>Prospect</option>
              </select>
            </Field>
            <Field label="Endereço" span>
              <input value={(form.endereco as string) || ""} onChange={set("endereco")} />
            </Field>
            <Field label="Observações" span>
              <textarea value={(form.obs as string) || ""} onChange={set("obs")} />
            </Field>
          </div>
          <p className="tiny" style={{ marginTop: 10, lineHeight: 1.6 }}>
            ⚠ Este cadastro é compartilhado com a Scope Dashboard: salvar aqui
            replica para lá com o mesmo id. O CPF/CNPJ é único — comparado só
            pelos dígitos, então “12.345.678/0001-90” e “12345678000190” são o
            mesmo documento.
          </p>
          <div className="mact">
            <button className="btn" onClick={() => setAberto(false)}>
              Cancelar
            </button>
            <button className="btn btn-p" onClick={salvar} disabled={salvando}>
              {salvando ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
