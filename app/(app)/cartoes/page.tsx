import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { lerResumoDeCartoes, nomesPorCustomerAsaas } from "@/lib/asaas/cartoes";
import { Dinheiro, Empty, MetricGrid, PageHeader, Sigilo, type ItemMetrica } from "@/components/ui";
import { fmt, fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * **Cartões** — ligada de verdade ao Asaas em 02/09/2026.
 *
 * ⚖️ **Esta tela mudou de assunto, e a troca é a decisão principal.** Ela
 * cadastrava o cartão *da empresa*: nome, limite, quanto do limite estava
 * usado, dia de fechamento. Nenhum desses campos existe na API do Asaas — o
 * Asaas **recebe** no cartão, não emite o cartão da Scope. O resultado prático,
 * medido em 02/09/2026: a tabela `cartoes` tinha **zero linhas** e a tela dizia
 * "Nenhum cartão cadastrado" desde sempre, enquanto **71 cobranças reais no
 * cartão**, somando dezenas de milhares de reais, passavam pelo gateway sem
 * aparecer em lugar nenhum do sistema.
 *
 * ✅ **O cartão que este sistema conhece de verdade é o que paga.** Bandeira e
 * quatro últimos dígitos vêm do gateway em cada cobrança; o nome do cliente vem
 * do vínculo `clientes.asaas_customer_id` que já existe aqui.
 *
 * ⛔ **Sem barra de limite.** A barra de "% do limite" da tela antiga não tem
 * origem: limite de cartão de cliente é dado do emissor, e desenhá-lo a partir
 * de nada é a mesma ficção do saldo de R$ 429,47 que a `/bancos` mostrava — só
 * que mais bonita.
 */
export default async function CartoesPage() {
  const nomes = await nomesPorCustomerAsaas(createSupabaseAdmin());
  const leitura = await lerResumoDeCartoes(nomes);

  if (!leitura.ok) {
    return (
      <>
        <PageHeader title="Cartões" />
        <div className="aviso-parcial" role="status">
          <i className="ti ti-alert-triangle" aria-hidden="true" />
          <span>
            Não foi possível ler as cobranças no cartão do Asaas: {leitura.erro}. Esta tela não tem
            cópia local para exibir no lugar — e mostrar zero seria afirmar que não houve
            recebimento no cartão, que é coisa diferente de não ter conseguido perguntar.
          </span>
        </div>
      </>
    );
  }

  const { cartoes, parcelamentos, total, truncado, lido_em } = leitura.valor;

  const metricas: ItemMetrica[] = [
    {
      l: "Recebido no cartão",
      v: fmt(total.liquidado),
      c: "c-green",
      icone: "credit-card",
      fonte: "cobranças CREDIT_CARD do Asaas com status RECEIVED, RECEIVED_IN_CASH ou CONFIRMED",
    },
    {
      l: "Ainda não caiu",
      v: fmt(total.aberto),
      c: "c-blue",
      icone: "clock",
      fonte: "cobranças CREDIT_CARD do Asaas pendentes ou em análise de risco",
    },
    {
      l: "Em problema",
      v: fmt(total.problema),
      c: total.problema > 0 ? "c-red" : "",
      icone: "alert-triangle",
      fonte: "cobranças CREDIT_CARD vencidas, em cobrança, estornadas ou em chargeback",
    },
    {
      l: "Cartões distintos",
      v: total.cartoes_distintos,
      icone: "cards",
      fonte: "bandeira + 4 ultimos digitos das cobrancas CREDIT_CARD devolvidas pelo Asaas",
    },
  ];

  return (
    <>
      <PageHeader title="Cartões" />

      <div className="card" style={{ marginBottom: "var(--e-4)" }}>
        <p className="tiny muted" style={{ margin: 0 }}>
          Esta tela mostra os <strong>cartões que pagaram esta conta</strong>, lidos da API do Asaas
          a cada abertura — não há cadastro nem cópia no banco. O Asaas é o recebedor: ele conhece a
          bandeira e os quatro últimos dígitos de quem pagou, e não conhece limite, fatura nem dia
          de fechamento. Leitura feita em {fmtDataHora(lido_em)}.
        </p>
      </div>

      {truncado && (
        <div className="aviso-parcial" role="status">
          <i className="ti ti-alert-triangle" aria-hidden="true" />
          <span>
            A leitura foi <strong>cortada no teto de páginas</strong> e os totais abaixo são
            parciais. O teto existe para a função não morrer no meio e devolver soma incompleta com
            cara de completa.
          </span>
        </div>
      )}

      <MetricGrid items={metricas} />

      <section style={{ marginTop: "var(--e-6)" }}>
        <h2 className="pt" style={{ fontSize: "1rem" }}>
          Cartões que pagaram <span className="tiny muted">({cartoes.length})</span>
        </h2>

        <div className="card tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Cartão</th>
                <th>Quem pagou</th>
                <th style={{ textAlign: "right" }}>Cobranças</th>
                <th style={{ textAlign: "right" }}>Recebido</th>
                <th style={{ textAlign: "right" }}>A cair</th>
                <th style={{ textAlign: "right" }}>Em problema</th>
                <th>Último uso</th>
              </tr>
            </thead>
            <tbody>
              {!cartoes.length && (
                <tr>
                  <td colSpan={7}>
                    <Empty icone="ti-credit-card-off">
                      Nenhuma cobrança no cartão nesta conta do Asaas.
                    </Empty>
                  </td>
                </tr>
              )}
              {cartoes.map((c) => (
                <tr key={c.chave}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{c.bandeira}</div>
                    {/* ⚠️ Quatro dígitos são identidade (`RF-90`) — borram no
                        Modo Privacidade junto com nome e documento. */}
                    <Sigilo as="div" className="tiny">
                      {c.final ? `•••• ${c.final}` : "sem os últimos dígitos"}
                    </Sigilo>
                  </td>
                  <td className="tiny">
                    {/* ⛔ Cliente sem vínculo `asaas_customer_id` aparece como
                        lacuna, não como nome chutado: a lacuna é real e o
                        conserto dela é a reconciliação do backfill. */}
                    {c.clientes.length ? (
                      <Sigilo>{c.clientes.join(", ")}</Sigilo>
                    ) : (
                      <span className="muted">cliente não vinculado a este cadastro</span>
                    )}
                  </td>
                  <td style={{ textAlign: "right" }}>{c.cobrancas}</td>
                  <td className="c-green" style={{ textAlign: "right", fontWeight: 500 }}>
                    <Dinheiro v={c.liquidado} />
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <Dinheiro v={c.aberto} />
                  </td>
                  <td className={c.problema > 0 ? "c-red" : ""} style={{ textAlign: "right" }}>
                    <Dinheiro v={c.problema} />
                  </td>
                  <td className="tiny">{c.ultimo_uso ? fmtDate(c.ultimo_uso) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section style={{ marginTop: "var(--e-6)" }}>
        <h2 className="pt" style={{ fontSize: "1rem" }}>
          Parcelamentos no cartão <span className="tiny muted">({parcelamentos.length})</span>
        </h2>

        <div className="card tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Cartão</th>
                <th>Cliente</th>
                <th>Parcelas</th>
                <th style={{ textAlign: "right" }}>Valor da parcela</th>
                <th style={{ textAlign: "right" }}>Total</th>
                <th>Início</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {!parcelamentos.length && (
                <tr>
                  <td colSpan={7}>
                    <Empty icone="ti-list">Nenhuma venda parcelada no cartão.</Empty>
                  </td>
                </tr>
              )}
              {parcelamentos.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{p.bandeira}</div>
                    <Sigilo as="div" className="tiny">
                      {p.final ? `•••• ${p.final}` : "—"}
                    </Sigilo>
                  </td>
                  <td className="tiny">
                    {p.cliente ? (
                      <Sigilo>{p.cliente}</Sigilo>
                    ) : (
                      <span className="muted">não vinculado</span>
                    )}
                  </td>
                  <td>{p.parcelas}×</td>
                  <td style={{ textAlign: "right" }}>
                    <Dinheiro v={p.valor_parcela} />
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 500 }}>
                    <Dinheiro v={p.valor_total} />
                  </td>
                  <td className="tiny">{p.data ? fmtDate(p.data) : "—"}</td>
                  <td>
                    {p.comprovante && (
                      <a
                        className="btn btn-sm"
                        href={p.comprovante}
                        target="_blank"
                        rel="noreferrer"
                        title="Abrir o comprovante no Asaas"
                      >
                        <i className="ti ti-external-link" />
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

/** Data **e hora** da leitura — mesma razão de `/servicos` (`D-90`). */
function fmtDataHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${fmtDate(iso.slice(0, 10))} ${d.toISOString().slice(11, 16)} UTC`;
}
