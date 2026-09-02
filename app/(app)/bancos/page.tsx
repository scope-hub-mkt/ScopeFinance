import { painelBancario, rotuloExtrato, type Leitura } from "@/lib/asaas/conta";
import { Dinheiro, Empty, MetricGrid, PageHeader, Sigilo, type ItemMetrica } from "@/components/ui";
import { fmt, fmtDate } from "@/lib/format";
import { ContasInternas } from "./ContasInternas";

export const dynamic = "force-dynamic";

/**
 * **Contas bancárias** — ligada de verdade ao Asaas em 02/09/2026.
 *
 * ⚖️ **O que esta tela deixou de fazer.** Ela listava linhas da tabela
 * `bancos` com o saldo digitado à mão. No dia em que foi trocada, a linha
 * "Asaas" dizia **R$ 429,47** e o `GET /finance/balance` da mesma conta dizia
 * **R$ 13,79** — 31× menos. Nada acusou: o número era redondo, estava no lugar
 * certo e tinha cara de dinheiro. É o modo de falha que este repositório já
 * catalogou várias vezes — *falha atrás de indicador verde*.
 *
 * ✅ **Agora o saldo vem do gateway a cada visita** (`force-dynamic`, sem
 * cache), junto do extrato real e de quem é o titular da conta. Nada é
 * gravado: uma cópia do saldo voltaria a divergir no primeiro lançamento, e
 * seria o mesmo defeito com uma etapa a mais para escondê-lo.
 *
 * ⚠️ **Cada bloco cai sozinho** (`Leitura<T>` de `lib/asaas/conta.ts`). Se a
 * chave Pix responder `403`, o saldo continua na tela e o bloco do Pix diz o
 * motivo. Nenhuma leitura falha vira `0` — "sem resposta" e "sem dinheiro" não
 * podem se parecer.
 */
export default async function BancosPage() {
  const p = await painelBancario(25);

  /**
   * ⚠️ **A `fonte` é literal mesmo quando a leitura falha, e isso é regra**
   * (`RNF-19`, e a catraca de `tests/lei-2-tile.test.ts`). Procedência responde
   * *de onde este número sairia*, e o endpoint continua sendo o mesmo com a
   * rede caída. Quem conta que a leitura falhou é o valor — que vira `—`, nunca
   * `R$ 0,00` — e o aviso logo abaixo, com o motivo.
   */
  const metricas: ItemMetrica[] = [
    {
      l: "Saldo na conta Asaas",
      v: p.saldo.ok ? fmt(p.saldo.valor) : "—",
      c: p.saldo.ok && p.saldo.valor < 0 ? "c-red" : "c-green",
      icone: "building-bank",
      fonte: "GET /finance/balance do Asaas, lido a cada abertura desta tela",
    },
    {
      l: "Recebido pelo gateway",
      v: p.cobrancas.ok ? fmt(p.cobrancas.valor.valor_bruto) : "—",
      icone: "arrow-down-circle",
      fonte: "GET /finance/payment/statistics do Asaas — soma bruta das cobrancas liquidadas",
    },
    {
      l: "Liquido de taxas",
      v: p.cobrancas.ok ? fmt(p.cobrancas.valor.valor_liquido) : "—",
      icone: "receipt",
      fonte: "mesmo endpoint, campo netValue — o bruto menos a taxa do gateway",
    },
    {
      l: "Cobrancas liquidadas",
      v: p.cobrancas.ok ? p.cobrancas.valor.quantidade : "—",
      icone: "list-check",
      fonte: "quantidade devolvida por GET /finance/payment/statistics do Asaas",
    },
  ];


  return (
    <>
      <PageHeader title="Contas bancárias" />

      <div className="card" style={{ marginBottom: "var(--e-4)" }}>
        <p className="tiny muted" style={{ margin: 0 }}>
          Os números abaixo são lidos da <strong>API do Asaas a cada abertura desta tela</strong> —
          não há cópia no banco e não há saldo digitado. A leitura desta página foi feita em{" "}
          {fmtDataHora(p.lido_em)}.
        </p>
      </div>

      <MetricGrid items={metricas} />

      {(!p.saldo.ok || !p.cobrancas.ok) && (
        <div className="aviso-parcial" role="status">
          <i className="ti ti-alert-triangle" aria-hidden="true" />
          <span>
            {!p.saldo.ok && <>O saldo não pôde ser lido do Asaas: {p.saldo.erro}. </>}
            {!p.cobrancas.ok && <>As estatísticas de cobrança não responderam: {p.cobrancas.erro}. </>}
            Nenhum valor foi substituído por zero — o que está sem resposta aparece como{" "}
            <strong>—</strong>, porque zero seria uma afirmação sobre o seu caixa.
          </span>
        </div>
      )}

      <div className="two" style={{ marginTop: "var(--e-4)" }}>
        <div className="card">
          <div className="stitle">
            <i className="ti ti-id-badge-2 c-orange" />
            Titular da conta
          </div>
          <Bloco leitura={p.titular}>
            {(t) => (
              <table>
                <tbody>
                  <tr>
                    <td className="tiny muted">Nome</td>
                    <Sigilo as="td">{t.nome}</Sigilo>
                  </tr>
                  <tr>
                    <td className="tiny muted">CPF/CNPJ</td>
                    <Sigilo as="td">{t.documento ?? "—"}</Sigilo>
                  </tr>
                  <tr>
                    <td className="tiny muted">E-mail</td>
                    <Sigilo as="td">{t.email ?? "—"}</Sigilo>
                  </tr>
                  <tr>
                    <td className="tiny muted">Praça</td>
                    <td>{[t.cidade, t.uf].filter(Boolean).join(" / ") || "—"}</td>
                  </tr>
                  <tr>
                    <td className="tiny muted">Situação no gateway</td>
                    <td>
                      {/* ⚠️ `APPROVED` é o único estado que transaciona. Traduzir os
                          outros para "pendente" apagaria a diferença entre
                          "em análise" e "reprovada", que muda o que fazer. */}
                      {t.situacao === "APPROVED" ? "Aprovada" : (t.situacao ?? "—")}
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
          </Bloco>
        </div>

        <div className="card">
          <div className="stitle">
            <i className="ti ti-qrcode c-orange" />
            Chaves Pix da conta
          </div>
          <Bloco leitura={p.pix}>
            {(chaves) =>
              !chaves.length ? (
                <Empty icone="ti-qrcode">Nenhuma chave Pix cadastrada no Asaas.</Empty>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Chave</th>
                      <th>Tipo</th>
                      <th>Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chaves.map((k) => (
                      <tr key={k.chave}>
                        <Sigilo as="td" className="tiny">
                          {k.chave}
                        </Sigilo>
                        <td>{k.tipo}</td>
                        <td>{k.situacao === "ACTIVE" ? "Ativa" : k.situacao}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            }
          </Bloco>
        </div>
      </div>

      <section style={{ marginTop: "var(--e-6)" }}>
        <h2 className="pt" style={{ fontSize: "1rem" }}>
          Extrato da conta Asaas{" "}
          <span className="tiny muted">
            (últimos {p.extrato.ok ? p.extrato.valor.length : 0} lançamentos)
          </span>
        </h2>

        <div className="card tbl-wrap">
          <Bloco leitura={p.extrato}>
            {(linhas) =>
              !linhas.length ? (
                <Empty icone="ti-list">Nenhuma movimentação na conta.</Empty>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Movimentação</th>
                      <th>Descrição</th>
                      <th style={{ textAlign: "right" }}>Valor</th>
                      <th style={{ textAlign: "right" }}>Saldo após</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map((l) => (
                      <tr key={l.id}>
                        <td>{fmtDate(l.data)}</td>
                        <td className="tiny">{rotuloExtrato(l.tipo)}</td>
                        {/* A descrição do Asaas carrega o nome do pagador. */}
                        <Sigilo as="td" className="tiny">
                          {l.descricao}
                        </Sigilo>
                        <td
                          className={l.valor < 0 ? "c-red" : "c-green"}
                          style={{ textAlign: "right", fontWeight: 500 }}
                        >
                          <Dinheiro v={l.valor} />
                        </td>
                        {
                          /* ⚖️ O saldo após vem do gateway, não de uma soma
                             feita aqui: recalcular criaria um segundo saldo, e
                             é a existência de um segundo saldo que produziu o
                             defeito que esta tela veio corrigir. */
                        }
                        <td style={{ textAlign: "right" }}>
                          {l.saldo_apos === null ? "—" : <Dinheiro v={l.saldo_apos} />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            }
          </Bloco>
        </div>
      </section>

      <div style={{ marginTop: "var(--e-6)" }}>
        <ContasInternas />
      </div>
    </>
  );
}

/**
 * Renderiza o conteúdo quando a leitura deu certo, e o motivo quando não deu.
 *
 * ⛔ Existe para que **nenhum bloco desta tela possa mostrar um vazio mudo**.
 * Uma tabela vazia por falha de rede é indistinguível de uma conta sem
 * movimentação, e as duas pedem ações opostas.
 */
function Bloco<T>({
  leitura,
  children,
}: {
  leitura: Leitura<T>;
  children: (valor: T) => React.ReactNode;
}) {
  if (!leitura.ok) {
    return (
      <div className="recado recado-erro" role="status">
        Não foi possível ler do Asaas: {leitura.erro}
      </div>
    );
  }
  return <>{children(leitura.valor)}</>;
}

/**
 * Data **e hora** da leitura — mesma razão de `/servicos` (`D-90`): só a data
 * não distingue "lido agora" de "lido às 00:52 e parado desde então".
 */
function fmtDataHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${fmtDate(iso.slice(0, 10))} ${d.toISOString().slice(11, 16)} UTC`;
}
