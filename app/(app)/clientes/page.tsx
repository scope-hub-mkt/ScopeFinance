import { clientesViaEtl } from "@/lib/etl/alimentadores";
import { PageHeader } from "@/components/ui";
import { ClientesTabela } from "./ClientesTabela";

export const dynamic = "force-dynamic";

/**
 * **Clientes** — servidor, desde 30/08/2026 (`D-91`).
 *
 * ⚠️ **O que esta tela era até hoje, e por que mudou.** Ela era um componente
 * de cliente que lia `useStore()`. O `StoreProvider` mora em `AppFrame`, e o
 * `useEffect` dele buscava **as 10 tabelas inteiras** (`/api/clientes`,
 * `/api/contratos`, `/api/assinaturas`, `/api/lancamentos`, …) — completas,
 * com todas as colunas, **em toda navegação do sistema**, inclusive nas telas
 * que usam uma só delas.
 *
 * O dono nomeou o defeito em 30/08/2026: *"o sistema possui uma inteligência
 * de dados que isola o back-end, ele faz os cálculos e requisições necessárias
 * e devolve um json que alimenta o front, deixando ele extremamente leve"* —
 * e aqui era o oposto exato.
 *
 * Agora: **12 colunas escolhidas, do servidor, com prazo de validade
 * declarado**. O CRUD continua existindo, numa ilha de cliente que fala com a
 * mesma API de antes e pede um `router.refresh()` — não uma segunda carga da
 * tabela.
 */
export default async function ClientesPage() {
  const retrato = await clientesViaEtl();

  return (
    <>
      <PageHeader title="Clientes" />
      <ClientesTabela
        clientes={retrato.dados.clientes}
        truncado={retrato.dados.truncado}
        idadeS={retrato.idade_s}
      />
    </>
  );
}
