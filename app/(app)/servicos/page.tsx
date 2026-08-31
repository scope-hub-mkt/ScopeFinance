import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { Badge, Empty, PageHeader, Dinheiro } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { SincronizarCatalogo } from "./SincronizarCatalogo";

export const dynamic = "force-dynamic";

const URL_CATALOGO = "https://dashboard-oficial-scope.vercel.app/servicos";

/**
 * Data **e hora** — `D-90`. Só a data não distingue "sincronizado agora" de
 * "sincronizado às 00:52 e parado desde então", e era exatamente essa a
 * diferença que a tela não deixava ver enquanto o espelho envelhecia.
 */
function fmtDataHora(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fmtDate(String(iso).slice(0, 10));
  return `${fmtDate(iso.slice(0, 10))} ${d.toISOString().slice(11, 16)} UTC`;
}

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

  // A sincronização mais recente de TODAS as linhas: é ela que responde "este
  // espelho está em dia?". A data por linha continua na coluna, para quem
  // precisa saber qual linha ficou para trás.
  const ultimaSync = linhas.reduce<string | null>((maior, s) => {
    const v = typeof s.sincronizado_em === "string" ? s.sincronizado_em : null;
    return v && (!maior || v > maior) ? v : maior;
  }, null);
  // 24 h porque a reconciliação é diária: passar disso significa que nem o
  // evento nem o cron chegaram — e aí quem está olhando precisa saber.
  const atrasado =
    ultimaSync !== null && Date.now() - new Date(ultimaSync).getTime() > 24 * 60 * 60 * 1000;

  return (
    <>
      <PageHeader title="Serviços">
        <SincronizarCatalogo />
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
          comissão. Alterações feitas lá chegam aqui em segundos, e a reconciliação diária
          remove o que foi apagado.
          {/* ⚖️ `RNF-19` / `D-90` — design-token-exempt: comentario, nao texto
              de tela; a regra de emoji nao distingue os dois em JSX, e o
              proprio `scripts/lint-design.mjs` declara esse limite.
              O espelho declara DESDE QUANDO ele é
              espelho. Sem esta frase, um espelho parado há dois dias é
              visualmente idêntico a um em dia — foi assim que 7 linhas
              `[DEMO]` passaram por catálogo real entre 28 e 30/08/2026. */}
          {ultimaSync && (
            <>
              {" "}
              Última sincronização: <strong>{fmtDataHora(ultimaSync)}</strong>
              {atrasado && (
                <>
                  {" "}
                  — <span className="c-red">mais de 24 h atrás</span>; use{" "}
                  <em>Sincronizar agora</em>
                </>
              )}
              .
            </>
          )}
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
                <td>{s.preco_tabela == null ? "sob consulta" : <Dinheiro v={Number(s.preco_tabela)} />}</td>
                <td>
                  <Badge s={s.ativo ? "ativo" : "inativo"} />
                </td>
                <td className="tiny muted">
                  {fmtDataHora(typeof s.sincronizado_em === "string" ? s.sincronizado_em : null)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
