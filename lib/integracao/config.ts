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
