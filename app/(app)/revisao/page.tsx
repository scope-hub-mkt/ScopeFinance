import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { clientesEmRevisao } from "@/lib/crm/aplicar";
import { Badge, Empty, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * **Cadastros em revisão** — as duas filas do §2.3 e §2.4 do plano.
 *
 * ⚖️ **Por que esta tela é parte da regra, não um extra.** O estado
 * `provisorio` proíbe cinco coisas: criar customer no Asaas, emitir NFS-e,
 * entrar em faturamento/MRR, entrar em Metas e Comissão, e ser tratado como
 * cadastro completo. Um estado que bloqueia cobrança e nota fiscal **e que
 * ninguém vê** é pior que não ter estado nenhum — o comercial acha que vendeu,
 * o financeiro não cobra, e não há onde olhar para descobrir por quê. Sem esta
 * lista, "provisório" seria *"um cemitério silencioso de cadastros pela
 * metade"*, que é o modo de falha que este projeto já pagou para aprender duas
 * vezes.
 *
 * **Ordenada pelo mais antigo**, de propósito: a fila mostra quem espera há
 * mais tempo, não quem chegou por último. É o que transforma uma lista em
 * urgência visível.
 *
 * Server Component pelo mesmo motivo da tela de Integração: a leitura usa a
 * chave de serviço e nada disso precisa chegar ao browser.
 */
export default async function RevisaoPage() {
  const linhas = await clientesEmRevisao(createSupabaseAdmin());
  const provisorios = linhas.filter((c) => c.status_cadastro === "provisorio");
  const conflitos = linhas.filter((c) => c.status_cadastro === "em_conflito");

  return (
    <>
      <PageHeader title="Cadastros em revisão" />

      <div className="card" style={{ marginBottom: "var(--e-4, 16px)" }}>
        <p className="tiny muted" style={{ margin: 0 }}>
          Cliente <strong>provisório</strong> não gera cobrança no Asaas, não emite nota fiscal e
          não entra em faturamento, MRR ou comissão — até alguém completar o documento.
          Cliente <strong>em conflito</strong> tem um documento que já pertence a outro cadastro:
          nada é fundido automaticamente, porque fundir depois de emitida a nota é irreversível.
        </p>
      </div>

      <Fila
        titulo="Provisórios — falta o documento"
        vazio="Nenhum cadastro provisório. Todo cliente tem CPF ou CNPJ."
        icone="ti-id-badge-2"
        linhas={provisorios}
      />

      <div style={{ marginTop: "var(--e-6, 24px)" }}>
        <Fila
          titulo="Em conflito — o documento pertence a outro cadastro"
          vazio="Nenhum conflito de documento em aberto."
          icone="ti-alert-triangle"
          linhas={conflitos}
        />
      </div>
    </>
  );
}

function Fila({
  titulo,
  vazio,
  icone,
  linhas,
}: {
  titulo: string;
  vazio: string;
  icone: string;
  linhas: Awaited<ReturnType<typeof clientesEmRevisao>>;
}) {
  return (
    <section>
      <h2 className="pt" style={{ fontSize: "1rem" }}>
        {titulo} <span className="tiny muted">({linhas.length})</span>
      </h2>

      <div className="card tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Documento</th>
              <th>Contato</th>
              <th>Origem</th>
              <th>Esperando</th>
            </tr>
          </thead>
          <tbody>
            {!linhas.length && (
              <tr>
                <td colSpan={5}>
                  <Empty icone={icone}>{vazio}</Empty>
                </td>
              </tr>
            )}
            {linhas.map((c) => (
              <tr key={c.id}>
                <td>
                  {c.nome}
                  {c.crm_id && <div className="tiny muted">card {c.crm_id}</div>}
                </td>
                <td>
                  {/* ⛔ Traço, não "0" nem vazio: ausência de documento é o
                      motivo de a linha estar nesta fila, e precisa se ler como
                      ausência, não como campo esquecido. */}
                  {c.documento_principal ?? <span className="muted">— sem documento</span>}
                </td>
                <td className="tiny">
                  {c.email ?? "—"}
                  <br />
                  {c.tel ?? "—"}
                </td>
                <td>
                  <Badge s={c.origem} />
                </td>
                <td>
                  {c.dias_esperando === 0
                    ? "hoje"
                    : `${c.dias_esperando} dia${c.dias_esperando > 1 ? "s" : ""}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
