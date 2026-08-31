"use client";

import { useRef, useState, useTransition } from "react";
import { Field } from "@/components/ui";
import {
  acaoRemoverFoto,
  acaoSalvarUsuario,
  acaoTrocarEmail,
  acaoTrocarFoto,
  acaoTrocarSenha,
} from "./actions";
import { AvatarFoto } from "./AvatarFoto";

export interface UsuarioParaTela {
  id: string;
  nome: string;
  email: string;
  papel: "admin" | "financeiro" | "leitura";
  ativo: boolean;
  master: boolean;
  telefone: string | null;
  documento: string | null;
  data_nascimento: string | null;
  foto_url: string | null;
  sobre: string | null;
}

/** Formata o CPF só para exibir. O que se grava são os dígitos. */
function mascararCpf(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d{1,2})$/, ".$1-$2");
}

function mascararTelefone(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 10) return d.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d)/, "$1-$2");
  return d.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");
}

type Estado = { tipo: "ok" | "erro"; texto: string } | null;

function Recado({ estado }: { estado: Estado }) {
  if (!estado) return null;
  return (
    <div className={`recado ${estado.tipo === "ok" ? "recado-ok" : "recado-erro"}`} role="status">
      {estado.texto}
    </div>
  );
}

/**
 * O **CRUD do cadastro de uma pessoa** — `RF-FIN-10`.
 *
 * ⚖️ **Três blocos que salvam separado, e não um botão só.** Dado pessoal,
 * senha e e-mail têm exigências diferentes: os dois últimos pedem a senha
 * atual, e o e-mail ainda depende de uma confirmação que chega depois. Um
 * "salvar" único obrigaria a digitar a senha para corrigir um telefone — e
 * faria a troca de e-mail parecer concluída quando ela apenas começou.
 */
export function FormularioUsuario({
  usuario,
  ehOutroUsuario = false,
}: {
  usuario: UsuarioParaTela;
  /** `true` quando a conta administradora edita outra pessoa. */
  ehOutroUsuario?: boolean;
}) {
  const [pendente, iniciar] = useTransition();
  const [foto, setFoto] = useState(usuario.foto_url);

  const [dados, setDados] = useState({
    nome: usuario.nome,
    telefone: usuario.telefone ?? "",
    documento: usuario.documento ? mascararCpf(usuario.documento) : "",
    data_nascimento: usuario.data_nascimento ?? "",
    sobre: usuario.sobre ?? "",
  });
  const [avisoDados, setAvisoDados] = useState<Estado>(null);

  const [senha, setSenha] = useState({ atual: "", nova: "", repetida: "" });
  const [avisoSenha, setAvisoSenha] = useState<Estado>(null);

  const [email, setEmail] = useState({ novo: "", senhaAtual: "" });
  const [avisoEmail, setAvisoEmail] = useState<Estado>(null);

  const [avisoFoto, setAvisoFoto] = useState<Estado>(null);
  const inputFoto = useRef<HTMLInputElement>(null);

  const alvo = ehOutroUsuario ? { id: usuario.id } : {};
  // Quem edita outra pessoa não informa a senha atual — não a tem, e é
  // justamente esse o caminho que destrava quem perdeu o acesso.
  const exigeSenhaAtual = !ehOutroUsuario;

  const resposta = (set: (e: Estado) => void) => (r: { ok: boolean; erro?: string; aviso?: string }) =>
    set(
      r.ok
        ? { tipo: "ok", texto: r.aviso ?? "Pronto." }
        : { tipo: "erro", texto: r.erro ?? "Não deu para salvar." }
    );

  const salvarDados = () =>
    iniciar(async () => {
      setAvisoDados(null);
      resposta(setAvisoDados)(await acaoSalvarUsuario({ ...alvo, ...dados }));
    });

  const enviarFoto = (arquivo: File) =>
    iniciar(async () => {
      setAvisoFoto(null);
      const form = new FormData();
      form.set("foto", arquivo);
      if (ehOutroUsuario) form.set("usuario_id", usuario.id);
      const r = await acaoTrocarFoto(form);
      // O `objectURL` mostra a foto nova sem esperar o servidor devolver a URL
      // pública — o upload já terminou, e um avatar que só troca no próximo
      // carregamento faz a ação parecer que não funcionou.
      if (r.ok) setFoto(URL.createObjectURL(arquivo));
      resposta(setAvisoFoto)(r);
      if (inputFoto.current) inputFoto.current.value = "";
    });

  const removerFoto = () =>
    iniciar(async () => {
      const r = await acaoRemoverFoto(ehOutroUsuario ? usuario.id : undefined);
      if (r.ok) setFoto(null);
      resposta(setAvisoFoto)(r);
    });

  const trocarSenha = () =>
    iniciar(async () => {
      setAvisoSenha(null);
      // ⛔ A conferência da repetição é DAQUI: no servidor as duas chegariam
      // como uma só, e um erro de digitação viraria uma senha que ninguém sabe.
      if (senha.nova !== senha.repetida) {
        setAvisoSenha({ tipo: "erro", texto: "A repetição não confere com a senha nova." });
        return;
      }
      const r = await acaoTrocarSenha({
        ...alvo,
        senha_atual: exigeSenhaAtual ? senha.atual : undefined,
        senha_nova: senha.nova,
      });
      if (r.ok) setSenha({ atual: "", nova: "", repetida: "" });
      resposta(setAvisoSenha)(r);
    });

  const trocarEmail = () =>
    iniciar(async () => {
      setAvisoEmail(null);
      const r = await acaoTrocarEmail({
        ...alvo,
        email_novo: email.novo,
        senha_atual: exigeSenhaAtual ? email.senhaAtual : undefined,
      });
      if (r.ok) setEmail({ novo: "", senhaAtual: "" });
      resposta(setAvisoEmail)(r);
    });

  return (
    <div className="cardgrid">
      <div className="card">
        <div className="card-t">Foto de perfil</div>
        <div className="foto-editor">
          <AvatarFoto nome={dados.nome || usuario.nome} foto={foto} gd />
          <div className="foto-editor-acoes">
            <label className="btn btn-sm">
              <i className="ti ti-upload" aria-hidden="true" /> Escolher foto
              <input
                ref={inputFoto}
                className="foto-arquivo"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={pendente}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) enviarFoto(f);
                }}
              />
            </label>
            {foto && (
              <button className="btn btn-sm btn-d" type="button" disabled={pendente} onClick={removerFoto}>
                <i className="ti ti-trash" aria-hidden="true" /> Remover
              </button>
            )}
            <div className="foto-dica">JPG, PNG ou WebP, até 2 MB. Sem foto, ficam as iniciais.</div>
          </div>
        </div>
        <Recado estado={avisoFoto} />
      </div>

      <div className="card">
        <div className="card-t">Dados pessoais</div>
        <div className="fgrid">
          <Field label="Nome *">
            <input value={dados.nome} onChange={(e) => setDados({ ...dados, nome: e.target.value })} />
          </Field>
          <Field label="Telefone">
            <input
              value={dados.telefone}
              inputMode="tel"
              onChange={(e) => setDados({ ...dados, telefone: mascararTelefone(e.target.value) })}
            />
          </Field>
          <Field label="CPF" ajuda="Opcional. Dois cadastros com o mesmo CPF são recusados.">
            <input
              value={dados.documento}
              inputMode="numeric"
              onChange={(e) => setDados({ ...dados, documento: mascararCpf(e.target.value) })}
            />
          </Field>
          <Field label="Data de nascimento">
            <input
              type="date"
              value={dados.data_nascimento}
              onChange={(e) => setDados({ ...dados, data_nascimento: e.target.value })}
            />
          </Field>
          <Field label="Sobre" span>
            <textarea
              rows={2}
              value={dados.sobre}
              onChange={(e) => setDados({ ...dados, sobre: e.target.value })}
            />
          </Field>
        </div>
        <Recado estado={avisoDados} />
        <div className="mact">
          <button className="btn btn-p" type="button" disabled={pendente} onClick={salvarDados}>
            {pendente ? "Salvando..." : "Salvar dados"}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-t">Senha</div>
        {!exigeSenhaAtual && (
          <div className="recado recado-atencao">
            Você está trocando a senha de outra pessoa. Isso é dar acesso à conta dela — existe para
            destravar quem perdeu o acesso, não para entrar como um colega.
          </div>
        )}
        <div className="fgrid">
          {exigeSenhaAtual && (
            <Field label="Senha atual" span>
              <input
                type="password"
                autoComplete="current-password"
                value={senha.atual}
                onChange={(e) => setSenha({ ...senha, atual: e.target.value })}
              />
            </Field>
          )}
          <Field label="Nova senha" ajuda="Mínimo de 8 caracteres.">
            <input
              type="password"
              autoComplete="new-password"
              value={senha.nova}
              onChange={(e) => setSenha({ ...senha, nova: e.target.value })}
            />
          </Field>
          <Field label="Repita a nova senha">
            <input
              type="password"
              autoComplete="new-password"
              value={senha.repetida}
              onChange={(e) => setSenha({ ...senha, repetida: e.target.value })}
            />
          </Field>
        </div>
        <Recado estado={avisoSenha} />
        <div className="mact">
          <button
            className="btn btn-p"
            type="button"
            disabled={pendente || !senha.nova}
            onClick={trocarSenha}
          >
            Trocar senha
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-t">E-mail</div>
        <div className="recado recado-info">
          {exigeSenhaAtual ? (
            <>
              Atual: <strong>{usuario.email}</strong>. Enviamos um link para o endereço novo — até
              você clicar nele, continue entrando com o atual. É isso que impede um erro de
              digitação de trancar você para fora.
            </>
          ) : (
            <>
              Atual: <strong>{usuario.email}</strong>. Como conta administradora, a troca vale na
              hora, sem confirmação — confira a digitação antes de salvar.
            </>
          )}
        </div>
        <div className="fgrid">
          <Field label="Novo e-mail" span={!exigeSenhaAtual}>
            <input
              type="email"
              autoComplete="email"
              value={email.novo}
              onChange={(e) => setEmail({ ...email, novo: e.target.value })}
            />
          </Field>
          {exigeSenhaAtual && (
            <Field label="Senha atual">
              <input
                type="password"
                autoComplete="current-password"
                value={email.senhaAtual}
                onChange={(e) => setEmail({ ...email, senhaAtual: e.target.value })}
              />
            </Field>
          )}
        </div>
        <Recado estado={avisoEmail} />
        <div className="mact">
          <button
            className="btn btn-p"
            type="button"
            disabled={pendente || !email.novo}
            onClick={trocarEmail}
          >
            Trocar e-mail
          </button>
        </div>
      </div>
    </div>
  );
}
