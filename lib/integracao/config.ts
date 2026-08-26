import "server-only";

/**
 * Onde as variáveis da integração são lidas — o único lugar.
 *
 * Decisão do dono em 25/08/2026: **variável de ambiente + painel de status**.
 * O segredo mora na Vercel; a tela `/integracao` mostra o que está
 * configurado e testa a conexão, **sem nunca exibir o valor**. É o meio-termo
 * honesto entre "provisionar é deploy" e construir uma tabela de credenciais
 * só para isto — a Dashboard já tem essa tela do lado dela (`RF-58`).
 */

export interface EstadoIntegracao {
  /** URL base da API pública da Dashboard, ex.: https://…vercel.app/api/v1 */
  dashboardBase: string | null;
  /** Chave da API da Dashboard, para LERMOS o cadastro mestre de lá. */
  dashboardApiKey: string | null;
  /** URL do webhook de entrada da Dashboard que recebe os nossos eventos. */
  dashboardWebhookUrl: string | null;
  /** Segredo com que assinamos o que mandamos para a Dashboard. */
  dashboardWebhookSecret: string | null;
  /** Chave que a Dashboard apresenta para ler as nossas rotas. */
  apiKey: string | null;
  /** Segredo com que a Dashboard assina o que manda para cá. */
  webhookSecret: string | null;
}

const limpa = (v: string | undefined): string | null => {
  const s = (v ?? "").trim();
  return s === "" ? null : s;
};

/**
 * `Record<string, string | undefined>` e não `NodeJS.ProcessEnv`: o teste
 * precisa montar um ambiente com duas variáveis, e `ProcessEnv` exige
 * `NODE_ENV`. Um tipo que obriga o teste a mentir sobre o que está medindo
 * atrapalha mais do que documenta.
 */
export function estadoIntegracao(
  env: Record<string, string | undefined> = process.env
): EstadoIntegracao {
  return {
    dashboardBase: limpa(env.SCOPE_DASHBOARD_API_BASE)?.replace(/\/+$/, "") ?? null,
    dashboardApiKey: limpa(env.SCOPE_DASHBOARD_API_KEY_OUT),
    dashboardWebhookUrl: limpa(env.SCOPE_DASHBOARD_WEBHOOK_URL),
    dashboardWebhookSecret: limpa(env.SCOPE_DASHBOARD_WEBHOOK_SECRET),
    apiKey: limpa(env.SCOPE_DASHBOARD_API_KEY),
    webhookSecret: limpa(env.SCOPE_WEBHOOK_SECRET),
  };
}

export interface ItemDiagnostico {
  chave: string;
  rotulo: string;
  configurado: boolean;
  obrigatorioPara: string;
  ajuda: string;
}

/**
 * O que a tela `/integracao` mostra.
 *
 * ⚠️ Mede **presença da variável, não que ela esteja certa** — a mesma
 * ressalva que a Dashboard registrou em `L-36` sobre a chave da NVIDIA.
 * Por isso a tela tem, ao lado, o botão que faz uma chamada de verdade: só
 * ele distingue "preenchido" de "funciona".
 */
export function diagnostico(estado: EstadoIntegracao): ItemDiagnostico[] {
  return [
    {
      chave: "SCOPE_DASHBOARD_API_KEY",
      rotulo: "Chave que a Dashboard usa para nos ler",
      configurado: estado.apiKey !== null,
      obrigatorioPara: "A Dashboard lê clientes, resumo, série e pagamentos daqui",
      ajuda: "O MESMO valor vai em SCOPEFINANCE_API_KEY na Dashboard (Administração → Integrações).",
    },
    {
      chave: "SCOPE_WEBHOOK_SECRET",
      rotulo: "Segredo dos eventos que a Dashboard nos envia",
      configurado: estado.webhookSecret !== null,
      obrigatorioPara: "Receber cliente.criado — sem ele, cliente cadastrado lá não chega aqui",
      ajuda: "É o segredo_hmac da assinatura de webhook cadastrada na Dashboard para esta URL.",
    },
    {
      chave: "SCOPE_DASHBOARD_WEBHOOK_URL",
      rotulo: "URL da Dashboard que recebe os nossos eventos",
      configurado: estado.dashboardWebhookUrl !== null,
      obrigatorioPara: "Cliente cadastrado AQUI aparecer lá (a via de volta)",
      ajuda: "https://<dashboard>/api/webhooks/incoming/scopefinance",
    },
    {
      chave: "SCOPE_DASHBOARD_WEBHOOK_SECRET",
      rotulo: "Segredo com que assinamos o que mandamos",
      configurado: estado.dashboardWebhookSecret !== null,
      obrigatorioPara: "A Dashboard aceitar os nossos eventos",
      ajuda: "O mesmo valor cadastrado lá na conexão de entrada de origem 'scopefinance'.",
    },
    {
      chave: "SCOPE_DASHBOARD_API_BASE",
      rotulo: "API pública da Dashboard",
      configurado: estado.dashboardBase !== null,
      obrigatorioPara: "Reconciliação — buscar o cadastro mestre e fechar buracos",
      ajuda: "https://<dashboard>/api/v1",
    },
    {
      chave: "SCOPE_DASHBOARD_API_KEY_OUT",
      rotulo: "Chave de API que apresentamos à Dashboard",
      configurado: estado.dashboardApiKey !== null,
      obrigatorioPara: "Reconciliação (escopo clientes:read)",
      ajuda: "Gerada na Dashboard em Administração → Chaves de API.",
    },
  ];
}

/** Resumo de uma frase para o topo da tela e para `/api/integracao/saude`. */
export function veredito(itens: ItemDiagnostico[]): {
  pronta: boolean;
  faltando: string[];
  entrada: boolean;
  saida: boolean;
} {
  const falta = (c: string) => !itens.find((i) => i.chave === c)?.configurado;
  const faltando = itens.filter((i) => !i.configurado).map((i) => i.chave);
  return {
    pronta: faltando.length === 0,
    faltando,
    // As duas direções são independentes: dá para receber sem mandar.
    entrada: !falta("SCOPE_DASHBOARD_API_KEY") && !falta("SCOPE_WEBHOOK_SECRET"),
    saida: !falta("SCOPE_DASHBOARD_WEBHOOK_URL") && !falta("SCOPE_DASHBOARD_WEBHOOK_SECRET"),
  };
}

/**
 * O pedaço de uma resposta do PostgREST que interessa a quem está depurando.
 *
 * Tipo próprio, e não o `PostgrestResponse` do supabase-js, porque a sonda
 * precisa aceitar **qualquer** forma que a biblioteca produza — inclusive a
 * degenerada descrita abaixo, em que `message` vem string vazia e
 * `code`/`details`/`hint` nem existem.
 */
export interface RespostaDeSonda {
  error: {
    message?: string | null;
    code?: string | null;
    details?: string | null;
    hint?: string | null;
  } | null;
  status?: number;
  statusText?: string;
}

/**
 * Descreve a falha de uma sonda, ou `null` se ela passou.
 *
 * ⚖️ **Por que existe — e por que só `error.message` não bastava.** Em
 * 26/08/2026 a versão anterior desta rota passou a expor o erro de cada
 * sonda; na primeira chamada seguinte, a de `integracao_enviados` falhou e o
 * relatório saiu **`"integracao_enviados: "`** — nome, dois pontos, nada.
 * Um endpoint de saúde que anuncia a falha sem dizer qual não é melhor do
 * que um que a esconde.
 *
 * A causa é estrutural, e está no `@supabase/postgrest-js` (2.108.2,
 * `processResponse`): resposta não-ok tem o corpo lido e passado por
 * `JSON.parse`; se ele estourar, o erro vira `{ message: corpo }`. As sondas
 * usam `head: true`, ou seja **HTTP HEAD — que por protocolo nunca tem
 * corpo**. Logo, para toda resposta de erro numa sonda de contagem, o corpo é
 * `""`, o `JSON.parse` estoura e a mensagem nasce vazia. Não é um caso raro:
 * é o único caso possível.
 *
 * O que sobra de informação nesse cenário é o **status HTTP**, e é por isso
 * que ele entra aqui. `HTTP 503 Service Unavailable` responde a pergunta que
 * `""` deixava aberta.
 */
export function descreverFalha(tabela: string, r: RespostaDeSonda): string | null {
  if (!r.error) return null;
  const partes = [r.error.message, r.error.code, r.error.hint]
    .map((p) => (p ?? "").trim())
    .filter((p) => p !== "");
  // `status: 0` é o que o postgrest-js devolve quando o `fetch` nem saiu —
  // não é status HTTP nenhum, e imprimir "HTTP 0" enganaria.
  const http = r.status ? `HTTP ${r.status}${r.statusText ? ` ${r.statusText}` : ""}` : null;
  const dito = [partes.join(" · ") || null, http].filter(Boolean).join(" · ");
  return `${tabela}: ${dito || "falhou sem mensagem, sem código e sem status"}`;
}

/** Uma contagem do banco: o que a sonda mede, mais o que ela reporta se falhar. */
export type Contagem = RespostaDeSonda & { count: number | null };

export interface Alvo {
  nome: string;
  contar: () => PromiseLike<Contagem>;
}

export interface Medida {
  nome: string;
  contagem: number | null;
  /** Descrição da falha que sobreviveu à segunda tentativa, ou `null`. */
  erro: string | null;
  /** Falha da primeira tentativa que a segunda desmentiu, ou `null`. */
  instavel: string | null;
}

/**
 * Conta uma tabela — **e tenta de novo uma vez** se a primeira falhar.
 *
 * ⚖️ **Por que a segunda tentativa existe.** O sintoma que originou tudo isto
 * é de partida a frio: na primeira chamada depois de um deploy (ou de um
 * tempo ocioso), uma das três sondas volta erro e as outras duas voltam
 * número; a chamada seguinte, segundos depois, passa inteira. Sem retentativa,
 * `alcancavel` sai `false` para um banco que está perfeitamente de pé, e o
 * endpoint que existe para dar confiança vira fonte de alarme falso.
 *
 * ⛔ **Retentar não é esconder.** Quando a segunda passa, a falha da primeira
 * NÃO é descartada: ela sai no campo `instavel` da resposta. `alcancavel`
 * responde "o banco respondeu?"; `instavel` responde "de primeira?". Um
 * endpoint de saúde que apagasse o blip estaria mentindo por omissão — que é
 * exatamente o defeito que esta rota já corrigiu uma vez.
 */
export async function sondar(alvo: Alvo): Promise<Medida> {
  const primeira = await alvo.contar();
  const falha = descreverFalha(alvo.nome, primeira);
  if (!falha) {
    return { nome: alvo.nome, contagem: primeira.count ?? null, erro: null, instavel: null };
  }

  const segunda = await alvo.contar();
  const falhaDaSegunda = descreverFalha(alvo.nome, segunda);
  return {
    nome: alvo.nome,
    contagem: segunda.count ?? null,
    erro: falhaDaSegunda,
    instavel: falhaDaSegunda ? null : falha,
  };
}
