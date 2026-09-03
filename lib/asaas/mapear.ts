import { asaasParaDataLocal, deducaoDoGateway, dinheiro } from "./webhook";

/**
 * A tradução de um objeto do Asaas para a linha que o ScopeFinance grava.
 *
 * ⚖️ **Por que este módulo foi separado de `processar.ts`.** O mesmo objeto
 * chega por dois caminhos — o webhook (evento a evento, em tempo real) e o
 * backfill (lendo a API, em lote). Se cada um traduzisse por conta própria,
 * seriam **duas versões da mesma verdade**, e elas divergiriam no primeiro
 * campo que alguém corrigisse num lado só. A divergência não apareceria no
 * dia em que nascesse: apareceria meses depois, num relatório em que a
 * cobrança importada e a cobrança recebida ao vivo não batem — e ninguém
 * saberia qual das duas está certa.
 *
 * É o mesmo raciocínio do §5.1 do plano sobre dois catálogos de serviço.
 *
 * Puro de propósito: nada aqui toca banco ou rede. Os vínculos que exigem
 * consulta (`cliente_id`, `assinatura_id`, `conta_receber_id`) são
 * responsabilidade de quem chama, porque só quem tem banco pode resolvê-los.
 */

// ════════════════════════════════════════════════════════════════════
//  Cobranças
// ════════════════════════════════════════════════════════════════════

/**
 * O status do Asaas traduzido para o vocabulário de `contas_receber`.
 *
 * ⚖️ **Por que traduzir em vez de gravar o do Asaas na coluna `status`.** Essa
 * coluna é lida por `lib/integracao/contrato.ts`, que calcula faturamento,
 * recebido e inadimplência com ela — e a Dashboard exibe esses números sem
 * recalcular (`RN-01`). Um valor novo ali muda silenciosamente três
 * indicadores. O status fino do Asaas fica em `asaas_status`, que ninguém soma.
 *
 * ⚠️ `REFUNDED` vira `Cancelado`, não um status novo: o cálculo de
 * inadimplência exclui `Pago` e `Cancelado`. Um estorno com vencimento passado,
 * sob qualquer outro rótulo, entraria no vermelho do painel como se fosse
 * dívida do cliente — e não é: o dinheiro voltou.
 */
export function statusDaCobranca(evento: string, statusAsaas: unknown): string | null {
  const s = typeof statusAsaas === "string" ? statusAsaas : "";

  switch (evento) {
    case "PAYMENT_RECEIVED":
      return "Pago";
    case "PAYMENT_OVERDUE":
      return "Vencido";
    case "PAYMENT_DELETED":
    case "PAYMENT_REFUNDED":
      return "Cancelado";
    case "PAYMENT_RESTORED":
    case "PAYMENT_RECEIVED_IN_CASH_UNDONE":
      return "Pendente";
    // `CONFIRMED` é dinheiro prometido, não recebido — "ainda NÃO é saldo
    // disponível", nas palavras do próprio catálogo do Asaas. Contá-lo como
    // Pago anteciparia comissão sobre dinheiro que não entrou (`RN-06`).
    case "PAYMENT_CONFIRMED":
      return "Pendente";
    case "PAYMENT_PARTIALLY_REFUNDED":
    case "PAYMENT_ANTICIPATED":
      // Não mexem no estado da conta, só no valor / na data de crédito.
      return null;
    default:
      // `PAYMENT_CREATED`, `PAYMENT_UPDATED` e o backfill carregam o status atual.
      if (s === "RECEIVED" || s === "RECEIVED_IN_CASH") return "Pago";
      if (s === "OVERDUE") return "Vencido";
      if (s === "REFUNDED" || s === "DELETED") return "Cancelado";
      return "Pendente";
  }
}

/**
 * Recebido de fato.
 *
 * ⚠️ Inclui `RECEIVED_IN_CASH` — baixa registrada fora do gateway. Medido na
 * conta de produção em 28/08/2026: **15 das 180 cobranças** estão nesse
 * estado. Tratá-las como não recebidas esconderia dinheiro que entrou.
 */
export function foiRecebido(evento: string, statusAsaas: unknown): boolean {
  if (evento === "PAYMENT_RECEIVED") return true;
  return statusAsaas === "RECEIVED" || statusAsaas === "RECEIVED_IN_CASH";
}

/**
 * A que submenu de Vendas a cobrança pertence (§8.1).
 *
 *   Assinaturas → tem `subscription`
 *   Contratos   → é parcela de um parcelamento
 *   Avulsas     → o resto
 */
export function tipoDaVenda(o: Record<string, unknown>): "assinatura" | "contrato" | "avulsa" {
  if (typeof o.subscription === "string" && o.subscription) return "assinatura";
  if (o.installment || o.installmentNumber != null) return "contrato";
  return "avulsa";
}

export interface LinhaCobranca {
  linha: Record<string, unknown>;
  /** Ids do Asaas que quem chama precisa resolver antes de gravar. */
  vinculos: { customer: string | null; subscription: string | null };
}

/**
 * O objeto `payment` do Asaas como linha de `contas_receber`.
 *
 * ⛔ **`valor_contratado` NÃO sai daqui.** Ele é o que foi combinado com o
 * cliente — dono é o ScopeFinance, e `RN-03` diz que é editável aqui.
 * Sobrescrevê-lo com o valor do gateway apagaria a edição de um humano, que é
 * exatamente o conflito que o §4.7 resolve separando os dois fatos. Quem
 * insere decide o valor inicial dele; quem atualiza não o toca.
 */
export function linhaDaCobranca(
  o: Record<string, unknown>,
  evento = "BACKFILL"
): LinhaCobranca | null {
  const asaasId = typeof o.id === "string" ? o.id : null;
  if (!asaasId) return null;

  const recebido = foiRecebido(evento, o.status);
  const vencimento = asaasParaDataLocal(o.dueDate);

  const linha: Record<string, unknown> = {
    asaas_payment_id: asaasId,
    // ⛔ **Explícito de propósito, mesmo sendo o caso óbvio** (`RF-93`,
    // `D-100`). A coluna tem default `'manual'`: linha que ninguém marcou
    // como do gateway **não é** do gateway, e é esse default que faz uma
    // falha de escrita virar recebível manual visível em vez de receita
    // fantasma no total do Asaas.
    //
    // ⚖️ E fica AQUI, na tradução pura, não em quem chama: `linhaDaCobranca`
    // é a mesma função para o webhook e para o backfill, então marcar aqui
    // cobre os dois caminhos de uma vez. Marcar em cada chamador seria pedir
    // que os dois lembrassem — e o terceiro, quando existir, não lembraria.
    origem_lancamento: "asaas",
    descricao:
      (typeof o.description === "string" && o.description.trim()) || `Cobrança Asaas ${asaasId}`,
    valor: dinheiro(o.value),
    // ⛔ Espelho do gateway — nunca editável pela tela (§4.7).
    valor_cobrado: dinheiro(o.value),
    valor_liquido: dinheiro(o.netValue),
    asaas_status: typeof o.status === "string" ? o.status : null,
    // O customer viaja na própria linha para que o religamento do §2.3 seja
    // um `update` com `where`, e não uma varredura de JSON que erra calada.
    asaas_customer_id: typeof o.customer === "string" ? o.customer : null,
    // §8.1: o submenu de Vendas vira um `where` sobre índice em vez de um
    // cálculo por linha. Classificado UMA vez, aqui, pela mesma função que o
    // webhook e o backfill usam.
    tipo_venda: tipoDaVenda(o),
    parcela_numero:
      typeof o.installmentNumber === "number" ? o.installmentNumber : null,
    parcelamento_id: typeof o.installment === "string" ? o.installment : null,
    vencimento,
    // ⚠️ A competência é o mês do VENCIMENTO, não o de hoje: é o que faz a
    // cobrança de janeiro paga em março continuar contando em janeiro.
    competencia: vencimento ? `${vencimento.slice(0, 7)}-01` : null,
    forma_pagamento: typeof o.billingType === "string" ? o.billingType : null,
  };

  const novoStatus = statusDaCobranca(evento, o.status);
  if (novoStatus) linha.status = novoStatus;

  if (recebido) {
    linha.pago_em = asaasParaDataLocal(o.paymentDate ?? o.clientPaymentDate ?? o.confirmedDate);
    linha.valor_pago = dinheiro(o.value);
    // 📐 `RN-04` da Dashboard calcula a comissão sobre `valor_pago − deducoes`.
    // Gravando a taxa do gateway aqui, a base passa a ser exatamente o
    // `netValue` — o que o §4.10 manda — sem uma linha mudar do lado de lá.
    linha.deducoes = deducaoDoGateway(o.value, o.netValue) ?? "0.00";
  } else if (evento === "PAYMENT_RECEIVED_IN_CASH_UNDONE") {
    // Desfazer a baixa é apagar os três fatos que ela criou, não só o status.
    linha.pago_em = null;
    linha.valor_pago = null;
    linha.deducoes = "0.00";
  }

  return {
    linha,
    vinculos: {
      customer: typeof o.customer === "string" ? o.customer : null,
      subscription: typeof o.subscription === "string" ? o.subscription : null,
    },
  };
}

// ════════════════════════════════════════════════════════════════════
//  Assinaturas
// ════════════════════════════════════════════════════════════════════

/**
 * O ciclo do Asaas no vocabulário de `assinaturas.ciclo`.
 *
 * ⛔ Devolve `null` para ciclo desconhecido em vez de cair em `'mensal'`. Uma
 * assinatura semestral rotulada de mensal **multiplica o MRR por seis** — e o
 * número sai errado parecendo certo, que é a falha do §4.10.
 */
export function cicloDoAsaas(cycle: unknown): string | null {
  switch (cycle) {
    case "WEEKLY":
      return "semanal";
    case "BIWEEKLY":
      return "quinzenal";
    case "MONTHLY":
      return "mensal";
    case "BIMONTHLY":
      return "bimestral";
    case "QUARTERLY":
      return "trimestral";
    case "SEMIANNUALLY":
      return "semestral";
    case "YEARLY":
      return "anual";
    default:
      return null;
  }
}

/** `Ativa | Suspensa | Cancelada` — o vocabulário que o cálculo de MRR já lê. */
export function statusDaAssinatura(evento: string, statusAsaas: unknown): string {
  if (evento === "SUBSCRIPTION_INACTIVATED" || evento === "SUBSCRIPTION_DELETED") {
    return "Cancelada";
  }
  if (statusAsaas === "INACTIVE" || statusAsaas === "EXPIRED") return "Cancelada";
  return "Ativa";
}

export interface LinhaAssinaturaAsaas {
  linha: Record<string, unknown>;
  vinculos: { customer: string | null };
  /** Ciclo que o Asaas mandou e não sabemos traduzir — vira aviso, não palpite. */
  cicloDesconhecido: string | null;
}

export function linhaDaAssinatura(
  o: Record<string, unknown>,
  evento = "BACKFILL"
): LinhaAssinaturaAsaas | null {
  const asaasId = typeof o.id === "string" ? o.id : null;
  if (!asaasId) return null;

  const ciclo = cicloDoAsaas(o.cycle);
  const linha: Record<string, unknown> = {
    asaas_subscription_id: asaasId,
    asaas_customer_id: typeof o.customer === "string" ? o.customer : null,
    direcao: "receber",
    descricao:
      (typeof o.description === "string" && o.description.trim()) || `Assinatura Asaas ${asaasId}`,
    valor: dinheiro(o.value),
    status: statusDaAssinatura(evento, o.status),
    proximo_venc: asaasParaDataLocal(o.nextDueDate),
  };
  if (ciclo) linha.ciclo = ciclo;

  return {
    linha,
    vinculos: { customer: typeof o.customer === "string" ? o.customer : null },
    cicloDesconhecido: ciclo ? null : String(o.cycle ?? "ausente"),
  };
}

// ════════════════════════════════════════════════════════════════════
//  Notas fiscais
// ════════════════════════════════════════════════════════════════════

export function statusDaNota(evento: string, statusAsaas: unknown): string {
  if (evento === "INVOICE_AUTHORIZED") return "Emitida";
  if (evento === "INVOICE_CANCELED") return "Cancelada";
  if (evento === "INVOICE_ERROR") return "Erro";
  if (statusAsaas === "AUTHORIZED") return "Emitida";
  if (statusAsaas === "CANCELED" || statusAsaas === "CANCELLED") return "Cancelada";
  if (statusAsaas === "ERROR") return "Erro";
  return "Pendente";
}

export interface LinhaNota {
  linha: Record<string, unknown>;
  vinculos: { customer: string | null; payment: string | null };
}

export function linhaDaNota(
  o: Record<string, unknown>,
  evento = "BACKFILL"
): LinhaNota | null {
  const asaasId = typeof o.id === "string" ? o.id : null;
  if (!asaasId) return null;

  const status = statusDaNota(evento, o.status);

  return {
    linha: {
      asaas_invoice_id: asaasId,
      asaas_customer_id: typeof o.customer === "string" ? o.customer : null,
      descricao_servico: typeof o.serviceDescription === "string" ? o.serviceDescription : null,
      valor: dinheiro(o.value),
      status,
      numero: typeof o.number === "string" ? o.number : null,
      data_emissao: asaasParaDataLocal(o.effectiveDate ?? o.dateCreated),
      pdf_url: typeof o.pdfUrl === "string" ? o.pdfUrl : null,
      xml_url: typeof o.xmlUrl === "string" ? o.xmlUrl : null,
      // O objeto inteiro fica na nota: quando o fiscal perguntar por que uma
      // nota saiu como saiu, a resposta é este campo, não uma reconstituição.
      payload: o,
      erro: status === "Erro" ? JSON.stringify(o.errors ?? o.status ?? "erro") : null,
    },
    vinculos: {
      customer: typeof o.customer === "string" ? o.customer : null,
      payment: typeof o.payment === "string" ? o.payment : null,
    },
  };
}

// ════════════════════════════════════════════════════════════════════
//  Clientes — a única entidade que o Asaas NÃO pode criar sozinho
// ════════════════════════════════════════════════════════════════════

/**
 * O objeto `customer` do Asaas como cadastro de cliente.
 *
 * ⛔ **Isto NÃO autoriza o Asaas a criar cliente por conta própria.** O §1.1
 * do plano é explícito: o gateway *"não pode ser origem de cliente novo sem
 * passar pela conciliação por documento"* (§2.4). Esta função só traduz; quem
 * decide entre vincular, criar e recusar é o backfill, e ele recusa por
 * escrito quando o documento já pertence a outro cadastro.
 *
 * 📐 O `customer` do Asaas tem `name`, `cpfCnpj`, `email`, `phone` e
 * `company` — encaixa no modelo pessoa **E** empresa sem tradução, o que é
 * uma confirmação de que o modelo está certo, não uma coincidência.
 */
export function clienteDoAsaas(o: Record<string, unknown>): {
  linha: Record<string, unknown>;
  documento: string | null;
  asaasId: string | null;
} {
  const asaasId = typeof o.id === "string" ? o.id : null;
  const doc = typeof o.cpfCnpj === "string" ? o.cpfCnpj.replace(/\D/g, "") : "";
  const documento = doc || null;
  const ehPj = documento?.length === 14;

  const nome = typeof o.name === "string" ? o.name.trim() : "";
  const empresa = typeof o.company === "string" ? o.company.trim() : "";

  return {
    asaasId,
    documento,
    linha: {
      nome: nome || empresa || `Cliente Asaas ${asaasId ?? "sem id"}`,
      // A trigger do banco normaliza e decide `documento_principal` e `tipo`;
      // mandar os dois campos separados é o que permite pessoa E empresa no
      // mesmo cadastro (`RF-FIN-02`).
      ...(ehPj ? { cnpj: documento } : documento ? { cpf: documento } : {}),
      ...(empresa ? { razao_social: empresa } : ehPj && nome ? { razao_social: nome } : {}),
      email: typeof o.email === "string" && o.email ? o.email : null,
      tel:
        (typeof o.mobilePhone === "string" && o.mobilePhone) ||
        (typeof o.phone === "string" && o.phone) ||
        null,
      asaas_customer_id: asaasId,
      origem: "asaas",
      // §2.3: sem documento não há identidade, e sem identidade o cadastro
      // não pode gerar cobrança nem nota. Nasce provisório, visível na fila.
      status_cadastro: documento ? "efetivo" : "provisorio",
      sincronizado_em: new Date().toISOString(),
    },
  };
}
