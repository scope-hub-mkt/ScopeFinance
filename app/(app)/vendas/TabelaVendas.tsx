import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { Badge, Empty, PageHeader } from "@/components/ui";
import { fmt, fmtDate } from "@/lib/format";

/**
 * A listagem que serve os quatro recortes de **Vendas** (§8.1 do plano).
 *
 * ⚖️ Uma tabela e um filtro, não quatro telas: os submenus são recortes do
 * mesmo fato — uma cobrança —, e quatro implementações do mesmo `select`
 * divergiriam na primeira coluna que alguém acrescentasse a uma só.
 *
 * ⛔ **`valor_contratado` e `valor_cobrado` aparecem lado a lado, e a
 * divergência é mostrada, não escondida** (§4.7). Quando os dois diferem,
 * cobrou-se diferente do combinado — isso é informação de negócio real, não um
 * defeito a maquiar.
 */
export async function TabelaVendas({
  tipo,
  titulo,
  descricao,
}: {
  tipo?: "avulsa" | "contrato" | "assinatura";
  titulo: string;
  descricao: string;
}) {
  const supabase = createSupabaseAdmin();

  let consulta = supabase
    .from("contas_receber")
    .select(
      "id, descricao, cliente_id, tipo_venda, valor, valor_contratado, valor_cobrado, valor_liquido, status, asaas_status, vencimento, pago_em, forma_pagamento"
    )
    .order("vencimento", { ascending: false })
    .limit(500);

  if (tipo) consulta = consulta.eq("tipo_venda", tipo);

  const [{ data, error }, { data: clientes }] = await Promise.all([
    consulta,
    supabase.from("clientes").select("id, nome").limit(2000),
  ]);

  const nomePorId = new Map(
    ((clientes ?? []) as Array<{ id: string; nome: string }>).map((c) => [c.id, c.nome])
  );
  const linhas = (data ?? []) as Array<Record<string, unknown>>;

  return (
    <>
      <PageHeader title={titulo} />

      <div className="card" style={{ marginBottom: "var(--e-4, 16px)" }}>
        <p className="tiny muted" style={{ margin: 0 }}>
          {descricao}
        </p>
      </div>

      <div className="sbar">
        <span className="tiny">{linhas.length} venda(s)</span>
      </div>

      <div className="card tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>Descrição</th>
              <th>Cliente</th>
              <th>Tipo</th>
              <th>Contratado</th>
              <th>Cobrado</th>
              <th>Líquido</th>
              <th>Vencimento</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {error && (
              <tr>
                <td colSpan={8}>
                  {/* ⛔ `ESTADO §8.8`: sem dado, "não disponível" — nunca zero,
                      nunca uma lista vazia que se lê como "não houve venda". */}
                  <Empty icone="ti-plug-off">
                    Não disponível — as vendas não puderam ser lidas agora.
                  </Empty>
                </td>
              </tr>
            )}
            {!error && !linhas.length && (
              <tr>
                <td colSpan={8}>
                  <Empty icone="ti-receipt-off">Nenhuma venda neste recorte.</Empty>
                </td>
              </tr>
            )}
            {linhas.map((v) => {
              const contratado = v.valor_contratado ?? v.valor;
              const cobrado = v.valor_cobrado;
              const diverge =
                cobrado != null && contratado != null && Number(cobrado) !== Number(contratado);

              return (
                <tr key={String(v.id)}>
                  <td>{String(v.descricao)}</td>
                  <td>
                    {v.cliente_id ? (
                      (nomePorId.get(String(v.cliente_id)) ?? "—")
                    ) : (
                      // Cobrança sem cliente é o §2.3 funcionando: o gateway
                      // nunca cria cliente sozinho. Ela fica visível esperando
                      // conciliação, em vez de sumir.
                      <span className="muted" title="cobrança aguardando conciliação de cliente">
                        sem cliente vinculado
                      </span>
                    )}
                  </td>
                  <td>
                    <Badge s={(v.tipo_venda as string) ?? "avulsa"} />
                  </td>
                  <td>{contratado == null ? "—" : fmt(Number(contratado))}</td>
                  <td>
                    {cobrado == null ? "—" : fmt(Number(cobrado))}
                    {diverge && (
                      <div className="tiny" title="cobrou-se diferente do combinado (§4.7)">
                        ⚠ diverge do contratado
                      </div>
                    )}
                  </td>
                  <td>{v.valor_liquido == null ? "—" : fmt(Number(v.valor_liquido))}</td>
                  <td>{fmtDate(String(v.vencimento ?? "").slice(0, 10))}</td>
                  <td>
                    <Badge s={String(v.status)} titulo={(v.asaas_status as string) ?? undefined} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
