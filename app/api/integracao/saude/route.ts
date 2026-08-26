import { NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import {
  diagnostico,
  estadoIntegracao,
  sondar,
  veredito,
  type Alvo,
} from "@/lib/integracao/config";
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
  // ⚠️ **Cada sonda reporta o PRÓPRIO erro** — 26/08/2026, e a correção nasceu
  // de um sintoma real: na primeira chamada após um deploy, `contas_receber`
  // voltou `null` enquanto as outras duas voltaram número. A versão anterior
  // só expunha `clientes.error`, então o motivo do `null` ficou invisível num
  // endpoint de SAÚDE, que existe exatamente para não deixar nada invisível.
  //
  // ♻️ **Segunda rodada, mesmo dia.** Aquela correção expôs o erro certo e ele
  // veio **vazio** (`"integracao_enviados: "`) — sonda de contagem usa HTTP
  // HEAD, e HEAD não tem corpo para o postgrest-js transformar em mensagem.
  // `descreverFalha` resolve isso pelo status HTTP; `sondar` separa a queda
  // real do blip de partida a frio. O raciocínio está em `lib/integracao/config.ts`.
  //
  // `null` com `erro: null` continua possível e significa outra coisa:
  // consulta respondeu sem contagem. Distinguir "falhou" de "não contou" é o
  // trabalho deste endpoint.
  const supabase = createSupabaseAdmin();
  const alvos: Alvo[] = [
    {
      nome: "clientes",
      contar: () => supabase.from("clientes").select("id", { count: "exact", head: true }),
    },
    {
      nome: "contas_receber",
      contar: () => supabase.from("contas_receber").select("id", { count: "exact", head: true }),
    },
    {
      nome: "integracao_enviados",
      contar: () =>
        supabase
          .from("integracao_enviados")
          .select("id", { count: "exact", head: true })
          .eq("entregue", false),
    },
  ];

  const [clientes, receber, fila] = await Promise.all(alvos.map(sondar));
  const medidas = [clientes, receber, fila];
  const erros = medidas.map((m) => m.erro).filter((e): e is string => e !== null);
  const instaveis = medidas.map((m) => m.instavel).filter((e): e is string => e !== null);

  return NextResponse.json({
    ...base,
    banco: {
      // Alcançável = NENHUMA das três falhou. Antes bastava a primeira passar,
      // e duas tabelas podiam estar inacessíveis com o banco dito "alcançável".
      alcancavel: erros.length === 0,
      clientes: clientes.contagem,
      contas_receber: receber.contagem,
      fila_de_saida: fila.contagem,
      erro: erros.length === 0 ? null : erros.join(" · "),
      // Falhou de primeira e passou na segunda: o banco está de pé, e o blip
      // fica registrado. É o que separa "está tudo bem" de "está bem agora".
      instavel: instaveis.length === 0 ? null : instaveis.join(" · "),
    },
  });
}
