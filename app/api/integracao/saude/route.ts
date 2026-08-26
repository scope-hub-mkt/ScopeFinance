import { NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { diagnostico, estadoIntegracao, veredito } from "@/lib/integracao/config";
import { autenticarChave } from "@/lib/integracao/auth";

export const dynamic = "force-dynamic";

/**
 * `GET /api/integracao/saude` — o "está no ar e me reconhece?" da integração.
 *
 * ⚠️ **É a única rota de `/api/integracao/*` que responde sem chave** — e
 * responde **menos** quando não há chave. Sem credencial, diz só que existe e
 * o que falta provisionar (nomes de variáveis, nunca valores); com a chave
 * certa, confirma o vínculo e conta as linhas. Uma saúde que exige a
 * credencial que se está tentando depurar não ajuda a depurar nada.
 */
export async function GET(req: Request) {
  const estado = estadoIntegracao();
  const itens = diagnostico(estado);
  const v = veredito(itens);

  const autenticado = autenticarChave(estado.apiKey, req.headers.get("authorization")).ok;

  const base = {
    sistema: "scopefinance",
    versao: "v1",
    integracao: {
      pronta: v.pronta,
      recebe_da_dashboard: v.entrada,
      envia_para_dashboard: v.saida,
      faltando: v.faltando,
    },
    autenticado,
  };

  if (!autenticado) return NextResponse.json(base);

  // Só para quem provou a credencial: contagens, que são dado de negócio.
  //
  // ⚠️ **Cada sonda reporta o PRÓPRIO erro** — corrigido em 26/08/2026, e a
  // correção nasceu de um sintoma real: na primeira chamada após um deploy,
  // `contas_receber` voltou `null` enquanto as outras duas voltaram número.
  // A versão anterior só expunha `clientes.error`, então o motivo do `null`
  // ficou invisível e virou mistério — num endpoint de SAÚDE, que existe
  // exatamente para não deixar nada invisível.
  //
  // `null` com `erro: null` continua possível e significa outra coisa:
  // consulta respondeu sem contagem. Distinguir "falhou" de "não contou" é o
  // trabalho deste endpoint.
  const supabase = createSupabaseAdmin();
  const [clientes, receber, fila] = await Promise.all([
    supabase.from("clientes").select("id", { count: "exact", head: true }),
    supabase.from("contas_receber").select("id", { count: "exact", head: true }),
    supabase
      .from("integracao_enviados")
      .select("id", { count: "exact", head: true })
      .eq("entregue", false),
  ]);

  const erros = [
    clientes.error && `clientes: ${clientes.error.message}`,
    receber.error && `contas_receber: ${receber.error.message}`,
    fila.error && `integracao_enviados: ${fila.error.message}`,
  ].filter(Boolean) as string[];

  return NextResponse.json({
    ...base,
    banco: {
      // Alcançável = NENHUMA das três falhou. Antes bastava a primeira passar,
      // e duas tabelas podiam estar inacessíveis com o banco dito "alcançável".
      alcancavel: erros.length === 0,
      clientes: clientes.count ?? null,
      contas_receber: receber.count ?? null,
      fila_de_saida: fila.count ?? null,
      erro: erros.length === 0 ? null : erros.join(" · "),
    },
  });
}
