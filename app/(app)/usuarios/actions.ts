"use server";

import { revalidatePath } from "next/cache";
import { apagarSnapshots } from "@/lib/etl/snapshot";
import { apagarFoto, subirFoto } from "@/lib/dominio/avatar";
import {
  convidarUsuario,
  definirSenha,
  desativarUsuario,
  ErroDeUsuario,
  lerUsuario,
  reativarUsuario,
  recusaAoMexerEmUsuario,
  recusaDeSenha,
  salvarUsuario,
  senhaAtualConfere,
  trocarEmail,
  usuarioAtual,
  type PapelFinance,
} from "@/lib/dominio/usuarios";

export interface Resultado {
  ok: boolean;
  erro?: string;
  /** Mensagem de sucesso quando o resultado precisa explicar o que vem a seguir. */
  aviso?: string;
}

function tratar(e: unknown): Resultado {
  if (e instanceof ErroDeUsuario) return { ok: false, erro: e.message };
  return { ok: false, erro: e instanceof Error ? e.message : "Erro inesperado." };
}

/**
 * Invalida as duas telas que mostram usuário.
 *
 * ⛔ `revalidatePath` sozinho não basta: o retrato do ETL responderia o valor
 * antigo até o TTL vencer — o sintoma "salvei e não mudou", que some sozinho e
 * ninguém reproduz.
 */
async function invalidar() {
  await apagarSnapshots("usuarios:");
  revalidatePath("/usuarios");
  revalidatePath("/perfil");
}

/**
 * Quem está agindo, já com o perfil carregado.
 *
 * ⛔ Sessão sem cadastro é recusa **explicada**, não erro genérico: quem foi
 * criado direto no painel do Supabase tem credencial e não tem linha em
 * `usuarios`, e precisa ler o motivo em vez de uma tela quebrada.
 */
async function quemAge() {
  const eu = await usuarioAtual();
  if (!eu) {
    throw new ErroDeUsuario(
      "A sua credencial existe, mas não há cadastro correspondente. Peça à conta administradora para cadastrar o seu acesso."
    );
  }
  if (!eu.ativo) throw new ErroDeUsuario("O seu acesso está desativado.");
  return eu;
}

// ─── Perfil / dados pessoais ─────────────────────────────────────────

export async function acaoSalvarUsuario(dados: {
  id?: string;
  nome: string;
  telefone?: string | null;
  documento?: string | null;
  data_nascimento?: string | null;
  sobre?: string | null;
  papel?: PapelFinance;
  ativo?: boolean;
}): Promise<Resultado> {
  try {
    const eu = await quemAge();
    const alvoId = dados.id ?? eu.id;
    const alvo = alvoId === eu.id ? eu : await lerUsuario(alvoId);
    if (!alvo) return { ok: false, erro: "Usuário inexistente." };

    const recusa = recusaAoMexerEmUsuario(eu, alvo, {
      ativo: dados.ativo,
      papel: dados.papel,
    });
    if (recusa) return { ok: false, erro: recusa };

    // ⛔ Ninguém muda o próprio papel nem a própria situação. Sem esta trava, o
    // caminho "editar meu perfil" seria também o caminho de virar admin — e a
    // permissão deixaria de significar qualquer coisa.
    const mexendoEmMim = alvoId === eu.id;
    const papel = mexendoEmMim ? undefined : dados.papel;
    const ativo = mexendoEmMim ? undefined : dados.ativo;

    await salvarUsuario(alvoId, {
      nome: dados.nome,
      telefone: dados.telefone,
      documento: dados.documento,
      data_nascimento: dados.data_nascimento,
      sobre: dados.sobre,
      papel,
      ativo,
    });

    await invalidar();
    return { ok: true, aviso: "Dados salvos." };
  } catch (e) {
    return tratar(e);
  }
}

// ─── Foto ────────────────────────────────────────────────────────────

export async function acaoTrocarFoto(form: FormData): Promise<Resultado> {
  try {
    const eu = await quemAge();
    const alvoId = String(form.get("usuario_id") ?? "") || eu.id;
    if (alvoId !== eu.id && !eu.master) {
      return { ok: false, erro: "Você só pode trocar a própria foto." };
    }

    const arquivo = form.get("foto");
    if (!(arquivo instanceof File)) return { ok: false, erro: "Nenhum arquivo recebido." };

    const antes = await lerUsuario(alvoId);
    const { url } = await subirFoto(alvoId, arquivo);
    // ⛔ A antiga só sai DEPOIS de a nova estar gravada: a ordem inversa
    // deixaria, numa falha no meio, o perfil apontando para arquivo que não
    // existe mais — avatar quebrado, sem caminho de volta.
    await salvarUsuario(alvoId, { foto_url: url });
    await apagarFoto(antes?.foto_url);

    await invalidar();
    return { ok: true, aviso: "Foto atualizada." };
  } catch (e) {
    return tratar(e);
  }
}

export async function acaoRemoverFoto(usuarioId?: string): Promise<Resultado> {
  try {
    const eu = await quemAge();
    const alvoId = usuarioId ?? eu.id;
    if (alvoId !== eu.id && !eu.master) {
      return { ok: false, erro: "Você só pode remover a própria foto." };
    }
    const antes = await lerUsuario(alvoId);
    await salvarUsuario(alvoId, { foto_url: null });
    await apagarFoto(antes?.foto_url);
    await invalidar();
    return { ok: true, aviso: "Foto removida." };
  } catch (e) {
    return tratar(e);
  }
}

// ─── Credenciais ─────────────────────────────────────────────────────

export async function acaoTrocarSenha(dados: {
  id?: string;
  senha_atual?: string;
  senha_nova: string;
}): Promise<Resultado> {
  try {
    const eu = await quemAge();
    const alvoId = dados.id ?? eu.id;
    const alvo = alvoId === eu.id ? eu : await lerUsuario(alvoId);
    if (!alvo) return { ok: false, erro: "Usuário inexistente." };

    const recusa = recusaAoMexerEmUsuario(eu, alvo, { credencial: true });
    if (recusa) return { ok: false, erro: recusa };

    const recusaSenha = recusaDeSenha(dados.senha_nova);
    if (recusaSenha) return { ok: false, erro: recusaSenha };

    // ⛔ A senha atual é exigida no caminho do próprio usuário, e não é
    // formalidade: sem ela, quem passasse por um computador destravado trocaria
    // a senha da pessoa e tomaria a conta — a sessão aberta já bastaria.
    if (alvoId === eu.id) {
      if (!dados.senha_atual) return { ok: false, erro: "Informe a senha atual." };
      if (!(await senhaAtualConfere(eu.email, dados.senha_atual))) {
        return { ok: false, erro: "A senha atual não confere." };
      }
    }

    await definirSenha(alvoId, dados.senha_nova);
    return { ok: true, aviso: "Senha trocada." };
  } catch (e) {
    return tratar(e);
  }
}

export async function acaoTrocarEmail(dados: {
  id?: string;
  email_novo: string;
  senha_atual?: string;
}): Promise<Resultado> {
  try {
    const eu = await quemAge();
    const alvoId = dados.id ?? eu.id;
    const alvo = alvoId === eu.id ? eu : await lerUsuario(alvoId);
    if (!alvo) return { ok: false, erro: "Usuário inexistente." };

    const recusa = recusaAoMexerEmUsuario(eu, alvo, { credencial: true });
    if (recusa) return { ok: false, erro: recusa };

    const proprio = alvoId === eu.id;
    if (proprio) {
      // Mesma razão da senha: o e-mail é o caminho de recuperação da conta, e
      // trocá-lo é tomá-la.
      if (!dados.senha_atual) return { ok: false, erro: "Informe a senha atual." };
      if (!(await senhaAtualConfere(eu.email, dados.senha_atual))) {
        return { ok: false, erro: "A senha atual não confere." };
      }
    }

    const { pendenteDeConfirmacao } = await trocarEmail(alvoId, dados.email_novo, {
      confirmado: !proprio,
    });

    await invalidar();
    return {
      ok: true,
      aviso: pendenteDeConfirmacao
        ? `Enviamos um link para ${dados.email_novo}. A troca só vale depois que você clicar nele — até lá, continue entrando com o e-mail atual.`
        : "E-mail trocado.",
    };
  } catch (e) {
    return tratar(e);
  }
}

// ─── Ciclo de vida ───────────────────────────────────────────────────

export async function acaoConvidar(dados: {
  nome: string;
  email: string;
  papel: PapelFinance;
  senha: string;
}): Promise<Resultado> {
  try {
    const eu = await quemAge();
    if (eu.papel !== "admin") return { ok: false, erro: "Você não administra usuários." };

    await convidarUsuario(dados);
    await invalidar();
    return {
      ok: true,
      aviso: `${dados.nome} já pode entrar com a senha provisória que você definiu. Peça para trocá-la no primeiro acesso, em Perfil.`,
    };
  } catch (e) {
    return tratar(e);
  }
}

export async function acaoDesativar(id: string): Promise<Resultado> {
  try {
    const eu = await quemAge();
    const alvo = await lerUsuario(id);
    if (!alvo) return { ok: false, erro: "Usuário inexistente." };

    const recusa = recusaAoMexerEmUsuario(eu, alvo, { ativo: false });
    if (recusa) return { ok: false, erro: recusa };
    if (id === eu.id) {
      return { ok: false, erro: "Você não desativa a própria conta — ficaria sem como voltar." };
    }

    await desativarUsuario(id);
    await invalidar();
    return { ok: true, aviso: `${alvo.nome} perdeu o acesso. O histórico dele continua.` };
  } catch (e) {
    return tratar(e);
  }
}

export async function acaoReativar(id: string): Promise<Resultado> {
  try {
    const eu = await quemAge();
    if (eu.papel !== "admin") return { ok: false, erro: "Você não administra usuários." };
    await reativarUsuario(id);
    await invalidar();
    return { ok: true, aviso: "Acesso reativado." };
  } catch (e) {
    return tratar(e);
  }
}
