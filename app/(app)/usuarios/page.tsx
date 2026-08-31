import { PageHeader } from "@/components/ui";
import { listarUsuarios, usuarioAtual } from "@/lib/dominio/usuarios";
import { TabelaUsuarios } from "./TabelaUsuarios";

export const dynamic = "force-dynamic";

/**
 * Quem entra no ScopeFinance — `RF-FIN-10`, decisão do dono de 31/08/2026.
 *
 * ⚖️ **Antes desta tela, cadastrar alguém era abrir o painel do Supabase.** E
 * não havia papel nenhum: quem tivesse credencial via e escrevia tudo.
 *
 * ⛔ **A lista mostra ACESSO, não a pessoa inteira.** CPF, nascimento e telefone
 * ficam em `/usuarios/[id]`, que só a conta administradora e o próprio dono do
 * cadastro alcançam — ver o documento dos colegas não é parte de administrar
 * acesso.
 */
export default async function UsuariosPage() {
  const eu = await usuarioAtual();

  if (!eu) {
    return (
      <>
        <PageHeader title="Usuários" />
        <div className="card">
          <div className="recado recado-erro">
            A sua credencial existe, mas não há cadastro correspondente. Peça à conta
            administradora para cadastrar o seu acesso.
          </div>
        </div>
      </>
    );
  }

  const usuarios = await listarUsuarios();

  return (
    <>
      <PageHeader title="Usuários" />
      <TabelaUsuarios
        usuarios={usuarios}
        eu={{ id: eu.id, papel: eu.papel, master: eu.master }}
      />
    </>
  );
}
