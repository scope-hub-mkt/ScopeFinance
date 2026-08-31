"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Field, Modal } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { AvatarFoto } from "./AvatarFoto";
import { acaoConvidar, acaoDesativar, acaoReativar, acaoSalvarUsuario } from "./actions";

export interface LinhaUsuario {
  id: string;
  nome: string;
  email: string;
  papel: "admin" | "financeiro" | "leitura";
  ativo: boolean;
  master: boolean;
  foto_url: string | null;
  created_at: string;
}

const PAPEIS: { valor: LinhaUsuario["papel"]; rotulo: string; descricao: string }[] = [
  { valor: "admin", rotulo: "Administrador", descricao: "Administra usuários, além de operar." },
  { valor: "financeiro", rotulo: "Financeiro", descricao: "Opera cobrança, baixa e notas." },
  { valor: "leitura", rotulo: "Leitura", descricao: "Consulta e não escreve." },
];

/**
 * Uma senha provisória que alguém consegue ditar por telefone.
 *
 * ⚖️ **Sem alfabeto ambíguo, de propósito.** `0`/`O` e `1`/`l`/`I` produzem a
 * ligação de suporte que este campo existe para evitar. E ela é **provisória**:
 * a tela pede a troca no primeiro acesso, em Perfil.
 */
function senhaProvisoria(): string {
  const alfabeto = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint32Array(14);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alfabeto[b % alfabeto.length]).join("");
}

/**
 * A administração de quem entra no ScopeFinance — `RF-FIN-10`.
 *
 * ⛔ **Desativar, nunca excluir.** Apagar a linha deixaria toda cobrança, baixa
 * e nota emitida por essa pessoa apontando para um usuário que não existe — e a
 * trilha de quem fez o quê é o que torna o financeiro auditável.
 */
export function TabelaUsuarios({
  usuarios,
  eu,
}: {
  usuarios: LinhaUsuario[];
  eu: { id: string; papel: string; master: boolean };
}) {
  const [pendente, iniciar] = useTransition();
  const [convidando, setConvidando] = useState(false);
  const [recado, setRecado] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [form, setForm] = useState({
    nome: "",
    email: "",
    papel: "financeiro" as LinhaUsuario["papel"],
    senha: senhaProvisoria(),
  });

  const souAdmin = eu.papel === "admin";

  const convidar = () =>
    iniciar(async () => {
      const r = await acaoConvidar(form);
      setRecado(
        r.ok
          ? { tipo: "ok", texto: r.aviso ?? "Cadastrado." }
          : { tipo: "erro", texto: r.erro ?? "Erro." }
      );
      if (r.ok) setConvidando(false);
    });

  const trocarPapel = (u: LinhaUsuario, papel: LinhaUsuario["papel"]) =>
    iniciar(async () => {
      const r = await acaoSalvarUsuario({ id: u.id, nome: u.nome, papel });
      if (!r.ok) setRecado({ tipo: "erro", texto: r.erro ?? "Erro." });
    });

  const alternarAcesso = (u: LinhaUsuario) =>
    iniciar(async () => {
      const r = u.ativo ? await acaoDesativar(u.id) : await acaoReativar(u.id);
      setRecado(
        r.ok
          ? { tipo: "ok", texto: r.aviso ?? "Pronto." }
          : { tipo: "erro", texto: r.erro ?? "Erro." }
      );
    });

  return (
    <>
      {recado && (
        <div className={`recado ${recado.tipo === "ok" ? "recado-ok" : "recado-erro"}`} role="status">
          {recado.texto}
        </div>
      )}

      {souAdmin && (
        <div className="mact" style={{ borderTop: "none", marginTop: 0 }}>
          <button
            className="btn btn-p"
            type="button"
            onClick={() => {
              setForm({ nome: "", email: "", papel: "financeiro", senha: senhaProvisoria() });
              setConvidando(true);
            }}
          >
            <i className="ti ti-user-plus" aria-hidden="true" /> Cadastrar pessoa
          </button>
        </div>
      )}

      <div className="card tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>Pessoa</th>
              <th>Papel</th>
              <th>Situação</th>
              <th>Desde</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {!usuarios.length && (
              <tr>
                <td colSpan={5}>
                  <div className="empty">Nenhum usuário</div>
                </td>
              </tr>
            )}
            {usuarios.map((u) => (
              <tr key={u.id}>
                <td>
                  <div className="cel-pessoa">
                    <AvatarFoto nome={u.nome} foto={u.foto_url} sm />
                    <div>
                      <div className="cel-pessoa-n">
                        {u.nome}
                        {u.id === eu.id && <span className="tiny"> · você</span>}
                      </div>
                      <div className="tiny sigilo">{u.email}</div>
                    </div>
                  </div>
                </td>
                <td>
                  {/* ⛔ O papel da própria conta não é editável aqui: o caminho
                      "administrar usuários" não pode ser também o caminho de
                      alterar a si mesmo sem que ninguém veja. E a conta
                      administradora não se rebaixa — a trava está no domínio,
                      esta é só a metade visível dela. */}
                  {souAdmin && u.id !== eu.id && !u.master ? (
                    <select
                      value={u.papel}
                      disabled={pendente}
                      onChange={(e) => trocarPapel(u, e.target.value as LinhaUsuario["papel"])}
                    >
                      {PAPEIS.map((p) => (
                        <option key={p.valor} value={p.valor} title={p.descricao}>
                          {p.rotulo}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="bdg bdg-x">
                      {PAPEIS.find((p) => p.valor === u.papel)?.rotulo ?? u.papel}
                    </span>
                  )}
                  {u.master && <span className="tiny"> · administradora</span>}
                </td>
                <td>
                  <span className={`bdg ${u.ativo ? "bdg-g" : "bdg-r"}`}>
                    {u.ativo ? "Ativo" : "Sem acesso"}
                  </span>
                </td>
                <td className="tiny">{fmtDate(u.created_at)}</td>
                <td>
                  <div className="actions">
                    {(eu.master || u.id === eu.id) && (
                      <Link className="btn btn-sm" href={`/usuarios/${u.id}`}>
                        <i className="ti ti-id-badge-2" aria-hidden="true" /> Cadastro
                      </Link>
                    )}
                    {souAdmin && u.id !== eu.id && !u.master && (
                      <button
                        className={`btn btn-sm${u.ativo ? " btn-d" : ""}`}
                        type="button"
                        disabled={pendente}
                        onClick={() => alternarAcesso(u)}
                      >
                        <i
                          className={`ti ti-${u.ativo ? "user-off" : "user-check"}`}
                          aria-hidden="true"
                        />
                        {u.ativo ? "Tirar acesso" : "Reativar"}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {convidando && (
        <Modal title="Cadastrar pessoa" onClose={() => setConvidando(false)}>
          <div className="recado recado-info">
            A senha abaixo é <strong>provisória</strong> e aparece uma única vez — passe-a à pessoa
            e peça para trocá-la no primeiro acesso, em Perfil. Ela não fica gravada em lugar nenhum.
          </div>
          <div className="fgrid">
            <Field label="Nome *" span>
              <input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
            </Field>
            <Field label="E-mail *" span>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
            <Field label="Papel">
              <select
                value={form.papel}
                onChange={(e) => setForm({ ...form, papel: e.target.value as LinhaUsuario["papel"] })}
              >
                {PAPEIS.map((p) => (
                  <option key={p.valor} value={p.valor}>
                    {p.rotulo}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Senha provisória">
              <input
                className="mono"
                value={form.senha}
                onChange={(e) => setForm({ ...form, senha: e.target.value })}
              />
            </Field>
          </div>
          <div className="mact">
            <button className="btn" type="button" onClick={() => setConvidando(false)}>
              Cancelar
            </button>
            <button
              className="btn btn-p"
              type="button"
              disabled={pendente || !form.nome || !form.email}
              onClick={convidar}
            >
              {pendente ? "Cadastrando..." : "Cadastrar"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
