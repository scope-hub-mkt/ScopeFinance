import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { Badge, Empty, PageHeader, Dinheiro } from "@/components/ui";
import { fmtDate } from "@/lib/format";
export const dynamic = "force-dynamic";

/**
 * **Sistema → Alertas do Asaas** — a fila da Fase 7.
 *
 * ⚖️ **Por que esta tela é parte da regra, não um extra.** Os eventos P1 e P2
 * do gateway vinham sendo gravados e marcados `ignored` — o dado guardado, a
 * regra inexistente. Metade deles não é telemetria: chargeback aberto,
 * negativação, cartão recusado na captura, conta do gateway reprovada, chave
 * de API expirando.
 *
 * ⛔ Sem esta lista, a única forma de descobrir um chargeback seria alguém
 * rodar um `select` na caixa de entrada. É a mesma classe de defeito que a
 * tela de cadastros em revisão corrige: **um estado que importa e que ninguém
 * vê**. Ausência de tela é ausência de aviso.
 *
 * **Ordem: crítico primeiro, depois o mais antigo.** Crítico aqui significa
 * *"alguém perde dinheiro ou a operação para"* — não *"é chato"*. Uma fila em
 * que tudo é crítico é uma fila sem prioridade, e o time aprende a ignorar o
 * vermelho.
 */
export default async function AlertasPage() {
  const supabase = createSupabaseAdmin();

  const [{ data, error }, { data: clientes }] = await Promise.all([
    supabase
      .from("asaas_alertas")
      .select("*")
      .is("resolvido_em", null)
      // ⚠️ **`descending`, e isto foi medido errando.** O comentário anterior
      // afirmava que `critico` vinha antes de `atencao` em ordem alfabética —
      // vem DEPOIS (`a` < `c`), e a fila subiu com o chargeback embaixo do
      // aviso de chave expirando. Ordenação errada não quebra nada: só põe o
      // urgente fora de vista, que é o oposto do motivo de a fila existir.
      .order("severidade", { ascending: false })
      .order("criado_em", { ascending: true })
      .limit(500),
    supabase.from("clientes").select("id, nome").limit(2000),
  ]);

  const nomePorId = new Map(
    ((clientes ?? []) as Array<{ id: string; nome: string }>).map((c) => [c.id, c.nome])
  );
  const linhas = (data ?? []) as Array<Record<string, unknown>>;
  const criticos = linhas.filter((a) => a.severidade === "critico").length;

  return (
    <>
      <PageHeader title="Alertas do Asaas" />

      <div className="card" style={{ marginBottom: "var(--e-4, 16px)" }}>
        <p className="tiny muted" style={{ margin: 0 }}>
          O que o gateway avisou e ainda espera alguém. <strong>Crítico</strong> é quando
          alguém perde dinheiro ou a operação para — chargeback, estorno negado, conta ou
          chave de API bloqueada. Nenhum destes eventos altera valor, status ou receita:
          isso é dos eventos de cobrança, e continua sendo.
        </p>
      </div>

      <div className="sbar">
        <span className="tiny">
          {linhas.length} aberto(s)
          {criticos > 0 ? ` · ${criticos} crítico(s)` : ""}
        </span>
      </div>

      <div className="card tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>Severidade</th>
              <th>Alerta</th>
              <th>Cliente</th>
              <th>Valor</th>
              <th>Categoria</th>
              <th>Quando</th>
            </tr>
          </thead>
          <tbody>
            {error && (
              <tr>
                <td colSpan={6}>
                  {/* ⛔ Sem dado, "não disponível" — nunca uma lista vazia que
                      se lê como "não há alerta nenhum". Aqui a confusão seria
                      cara: silêncio falso sobre um chargeback aberto. */}
                  <Empty icone="ti-plug-off">
                    Não disponível — a fila de alertas não pôde ser lida agora.
                  </Empty>
                </td>
              </tr>
            )}
            {!error && !linhas.length && (
              <tr>
                <td colSpan={6}>
                  <Empty icone="ti-circle-check">
                    Nenhum alerta em aberto. Chargeback, negativação e problema de conta
                    aparecem aqui automaticamente.
                  </Empty>
                </td>
              </tr>
            )}
            {linhas.map((a) => (
              <tr key={String(a.id)}>
                <td>
                  <Badge s={String(a.severidade)} />
                </td>
                <td>
                  {String(a.titulo)}
                  {a.detalhe ? <div className="tiny muted">{String(a.detalhe)}</div> : null}
                  <div className="tiny muted">{String(a.event_type)}</div>
                </td>
                <td className="sigilo">
                  {a.cliente_id ? (
                    (nomePorId.get(String(a.cliente_id)) ?? "—")
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>{a.valor == null ? "—" : <Dinheiro v={Number(a.valor)} />}</td>
                <td>{String(a.categoria)}</td>
                <td className="tiny muted">
                  {fmtDate(String(a.criado_em ?? "").slice(0, 10))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
