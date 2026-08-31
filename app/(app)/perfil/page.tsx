import { PageHeader } from "@/components/ui";
import { usuarioAtual, PAPEIS } from "@/lib/dominio/usuarios";
import { FormularioUsuario } from "../usuarios/FormularioUsuario";

export const dynamic = "force-dynamic";

/**
 * O **próprio cadastro** — `RF-FIN-10`, decisão do dono de 31/08/2026.
 *
 * ⚖️ **Antes desta tela não havia caminho nenhum.** O ScopeFinance autenticava
 * pelo Supabase e parava aí: trocar a própria senha exigia o painel do
 * fornecedor, e trocar o e-mail não tinha caminho — nem pelo painel, sem mexer
 * em duas tabelas à mão.
 */
export default async function PerfilPage() {
  const eu = await usuarioAtual();

  if (!eu) {
    return (
      <>
        <PageHeader title="Perfil" />
        <div className="card">
          {/* ⚠️ Estado real, não defensividade: quem foi criado direto no painel
              do Supabase tem credencial e não tem linha em `usuarios`. Um
              formulário vazio aqui gravaria um cadastro por cima de nada. */}
          <div className="recado recado-erro">
            A sua credencial existe, mas não há cadastro correspondente. Peça à conta
            administradora para cadastrar o seu acesso.
          </div>
        </div>
      </>
    );
  }

  const papel = PAPEIS.find((p) => p.valor === eu.papel);

  return (
    <>
      <PageHeader title="Perfil">
        <span className="bdg bdg-x" title={papel?.descricao}>
          {papel?.rotulo ?? eu.papel}
        </span>
        {eu.master && <span className="bdg bdg-a">conta administradora</span>}
      </PageHeader>

      <FormularioUsuario usuario={eu} />
    </>
  );
}
