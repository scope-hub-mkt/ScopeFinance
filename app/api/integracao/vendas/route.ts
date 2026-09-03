import { NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { rotaIntegracao } from "@/lib/integracao/rota";
import { FONTE } from "@/lib/integracao/contrato";

export const dynamic = "force-dynamic";

/**
 * `GET /api/integracao/vendas?desde=YYYY-MM-DD&tipo=avulsa|contrato|assinatura`
 *
 * O que o `RF-DASH-02` pede: a Dashboard recebe **Vendas**, subdividido em
 * Contratos, Avulsas e Assinaturas. Isso não existia — medido em 27/08/2026,
 * a Dashboard tinha **0 vendas e 0 comissões**.
 *
 * ⛔ **Somente leitura do lado de lá** (`RN-04` / `RF-DASH-06`), e a Dashboard
 * **nunca recalcula** nenhum destes números (`ESTADO §8.2`). Quando este
 * endpoint não responde, a tela de lá mostra *"não disponível"* — nunca zero,
 * nunca uma série inventada. *Um zero afirma "não houve"; um traço admite
 * "não sei".*
 *
 * 📐 **`fonte` viaja em cada linha** (`ESTADO §8.10`): todo número declara de
 * onde veio, e é isso que permite a uma tela dizer a procedência do que exibe.
 *
 * ⚖️ **Por que `valor_contratado` e `valor_recebido` são campos distintos**
 * (§4.7): não são versões do mesmo número, são fatos diferentes — o que foi
 * combinado com o cliente e o que efetivamente entrou. Achatá-los num só
 * obrigaria a escolher uma verdade e apagar a outra, e é justamente a
 * divergência entre eles que o negócio precisa ver.
 */
export const GET = rotaIntegracao(async (req: Request) => {
  const url = new URL(req.url);
  const desde = url.searchParams.get("desde");
  const tipo = url.searchParams.get("tipo");

  const supabase = createSupabaseAdmin();

  let consulta = supabase
    .from("contas_receber")
    .select(
      "id, cliente_id, contrato_id, assinatura_id, tipo_venda, descricao, " +
        "valor, valor_contratado, valor_cobrado, valor_liquido, valor_pago, deducoes, " +
        "status, asaas_status, vencimento, pago_em, competencia, created_at"
    )
    // ⛔ **Só o que nasceu no gateway atravessa a ponte** (`RF-94`, `RN-51`,
    // `D-99`). Recebível digitado à mão existe, aparece em `/receber/manuais`
    // e é conciliável — o que ele não faz é chegar à Dashboard como se o
    // Asaas o tivesse recebido.
    //
    // ⚖️ O filtro mora **na consulta**, não em quem escreve: vale para
    // qualquer caminho que produza linha manual — a tela, a recorrência
    // interna, um backfill futuro — em vez de depender de cada um lembrar. É
    // a mesma correção que a contagem de clientes ativos recebeu em 28/08.
    .eq("origem_lancamento", "asaas")
    // Teto declarado, pela mesma doutrina de `lib/scopefinance.ts` da
    // Dashboard: um teto existe para impedir que a tabela cresça até derrubar
    // o egress, não para apertar o caso normal. Hoje são 194 linhas.
    .limit(5_000)
    .order("vencimento", { ascending: false });

  if (desde) consulta = consulta.gte("vencimento", desde);
  if (tipo === "avulsa" || tipo === "contrato" || tipo === "assinatura") {
    consulta = consulta.eq("tipo_venda", tipo);
  }

  const { data, error } = await consulta;

  if (error) {
    // ⛔ Erro vira erro, nunca lista vazia. É a lição literal do `L-84`: uma
    // consulta que quebra e devolve `200` com `[]` faz "quebrou" e "não há
    // venda nenhuma" ficarem indistinguíveis para quem consome — e a segunda
    // leitura é a que parece normal.
    return NextResponse.json(
      { error: "não foi possível ler as vendas", detalhe: error.message },
      { status: 502 }
    );
  }

  // Via `unknown`: o tipo que o postgrest-js infere para um `select` com
  // string longa é `GenericStringError[]`, e ele não se sobrepõe ao formato
  // real. A conversão é declarada porque o `error` acima já garante que
  // chegamos aqui só com linhas.
  const linhas = (data ?? []) as unknown as Array<Record<string, unknown>>;

  return NextResponse.json(
    linhas.map((v) => ({
      venda_id: v.id,
      cliente_id: v.cliente_id,
      tipo: v.tipo_venda ?? (v.assinatura_id ? "assinatura" : "avulsa"),
      contrato_id: v.contrato_id,
      assinatura_id: v.assinatura_id,
      descricao: v.descricao,
      // O combinado com o cliente. Editável AQUI (`RN-03`), nunca lá.
      valor_contratado: num(v.valor_contratado ?? v.valor),
      // O que o gateway cobrou e o que sobrou depois da taxa — espelho.
      valor_cobrado: num(v.valor_cobrado),
      valor_liquido: num(v.valor_liquido),
      // O que efetivamente entrou. Null quando não entrou — e null é
      // diferente de zero, porque zero afirmaria que entrou nada.
      valor_recebido: v.status === "Pago" ? num(v.valor_pago ?? v.valor) : null,
      deducoes: num(v.deducoes),
      status: v.status,
      status_gateway: v.asaas_status,
      vencimento: v.vencimento,
      recebido_em: v.pago_em,
      competencia: v.competencia,
      ocorrido_em: v.created_at,
      fonte: FONTE,
    }))
  );
});

/** `null` continua `null`; só número vira número. */
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
