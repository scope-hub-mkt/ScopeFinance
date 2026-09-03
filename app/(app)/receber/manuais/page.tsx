import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { usuarioAtual } from "@/lib/dominio/usuarios";
import { RecebiveisManuais } from "./RecebiveisManuais";

export const dynamic = "force-dynamic";

/**
 * Recebíveis manuais — a área exclusiva de `RF-93` / `RN-52` / `D-100`.
 *
 * ⚖️ **Por que existe uma tela separada, e não uma aba na de sempre.** O dono
 * perguntou: *"tem como criar uma parte exclusiva so para essas cobranças
 * manuais ?"*. Uma aba compartilharia o total, o filtro e a memória de quem
 * olha — e a mistura é justamente o defeito: cobrança digitada entrava no
 * faturamento e atravessava a ponte para a Dashboard como se o gateway a
 * tivesse recebido.
 *
 * ⛔ **Só a conta master entra** (`RN-53`). Este é o último lugar do
 * ScopeFinance onde ainda se digita dinheiro, e a instrução do dono foi que
 * quem define valor pago é ele. Papel `admin` não basta: no Finance, `admin`
 * já não manda em credencial alheia (`D-96`), e agora também não manda em
 * receita.
 */
export default async function RecebiveisManuaisPage() {
  const eu = await usuarioAtual();

  if (!eu) {
    return (
      <>
        <PageHeader title="Recebíveis manuais" />
        <div className="card">
          <div className="recado recado-erro">
            A sua credencial existe, mas não há cadastro correspondente. Peça à conta
            administradora para cadastrar o seu acesso.
          </div>
        </div>
      </>
    );
  }

  if (!eu.master) {
    // ⚠️ Recusa declarada, não tela em branco. Quem chega aqui sem poder
    // precisa saber que o lugar existe e por que está fechado — senão a
    // próxima pergunta é "a tela quebrou?".
    return (
      <>
        <PageHeader title="Recebíveis manuais" />
        <div className="card">
          <div className="recado recado-erro">
            Só a conta administradora lança e baixa recebível manual (<code>RN-53</code>).
            Cobrança do gateway continua visível em{" "}
            <Link href="/receber">Contas a receber</Link>.
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Recebíveis manuais" />
      <RecebiveisManuais />
    </>
  );
}
