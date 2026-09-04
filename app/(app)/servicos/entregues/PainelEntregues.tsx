"use client";

import { useMemo, useState } from "react";
import { Badge, MetricGrid, Dinheiro, type ItemMetrica } from "@/components/ui";
import { fmt, fmtDate } from "@/lib/format";
import { descreverCiclo, descreverTermino } from "@/lib/ciclo-de-vida";
import type { TelaServicosEntregues } from "@/lib/dominio/servicos-entregues";

/**
 * Serviços entregues — o gêmeo financeiro do painel da Dashboard.
 *
 * ⚖️ **A pergunta que ESTA tela responde é outra.** Lá: *quem entrega e
 * quanto recebe de comissão*. Aqui: *o que foi cobrado por isso, o que
 * entrou, e o que ainda não virou cobrança nenhuma*. Repetir a pergunta da
 * Dashboard criaria duas respostas para o mesmo fato, e a que diverge é
 * sempre a que ninguém confere.
 */

type Situacao = "todos" | "ativo" | "encerrado" | "sem-cobranca";

export function PainelEntregues({ dados }: { dados: TelaServicosEntregues }) {
  const [cliente, setCliente] = useState("");
  const [situacao, setSituacao] = useState<Situacao>("todos");
  const [busca, setBusca] = useState("");

  const linhas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return dados.linhas.filter((l) => {
      if (cliente && l.cliente_id !== cliente) return false;
      if (situacao === "ativo" && l.contrato_status !== "Ativo") return false;
      if (situacao === "encerrado" && l.contrato_status === "Ativo") return false;
      if (situacao === "sem-cobranca" && !(l.contrato_status === "Ativo" && l.cobrancas === 0))
        return false;
      if (
        termo &&
        !`${l.cliente_nome} ${l.servico_nome} ${l.descricao}`.toLowerCase().includes(termo)
      )
        return false;
      return true;
    });
  }, [dados.linhas, cliente, situacao, busca]);

  const tiles: ItemMetrica[] = [
    {
      l: "Itens de contrato",
      v: String(dados.totais.itens),
      icone: "list-details",
      fonte: "contrato_servicos",
    },
    {
      l: "Em contrato ativo",
      v: String(dados.totais.ativos),
      icone: "player-play",
      fonte: "itens cujo contrato está Ativo",
    },
    {
      l: "Recorrentes",
      v: String(dados.totais.recorrentes),
      icone: "refresh",
      fonte: "itens ativos com recorrência declarada",
    },
    {
      l: "Cobrado",
      v: fmt(dados.totais.cobrado),
      c: "c-blue",
      icone: "receipt",
      fonte: "soma de contas a receber dos contratos destes itens",
    },
    {
      l: "Recebido",
      v: fmt(dados.totais.recebido),
      c: "c-green",
      icone: "circle-check",
      fonte: "contas a receber com status Pago",
    },
    {
      // ⛔ Serviço entregue que nunca virou cobrança.
      l: "Sem cobrança",
      v: String(dados.totais.semCobranca),
      c: dados.totais.semCobranca > 0 ? "c-red" : "",
      icone: "alert-triangle",
      fonte: "itens de contrato ativo sem nenhuma conta a receber",
    },
  ];

  const filtrando = cliente || situacao !== "todos" || busca.trim();

  return (
    <>
      <MetricGrid items={tiles} />

      <div className="card" style={{ marginBottom: "var(--e-4)" }}>
        <div className="fgrid">
          <label>
            <span className="tiny" style={{ display: "block" }}>
              Cliente
            </span>
            <select value={cliente} onChange={(e) => setCliente(e.target.value)}>
              <option value="">Todos</option>
              {dados.clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome} ({c.itens})
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className="tiny" style={{ display: "block" }}>
              Situação
            </span>
            <select value={situacao} onChange={(e) => setSituacao(e.target.value as Situacao)}>
              <option value="todos">Todas</option>
              <option value="ativo">Em contrato ativo</option>
              <option value="encerrado">Encerrados</option>
              <option value="sem-cobranca">Ativos sem cobrança</option>
            </select>
          </label>

          <label>
            <span className="tiny" style={{ display: "block" }}>
              Buscar
            </span>
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="cliente, serviço ou descrição"
            />
          </label>

          {filtrando ? (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                setCliente("");
                setSituacao("todos");
                setBusca("");
              }}
            >
              Limpar filtros
            </button>
          ) : null}
        </div>
      </div>

      <div className="card tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Serviço</th>
              <th className="num">Valor do item</th>
              <th>Vigência do contrato</th>
              <th className="num">Cobrado</th>
              <th className="num">Recebido</th>
              <th>Situação</th>
            </tr>
          </thead>
          <tbody>
            {!linhas.length && (
              <tr>
                <td colSpan={7}>
                  <div className="empty">
                    {dados.linhas.length === 0
                      ? "Nenhum item de contrato ainda. Eles nascem quando um contrato ganha serviços, em Contratos."
                      : "Nenhum item com estes filtros."}
                  </div>
                </td>
              </tr>
            )}

            {linhas.map((l) => (
              <tr key={l.id}>
                <td className="sigilo">{l.cliente_nome}</td>

                <td className="sigilo">
                  {l.servico_nome}
                  <div className="tiny">
                    {l.descricao}
                    {" · "}
                    {/* `RF-105` — o rotulo diz O QUE o numero significa. A
                        mesma frase da Dashboard, de proposito: o mesmo servico
                        descrito de dois jeitos faz a pessoa achar que sao
                        coisas diferentes. */}
                    {descreverCiclo({
                      recorrente: Boolean(l.recorrencia),
                      encerrado: l.contrato_status !== "Ativo",
                      dias: l.dias,
                      temFim: l.contrato_fim !== null,
                    })}
                    {l.recorrencia ? ` · ${l.recorrencia}` : ""}
                    {l.quantidade !== 1 ? ` · ${l.quantidade}×` : ""}
                  </div>
                </td>

                <td className="num">
                  {l.valor === null ? <span className="tiny">a informar</span> : <Dinheiro v={l.valor} />}
                </td>

                <td className="tiny">
                  {l.contrato_inicio ? fmtDate(l.contrato_inicio) : "—"}
                  {" → "}
                  {l.contrato_fim ? (
                    fmtDate(l.contrato_fim)
                  ) : (
                    (() => {
                      const t = descreverTermino({
                        recorrente: Boolean(l.recorrencia),
                        encerrado: l.contrato_status !== "Ativo",
                        dias: l.dias,
                        temFim: false,
                      });
                      return (
                        <span className={t.lacuna ? "c-orange" : undefined} title={t.explicacao}>
                          {t.texto}
                        </span>
                      );
                    })()
                  )}
                </td>

                <td className="num">
                  <Dinheiro v={l.cobrado} />
                  <div className="tiny">
                    {l.cobrancas} cobrança{l.cobrancas === 1 ? "" : "s"}
                    {l.cobrancas_manuais > 0 && (
                      <span className="c-orange"> · {l.cobrancas_manuais} fora do gateway</span>
                    )}
                  </div>
                </td>

                <td className="num c-green">
                  <Dinheiro v={l.recebido} />
                </td>

                <td>
                  <Badge s={l.contrato_status} />
                  {l.contrato_status === "Ativo" && l.cobrancas === 0 && (
                    <div className="tiny c-red">sem cobrança</div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {linhas.length > 0 && (
        <p className="tiny" style={{ marginTop: "var(--e-2)" }}>
          {linhas.length} de {dados.linhas.length} item{dados.linhas.length === 1 ? "" : "s"}.
        </p>
      )}
    </>
  );
}
