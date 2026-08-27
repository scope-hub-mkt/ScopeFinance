import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { Badge, Empty, PageHeader } from "@/components/ui";
import { fmt, fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const URL_CATALOGO = "https://dashboard-oficial-scope.vercel.app/servicos";

/**
 * **Serviços** — o espelho somente-leitura do catálogo (§5 do plano).
 *
 * ✅ **Decidido: a Dashboard é a dona do catálogo; aqui fica uma cópia.**
 *
 * O board pedia um catálogo *dentro* do Scope Finance, conforme a referência
 * `03-catalogo-de-servicos.png`. 📐 Mas essa referência é uma tela que **já
 * existe, e é da Dashboard**: ela própria se declara *"a fonte única de preço
 * do motor de Insights"* e cita `RN-41` e `RN-20`, que são regras de lá.
 *
 * ⛔ **Por que não dois catálogos editáveis:** dois catálogos são dois preços
 * para o mesmo serviço. A divergência não aparece no dia em que nasce —
 * aparece meses depois, num relatório, quando já contaminou proposta comercial
 * e comissão apurada. O item de menu existe porque o board pede e porque é
 * necessário vincular serviço a cobrança; o que ele mostra é espelho.
 *
 * 📐 O `id` é o mesmo dos dois lados (`ESTADO §8.4`) — é isso que mantém
 * cobrança já gravada apontando para serviço válido.
 */
export default async function ServicosPage() {
  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase
    .from("servicos_espelho")
    .select("*")
    .order("ativo", { ascending: false })
    .order("nome");

  const linhas = (data ?? []) as Array<Record<string, unknown>>;

  return (
    <>
      <PageHeader title="Serviços">
        <a className="btn btn-p" href={URL_CATALOGO} target="_blank" rel="noreferrer">
          <i className="ti ti-external-link" />
          Editar na Dashboard
        </a>
      </PageHeader>

      <div className="card" style={{ marginBottom: "var(--e-4, 16px)" }}>
        <p className="tiny muted" style={{ margin: 0 }}>
          Esta lista é um <strong>espelho somente leitura</strong>. O catálogo é mantido na Scope
          Dashboard, que é a fonte única de preço — dois catálogos editáveis seriam dois preços
          para o mesmo serviço, e a divergência só apareceria depois de contaminar proposta e
          comissão. Alterações feitas lá chegam aqui em segundos.
        </p>
      </div>

      <div className="card tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>Serviço</th>
              <th>Área</th>
              <th>Cobrança</th>
              <th>Preço de tabela</th>
              <th>Status</th>
              <th>Sincronizado</th>
            </tr>
          </thead>
          <tbody>
            {error && (
              <tr>
                <td colSpan={6}>
                  {/* ⛔ `RNF-20` / `ESTADO §8.8`: sem dado a tela diz "não
                      disponível", nunca zero e nunca uma lista vazia com cara
                      de "não há serviço". Um zero afirma; um traço admite. */}
                  <Empty icone="ti-plug-off">
                    Não disponível — o espelho do catálogo não pôde ser lido agora.
                  </Empty>
                </td>
              </tr>
            )}
            {!error && !linhas.length && (
              <tr>
                <td colSpan={6}>
                  <Empty icone="ti-package">
                    Nenhum serviço espelhado ainda. Eles chegam quando o catálogo for salvo na
                    Dashboard.
                  </Empty>
                </td>
              </tr>
            )}
            {linhas.map((s) => (
              <tr key={String(s.id)}>
                <td>
                  {String(s.nome)}
                  {s.slug ? <div className="tiny muted">{String(s.slug)}</div> : null}
                </td>
                <td>{(s.area as string) ?? "—"}</td>
                <td>{(s.recorrencia as string) ?? (s.tipo_cobranca as string) ?? "—"}</td>
                <td>{s.preco_tabela == null ? "sob consulta" : fmt(Number(s.preco_tabela))}</td>
                <td>
                  <Badge s={s.ativo ? "ativo" : "inativo"} />
                </td>
                <td className="tiny muted">
                  {fmtDate(String(s.sincronizado_em ?? "").slice(0, 10))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
