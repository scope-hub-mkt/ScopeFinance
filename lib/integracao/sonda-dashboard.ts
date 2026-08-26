import "server-only";
import { estadoIntegracao } from "./config";

/**
 * A sonda que faltava: **chamar a Dashboard de verdade**.
 *
 * ⚖️ **Por que este arquivo existe** — 26/08/2026. A tela `/integracao`
 * mostrava "Pronto · Pronto · 0 variáveis pendentes" e o botão *Testar
 * conexão* respondia "Serviço de integração no ar" enquanto a reconciliação
 * falhava com 401 **em toda passada**. Nenhuma das duas afirmações era
 * mentira; as duas mediam outra coisa:
 *
 * | O que a tela dizia | O que ela media de fato |
 * |---|---|
 * | "Configurada" nas 6 linhas | a variável de ambiente **não está vazia** |
 * | "Serviço de integração no ar" | o **nosso** `/saude` responde |
 *
 * Nenhuma das duas jamais tocou a Dashboard. `SCOPE_DASHBOARD_API_KEY_OUT`
 * podia conter o prefixo mascarado (`sk_live_Ptxq1M…`) que a tela de lá
 * exibe na tabela, e os dois indicadores continuariam verdes.
 *
 * ⛔ **A lição é a de `L-36` da Dashboard, e ela vale nos dois repositórios:
 * presença de variável não é prova de valor certo.** Só a chamada real
 * distingue "preenchido" de "funciona" — e por isso ela agora existe, roda no
 * botão e reporta o motivo com o corpo junto.
 */

export interface ResultadoSonda {
  /** A chamada real chegou à Dashboard e foi aceita? */
  ok: boolean;
  /** Frase curta para a tela — sempre presente, nos dois estados. */
  mensagem: string;
  /** Status HTTP observado, ou `null` se a chamada nem saiu. */
  status: number | null;
  /** Quantos clientes o cadastro mestre devolveu, quando `ok`. */
  clientes: number | null;
  /** O que corrigir, quando não `ok`. Nunca contém segredo. */
  acao: string | null;
}

/**
 * `GET {base}/clientes-mestre` com a chave de saída — a mesma chamada que a
 * reconciliação faz, com o mesmo material.
 *
 * ⚠️ Chama **exatamente** a rota que a reconciliação usa, de propósito. Uma
 * sonda que batesse num endpoint mais fácil (um `/ping` sem autenticação)
 * voltaria a verde sem provar nada — que é o defeito que ela veio corrigir.
 */
export async function sondarDashboard(): Promise<ResultadoSonda> {
  const { dashboardBase: base, dashboardApiKey: chave } = estadoIntegracao();

  if (!base || !chave) {
    const faltando = [
      !base ? "SCOPE_DASHBOARD_API_BASE" : null,
      !chave ? "SCOPE_DASHBOARD_API_KEY_OUT" : null,
    ].filter(Boolean);
    return {
      ok: false,
      mensagem: `Não provisionada: falta ${faltando.join(" e ")}.`,
      status: null,
      clientes: null,
      acao: "Cadastre a variável na Vercel e redeploye — variável nova só vale no próximo deploy.",
    };
  }

  let resp: Response;
  try {
    resp = await fetch(`${base}/clientes-mestre`, {
      headers: { Authorization: `Bearer ${chave}` },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  } catch (e) {
    return {
      ok: false,
      mensagem: e instanceof Error ? e.message : "erro de rede",
      status: null,
      clientes: null,
      acao: `A chamada não saiu. Confira se ${base} está no ar e acessível.`,
    };
  }

  if (resp.ok) {
    let clientes: number | null = null;
    try {
      const corpo = (await resp.json()) as { dados?: unknown[] };
      clientes = Array.isArray(corpo.dados) ? corpo.dados.length : null;
    } catch {
      clientes = null;
    }
    return {
      ok: true,
      mensagem:
        clientes === null
          ? "Conexão confirmada: a Dashboard reconheceu a chave."
          : `Conexão confirmada: a Dashboard reconheceu a chave e devolveu ${clientes} cliente(s) no cadastro mestre.`,
      status: resp.status,
      clientes,
      acao: null,
    };
  }

  // Corpo junto: é ele que separa "a aplicação recusou a chave" de "a Vercel
  // recusou a requisição antes de a aplicação existir".
  let corpo = "";
  try {
    corpo = (await resp.text()).replace(/\s+/g, " ").trim().slice(0, 300);
  } catch {
    corpo = "";
  }

  const daAplicacao = corpo.includes('"code"');
  const acao =
    resp.status === 401
      ? daAplicacao
        ? "A Dashboard não reconheceu a chave. Gere uma nova em Administração → API e Webhooks (escopo clientes:read), copie o valor INTEIRO da janela que aparece uma única vez — não o prefixo mascarado da tabela — e cole em SCOPE_DASHBOARD_API_KEY_OUT."
        : "Quem recusou não parece ser a aplicação: a resposta não tem o corpo de erro dela. Verifique se SCOPE_DASHBOARD_API_BASE aponta para a produção e não para uma implantação com Vercel Authentication ligada."
      : resp.status === 403
        ? "A chave foi reconhecida mas não tem o escopo clientes:read."
        : resp.status === 404
          ? "Rota não encontrada — confira se SCOPE_DASHBOARD_API_BASE termina em /api/v1."
          : "Veja o corpo da resposta acima.";

  return {
    ok: false,
    mensagem: corpo ? `Dashboard respondeu ${resp.status} — ${corpo}` : `Dashboard respondeu ${resp.status}`,
    status: resp.status,
    clientes: null,
    acao,
  };
}
