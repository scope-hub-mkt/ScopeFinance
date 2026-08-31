import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { lerUsuario, usuarioAtual } from "@/lib/dominio/usuarios";
import { FormularioUsuario } from "../FormularioUsuario";

export const dynamic = "force-dynamic";

/**
 * O cadastro de **uma pessoa** — dados pessoais e credenciais (`RF-FIN-10`).
 *
 * ⛔ **`papel = 'admin'` não abre esta tela.** Administrar acesso é uma coisa;
 * ver o CPF de um colega e trocar a senha dele é outra — trocar credencial de
 * alguém é **tomar a conta dessa pessoa**, e nenhuma trilha de auditoria desfaz
 * isso. Só a conta administradora, e o próprio dono do cadastro.
 */
export default async function CadastroDeUsuarioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const eu = await usuarioAtual();
  if (!eu) notFound();

  if (!eu.master && eu.id !== id) {
    return (
      <>
        <PageHeader title="Cadastro de usuário" />
        <div className="card">
          <div className="recado recado-erro">
            Só a conta administradora edita o cadastro de outra pessoa. Trocar o e-mail ou a senha
            de alguém é dar acesso à conta dessa pessoa.
          </div>
        </div>
      </>
    );
  }

  const alvo = await lerUsuario(id);
  if (!alvo) notFound();

  return (
    <>
      <PageHeader title={alvo.nome}>
        <Link className="btn btn-sm" href="/usuarios">
          <i className="ti ti-arrow-left" aria-hidden="true" /> Voltar
        </Link>
      </PageHeader>

      {eu.id !== id && (
        <div className="recado recado-atencao">
          Você está editando o cadastro de outra pessoa. Toda alteração de credencial dá acesso à
          conta dela.
        </div>
      )}

      <FormularioUsuario usuario={alvo} ehOutroUsuario={eu.id !== id} />
    </>
  );
}
