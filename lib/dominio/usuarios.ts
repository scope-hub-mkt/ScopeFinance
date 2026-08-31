import "server-only";
import { createSupabaseAdmin } from "../supabase/admin";
import { requireUser } from "../supabase/auth";

/**
 * O **CRUD de usuário** do ScopeFinance — `RF-FIN-10`, decisão do dono de
 * 31/08/2026: *"basicamente tudo que envolve o crud numa aplicação real"*.
 *
 * ⚖️ **Perfil e credencial são duas coisas, em dois lugares.** `usuarios` é a
 * pessoa, no schema público; `auth.users` é a credencial, gerida pelo Supabase.
 * As duas compartilham o `id`, e é fácil esquecer que são duas — motivo pelo
 * qual toda troca de e-mail aqui passa por `trocarEmail`, que mexe nos dois. Um
 * `update` solto em `usuarios.email` faria a lista mostrar o endereço novo
 * enquanto a pessoa continuasse entrando com o antigo, sem erro em lugar
 * nenhum.
 *
 * ⚖️ **Usuários independentes dos da Dashboard**, por decisão do dono: são dois
 * projetos Supabase, logo dois `auth.users`. Não há espelho e não deve haver.
 */

export type PapelFinance = "admin" | "financeiro" | "leitura";

export const PAPEIS: { valor: PapelFinance; rotulo: string; descricao: string }[] = [
  { valor: "admin", rotulo: "Administrador", descricao: "Administra usuários, além de operar." },
  { valor: "financeiro", rotulo: "Financeiro", descricao: "Opera cobrança, baixa e notas." },
  { valor: "leitura", rotulo: "Leitura", descricao: "Consulta e não escreve." },
];

export interface UsuarioFinance {
  id: string;
  nome: string;
  email: string;
  papel: PapelFinance;
  ativo: boolean;
  master: boolean;
  telefone: string | null;
  documento: string | null;
  data_nascimento: string | null;
  foto_url: string | null;
  sobre: string | null;
  created_at: string;
  updated_at: string;
}

const COLUNAS =
  "id, nome, email, papel, ativo, master, telefone, documento, data_nascimento, foto_url, sobre, created_at, updated_at";

export class ErroDeUsuario extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroDeUsuario";
  }
}

// ─── Regras puras (testáveis sem banco) ──────────────────────────────

export const SENHA_MINIMA = 8;

/**
 * Regra de senha — **comprimento, e só**.
 *
 * ⚖️ Regras de composição (maiúscula, número, símbolo) empurram para
 * `Senha@123` e para o post-it no monitor. Comprimento é a única exigência que
 * a pesquisa sustenta.
 */
export function recusaDeSenha(senha: string): string | null {
  if (senha.length < SENHA_MINIMA) {
    return `A senha precisa de pelo menos ${SENHA_MINIMA} caracteres.`;
  }
  // Espaço nas pontas quase sempre é cópia acidental — e uma senha que a
  // pessoa não consegue redigitar é uma conta perdida.
  if (senha !== senha.trim()) return "A senha não pode começar nem terminar com espaço.";
  return null;
}

/**
 * ⛔ Validação frouxa **de propósito**: regex de e-mail "completa" recusa
 * endereços válidos (`+`, subdomínio, TLD longo) e ninguém descobre por quê. A
 * prova de que um e-mail existe é o e-mail de confirmação, não a expressão.
 */
export function emailPlausivel(email: string): boolean {
  const e = email.trim();
  return e.length >= 5 && e.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

/** Só os dígitos — é assim que o índice único compara dois CPFs. */
export function soDigitos(v: string | null | undefined): string | null {
  const d = String(v ?? "").replace(/\D/g, "");
  return d === "" ? null : d;
}

/**
 * Por que uma alteração é recusada — ou `null` quando pode seguir.
 *
 * ⚖️ **As três travas da conta master.** Ela não se rebaixa, não se desativa e
 * ninguém a rebaixa. Sem a primeira, a única administradora se removeria por
 * engano e o sistema ficaria sem quem administra — sem caminho de volta pela
 * própria aplicação.
 *
 * ⛔ **`papel = 'admin'` NÃO dá poder sobre credencial alheia.** Administrar
 * acesso é uma coisa; trocar a senha de alguém é **tomar a conta dessa
 * pessoa**, e nenhuma auditoria desfaz isso. Só a master.
 */
export function recusaAoMexerEmUsuario(
  quemMexe: { id: string; master: boolean; papel: PapelFinance },
  alvo: { id: string; master: boolean },
  mudanca: { ativo?: boolean; papel?: PapelFinance; credencial?: boolean }
): string | null {
  const euMesmo = quemMexe.id === alvo.id;

  if (mudanca.credencial && !euMesmo && !quemMexe.master) {
    return "Só a conta administradora troca e-mail ou senha de outra pessoa — trocar a credencial de alguém é dar acesso à conta dessa pessoa.";
  }

  if (!mudanca.credencial && !euMesmo && quemMexe.papel !== "admin") {
    return "Você não administra usuários.";
  }

  if (alvo.master) {
    if (!quemMexe.master) return "A conta administradora só é alterada por ela mesma.";
    if (mudanca.ativo === false) {
      return "A conta administradora não se desativa — o sistema ficaria sem quem administra, e não há caminho de volta pela aplicação.";
    }
    if (mudanca.papel && mudanca.papel !== "admin") {
      return "A conta administradora não se rebaixa.";
    }
  }

  return null;
}

// ─── Leitura ─────────────────────────────────────────────────────────

/**
 * O perfil de quem está logado — ou `null` se a credencial não tem cadastro.
 *
 * ⚠️ **`null` é estado real, não defensividade.** Alguém convidado direto pelo
 * painel do Supabase tem credencial e não tem linha aqui. A tela precisa dizer
 * isso em vez de quebrar.
 */
export async function usuarioAtual(): Promise<UsuarioFinance | null> {
  const auth = await requireUser();
  const supabase = createSupabaseAdmin();
  const { data } = await supabase.from("usuarios").select(COLUNAS).eq("id", auth.id).maybeSingle();
  return (data as UsuarioFinance | null) ?? null;
}

export async function listarUsuarios(): Promise<UsuarioFinance[]> {
  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase
    .from("usuarios")
    .select(COLUNAS)
    .order("ativo", { ascending: false })
    .order("nome")
    // Teto declarado: `usuarios` cresce com o time, não com o uso.
    .limit(500);
  if (error) throw new ErroDeUsuario(error.message);
  return (data ?? []) as UsuarioFinance[];
}

export async function lerUsuario(id: string): Promise<UsuarioFinance | null> {
  const supabase = createSupabaseAdmin();
  const { data } = await supabase.from("usuarios").select(COLUNAS).eq("id", id).maybeSingle();
  return (data as UsuarioFinance | null) ?? null;
}

// ─── Escrita ─────────────────────────────────────────────────────────

export interface DadosDeUsuario {
  nome?: string;
  telefone?: string | null;
  documento?: string | null;
  data_nascimento?: string | null;
  sobre?: string | null;
  foto_url?: string | null;
  papel?: PapelFinance;
  ativo?: boolean;
}

const texto = (v: string | null | undefined): string | null => {
  const t = String(v ?? "").trim();
  return t === "" ? null : t;
};

export async function salvarUsuario(id: string, dados: DadosDeUsuario): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (dados.nome !== undefined) {
    const nome = texto(dados.nome);
    if (!nome) throw new ErroDeUsuario("O nome não pode ficar vazio.");
    patch.nome = nome;
  }
  if (dados.telefone !== undefined) patch.telefone = texto(dados.telefone);
  if (dados.documento !== undefined) patch.documento = soDigitos(dados.documento);
  if (dados.data_nascimento !== undefined) patch.data_nascimento = texto(dados.data_nascimento);
  if (dados.sobre !== undefined) patch.sobre = texto(dados.sobre);
  if (dados.foto_url !== undefined) patch.foto_url = texto(dados.foto_url);
  if (dados.papel !== undefined) patch.papel = dados.papel;
  if (dados.ativo !== undefined) patch.ativo = dados.ativo;

  if (Object.keys(patch).length === 0) return;

  const supabase = createSupabaseAdmin();
  const { error } = await supabase.from("usuarios").update(patch).eq("id", id);
  if (error) {
    // "duplicate key value violates unique constraint uq_usuarios_documento"
    // não diz nada a quem está preenchendo o próprio cadastro.
    if (error.code === "23505") {
      throw new ErroDeUsuario(
        "Este CPF já está em outro cadastro. Duas contas com o mesmo documento são a mesma pessoa duas vezes."
      );
    }
    throw new ErroDeUsuario(error.message);
  }
}

/**
 * Convida alguém: cria a **credencial** e o **perfil**, nessa ordem.
 *
 * ⛔ **A ordem é obrigatória.** `usuarios.id` é o `id` de `auth.users`; criar o
 * perfil antes obrigaria a inventar um `id` que nenhuma credencial alcança —
 * uma linha visível na lista e incapaz de entrar, sem nada explicando por quê.
 *
 * ⚖️ **A senha provisória é devolvida, e só nesta resposta.** O ScopeFinance não
 * tem envio de e-mail configurado; sem devolvê-la, quem convida não teria como
 * dizer à pessoa como entrar. Ela não é gravada em lugar nenhum.
 */
export async function convidarUsuario(dados: {
  nome: string;
  email: string;
  papel: PapelFinance;
  senha: string;
}): Promise<{ id: string }> {
  const email = dados.email.trim().toLowerCase();
  if (!emailPlausivel(email)) throw new ErroDeUsuario("E-mail inválido.");
  const nome = texto(dados.nome);
  if (!nome) throw new ErroDeUsuario("Informe o nome.");
  const recusa = recusaDeSenha(dados.senha);
  if (recusa) throw new ErroDeUsuario(recusa);

  const supabase = createSupabaseAdmin();

  const { data: criado, error } = await supabase.auth.admin.createUser({
    email,
    password: dados.senha,
    // Sem envio de e-mail configurado aqui, exigir confirmação deixaria a
    // pessoa criada e incapaz de entrar — um convite que não convida.
    email_confirm: true,
    user_metadata: { nome },
  });
  if (error || !criado?.user) {
    if (error && /already been registered|already exists/i.test(error.message)) {
      throw new ErroDeUsuario("Este e-mail já pertence a uma conta.");
    }
    throw new ErroDeUsuario(error?.message ?? "Não foi possível criar a credencial.");
  }

  const { error: e2 } = await supabase
    .from("usuarios")
    .insert({ id: criado.user.id, nome, email, papel: dados.papel });

  if (e2) {
    // ⛔ Desfaz a credencial órfã. Sem isto, o e-mail ficaria "já registrado"
    // no auth e a próxima tentativa de convidar a mesma pessoa seria recusada
    // por um cadastro que a lista não mostra — o pior estado possível.
    await supabase.auth.admin.deleteUser(criado.user.id).catch(() => {});
    throw new ErroDeUsuario(e2.message);
  }

  return { id: criado.user.id };
}

export async function definirSenha(id: string, senha: string): Promise<void> {
  const recusa = recusaDeSenha(senha);
  if (recusa) throw new ErroDeUsuario(recusa);
  const supabase = createSupabaseAdmin();
  const { error } = await supabase.auth.admin.updateUserById(id, { password: senha });
  if (error) throw new ErroDeUsuario(`Não foi possível trocar a senha: ${error.message}`);
}

/**
 * Troca o e-mail **nos dois lados** — credencial e perfil.
 *
 * `confirmado: false` (o próprio usuário) manda um link para o endereço novo e
 * só efetiva no clique; até lá a pessoa continua entrando com o antigo, e é
 * isso que impede um erro de digitação de trancar alguém para fora.
 * `confirmado: true` (a conta administradora) efetiva na hora, porque quem
 * perdeu o endereço antigo não tem como clicar em nada.
 */
export async function trocarEmail(
  id: string,
  emailNovo: string,
  opcoes: { confirmado: boolean }
): Promise<{ pendenteDeConfirmacao: boolean }> {
  const email = emailNovo.trim().toLowerCase();
  if (!emailPlausivel(email)) throw new ErroDeUsuario("E-mail inválido.");

  const supabase = createSupabaseAdmin();
  const { error } = await supabase.auth.admin.updateUserById(id, {
    email,
    ...(opcoes.confirmado ? { email_confirm: true } : {}),
  });
  if (error) {
    if (/already been registered|already exists/i.test(error.message)) {
      throw new ErroDeUsuario("Este e-mail já pertence a outra conta.");
    }
    throw new ErroDeUsuario(`Não foi possível trocar o e-mail: ${error.message}`);
  }

  // ⛔ O perfil só recebe o e-mail novo no caminho confirmado. No outro a troca
  // ainda não aconteceu, e gravá-lo faria a tela exibir um endereço com o qual
  // ninguém consegue entrar.
  if (opcoes.confirmado) {
    const { error: e2 } = await supabase.from("usuarios").update({ email }).eq("id", id);
    if (e2) throw new ErroDeUsuario(e2.message);
    return { pendenteDeConfirmacao: false };
  }
  return { pendenteDeConfirmacao: true };
}

/**
 * Confere a senha atual sem derrubar a sessão de quem pergunta.
 *
 * ⚖️ Instância descartável de propósito: `signInWithPassword` no cliente da
 * requisição trocaria os cookies pela sessão recém-criada — efeito colateral
 * silencioso num caminho que só deveria responder sim ou não.
 */
export async function senhaAtualConfere(email: string, senha: string): Promise<boolean> {
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new ErroDeUsuario("Supabase não configurado.");
  const cliente = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await cliente.auth.signInWithPassword({ email, password: senha });
  return !error;
}

/**
 * Desativa alguém. **Não apaga.**
 *
 * ⛔ Excluir a linha deixaria toda cobrança, baixa e nota emitida por essa
 * pessoa apontando para um usuário que não existe — e a trilha de quem fez o
 * quê é o que torna o financeiro auditável. Desativar tira o acesso e preserva
 * a história.
 */
export async function desativarUsuario(id: string): Promise<void> {
  const supabase = createSupabaseAdmin();
  const { error } = await supabase.from("usuarios").update({ ativo: false }).eq("id", id);
  if (error) throw new ErroDeUsuario(error.message);

  // ⛔ E a credencial vai junto: perfil inativo com credencial viva continuaria
  // entrando, e `ativo` viraria um rótulo que não protege de nada.
  await supabase.auth.admin.updateUserById(id, { ban_duration: "876000h" });
}

export async function reativarUsuario(id: string): Promise<void> {
  const supabase = createSupabaseAdmin();
  const { error } = await supabase.from("usuarios").update({ ativo: true }).eq("id", id);
  if (error) throw new ErroDeUsuario(error.message);
  await supabase.auth.admin.updateUserById(id, { ban_duration: "none" });
}
