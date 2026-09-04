import { describe, expect, it } from "vitest";
import {
  baseLiquida,
  servicosContratadosParaContrato,
  rotuloDoContrato,
  type LinhaAssinaturaContratada,
  type LinhaContrato,
  type LinhaContratoServico,
  calcularMrr,
  calcularResumo,
  calcularSerie,
  clienteParaContrato,
  fimDoMes,
  interpretarEvento,
  normalizarDoc,
  pagamentosDeReceber,
  periodosAte,
  valorRecebido,
  type LinhaReceber,
  FONTE,
} from "@/lib/integracao/contrato";

/**
 * O contrato com a Scope Dashboard, exercitado sem banco e sem rede.
 *
 * Cada bloco aqui responde a uma frase de documento do outro lado — `RN-01`,
 * `RN-04`, `RN-06`, `RNF-20`. Se algum destes testes ficar vermelho, o número
 * que a Dashboard mostra ao dono muda de significado sem ninguém pedir.
 */

function conta(p: Partial<LinhaReceber> = {}): LinhaReceber {
  return {
    id: "cr-1",
    cliente_id: "cli-1",
    contrato_id: null,
    valor: 1000,
    valor_pago: null,
    deducoes: 0,
    vencimento: "2026-08-10",
    status: "Pendente",
    pago_em: null,
    ...p,
  };
}

describe("valorRecebido / baseLiquida — RN-04 (a base da comissão é líquida)", () => {
  it("sem valor_pago informado, vale o valor cobrado", () => {
    expect(valorRecebido(conta({ valor: 1000, valor_pago: null }))).toBe(1000);
  });

  it("com valor_pago informado, ele manda — inclusive quando é menor", () => {
    expect(valorRecebido(conta({ valor: 1000, valor_pago: 940 }))).toBe(940);
  });

  it("valor_pago igual a zero NÃO cai no fallback do valor cobrado", () => {
    // O bug clássico do `||`: 0 é falsy e viraria 1000 — comissão sobre
    // dinheiro que não entrou. O código usa `== null` justamente por isto.
    expect(valorRecebido(conta({ valor: 1000, valor_pago: 0 }))).toBe(0);
  });

  it("deduções saem da base", () => {
    expect(baseLiquida(conta({ valor: 1000, valor_pago: 1000, deducoes: 60 }))).toBe(940);
  });

  it("numérico vindo como string do Postgres não vira NaN", () => {
    // O driver devolve `numeric` como string. Somar string quebraria calado.
    expect(baseLiquida(conta({ valor: "1000", valor_pago: "900.50", deducoes: "54.03" }))).toBeCloseTo(
      846.47,
      2
    );
  });
});

describe("pagamentosDeReceber — RN-06 (só o que entrou vira comissão)", () => {
  it("ignora conta pendente, vencida e cancelada", () => {
    const r = pagamentosDeReceber([
      conta({ id: "a", status: "Pendente" }),
      conta({ id: "b", status: "Vencido" }),
      conta({ id: "c", status: "Cancelado" }),
      conta({ id: "d", status: "Pago", pago_em: "2026-08-20" }),
    ]);
    expect(r.map((p) => p.referencia)).toEqual(["d"]);
  });

  it("descarta pagamento sem cliente — comissão sem dono não existe", () => {
    const r = pagamentosDeReceber([
      conta({ id: "orfa", status: "Pago", pago_em: "2026-08-20", cliente_id: null }),
    ]);
    expect(r).toEqual([]);
  });

  it("descarta pagamento marcado Pago sem data de baixa", () => {
    const r = pagamentosDeReceber([conta({ status: "Pago", pago_em: null })]);
    expect(r).toEqual([]);
  });

  it("declara a fonte em cada linha — RNF-19", () => {
    const [p] = pagamentosDeReceber([conta({ status: "Pago", pago_em: "2026-08-20" })]);
    expect(p.fonte).toBe(FONTE);
    // ♻️ 03/09/2026: a fonte deixou de ser so o mensageiro. O valor
    // declara agora a ORIGEM do fato (`D-99`), e a asserçao passou a
    // usar a constante — congelar o texto aqui obrigaria a editar o
    // teste a cada refinamento da declaraçao, sem provar nada a mais.
    expect(p.fonte).toContain("asaas");
  });

  it("leva deduções junto, para a Dashboard não precisar adivinhar imposto", () => {
    const [p] = pagamentosDeReceber([
      conta({ status: "Pago", pago_em: "2026-08-20", valor_pago: 1000, deducoes: 60 }),
    ]);
    expect(p).toMatchObject({ valor_bruto: 1000, deducoes: 60 });
  });
});

describe("calcularMrr", () => {
  it("normaliza ciclo anual e trimestral para base mensal", () => {
    expect(
      calcularMrr([
        { valor: 1200, ciclo: "anual", status: "Ativa" },
        { valor: 300, ciclo: "trimestral", status: "Ativa" },
        { valor: 500, ciclo: "mensal", status: "Ativa" },
      ])
    ).toBe(100 + 100 + 500);
  });

  it("assinatura suspensa ou cancelada não conta", () => {
    expect(
      calcularMrr([
        { valor: 500, ciclo: "mensal", status: "Suspensa" },
        { valor: 500, ciclo: "mensal", status: "Cancelada" },
      ])
    ).toBe(0);
  });
});

describe("calcularResumo — RF-01 do painel da Dashboard", () => {
  const hoje = "2026-08-25";

  it("faturamento conta o mês inteiro, não só até hoje", () => {
    const r = calcularResumo(
      [conta({ vencimento: "2026-08-31", valor: 700 }), conta({ vencimento: "2026-09-01", valor: 900 })],
      [],
      0,
      hoje
    );
    // 31/08 entra (é do mês); 01/09 não. Um teto errado silenciaria a última
    // semana de faturamento do mês inteiro.
    expect(r.faturamento_mes).toBe(700);
  });

  it("fevereiro não vaza para março — o teto é o último dia real do mês", () => {
    const r = calcularResumo([conta({ vencimento: "2026-02-28", valor: 500 })], [], 0, "2026-02-10");
    expect(r.faturamento_mes).toBe(500);
  });

  it("cancelada NÃO é inadimplência", () => {
    const r = calcularResumo(
      [
        conta({ vencimento: "2026-07-01", status: "Cancelado", valor: 5000 }),
        conta({ vencimento: "2026-07-01", status: "Vencido", valor: 300 }),
      ],
      [],
      0,
      hoje
    );
    expect(r.inadimplencia).toBe(300);
  });

  it("recebido usa o valor que entrou, não o cobrado", () => {
    const r = calcularResumo(
      [conta({ status: "Pago", pago_em: "2026-08-12", valor: 1000, valor_pago: 940 })],
      [],
      0,
      hoje
    );
    expect(r.recebido_mes).toBe(940);
  });

  it("declara a fonte — RNF-19", () => {
    expect(calcularResumo([], [], 0, hoje).fonte).toBe(FONTE);
    expect(calcularResumo([], [], 0, hoje).fonte).toContain("asaas");
  });
});

describe("periodosAte / calcularSerie", () => {
  it("devolve a janela terminando no mês de hoje, do mais antigo ao atual", () => {
    expect(periodosAte("2026-08-25", 4)).toEqual(["2026-05", "2026-06", "2026-07", "2026-08"]);
  });

  it("atravessa a virada de ano sem pular mês", () => {
    expect(periodosAte("2026-02-10", 4)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });

  it("mês sem movimento vem com zero, não some — RNF-20", () => {
    // A Dashboard distingue "mês sem faturamento" (ponto em zero) de "sem
    // dado" (série vazia). Omitir o mês vazio apagaria a diferença lá.
    const s = calcularSerie([conta({ vencimento: "2026-08-05", valor: 400 })], "2026-08-25", 3);
    expect(s).toEqual([
      { periodo: "2026-06", faturamento: 0, recebido: 0 },
      { periodo: "2026-07", faturamento: 0, recebido: 0 },
      { periodo: "2026-08", faturamento: 400, recebido: 0 },
    ]);
  });

  it("conta paga em mês diferente do vencimento entra nos dois meses certos", () => {
    const s = calcularSerie(
      [conta({ vencimento: "2026-07-10", valor: 800, status: "Pago", pago_em: "2026-08-03" })],
      "2026-08-25",
      2
    );
    expect(s).toEqual([
      { periodo: "2026-07", faturamento: 800, recebido: 0 },
      { periodo: "2026-08", faturamento: 0, recebido: 800 },
    ]);
  });

  it("fora da janela não entra", () => {
    const s = calcularSerie([conta({ vencimento: "2025-01-10", valor: 999 })], "2026-08-25", 3);
    expect(s.every((p) => p.faturamento === 0)).toBe(true);
  });
});

describe("fimDoMes", () => {
  it.each([
    ["2026-02-05", "2026-02-28"],
    ["2024-02-05", "2024-02-29"],
    ["2026-04-30", "2026-04-30"],
    ["2026-12-01", "2026-12-31"],
  ])("%s → %s", (entrada, esperado) => {
    expect(fimDoMes(entrada)).toBe(esperado);
  });
});

describe("clienteParaContrato", () => {
  it("renomeia id para cliente_id — o nome que a Dashboard espera", () => {
    expect(
      clienteParaContrato({
        id: "abc",
        nome: "Acme",
        doc: "123",
        email: null,
        tel: null,
        status: "Ativo",
        primeiro_vencimento: "2024-12-05",
        status_cadastro: "efetivo",
      })
    ).toEqual({
      cliente_id: "abc",
      nome: "Acme",
      doc: "123",
      email: null,
      tel: null,
      status: "Ativo",
      cliente_desde: "2024-12-05",
      status_cadastro: "efetivo",
    });
  });

  /**
   * `D-107` — a data de início da relação sai da primeira cobrança, e o
   * silêncio dela precisa ser silêncio, não uma data plausível.
   */
  it("⛔ cliente sem cobrança nenhuma devolve null, nunca uma data inventada", () => {
    const r = clienteParaContrato({
      id: "abc",
      nome: "Acme",
      doc: null,
      email: null,
      tel: null,
      status: "Ativo",
    });
    // Cliente cadastrado e ainda não faturado existe. Preencher `cliente_desde`
    // com hoje faria a Dashboard afirmar que a relação começou agora.
    expect(r.cliente_desde).toBeNull();
  });

  /**
   * `D-108` — a divergência 11 × 10 do painel da Dashboard tinha uma causa, e
   * era esta: `status_cadastro` não atravessava a ponte.
   */
  it("⛔ carrega `status_cadastro` — sem ele a Dashboard conta provisório como ativo", () => {
    const r = clienteParaContrato({
      id: "abc",
      nome: "Sem documento",
      doc: null,
      email: null,
      tel: null,
      // Cadastro provisório nasce 'Ativo' por default do schema: quem olha só
      // `status` conta como ativo alguém de quem não se sabe nem o documento.
      status: "Ativo",
      status_cadastro: "provisorio",
    });
    expect(r.status).toBe("Ativo");
    expect(r.status_cadastro).toBe("provisorio");
  });

  it("corta hora e fuso — a Dashboard grava isto numa coluna `date`", () => {
    const r = clienteParaContrato({
      id: "abc",
      nome: "Acme",
      doc: null,
      email: null,
      tel: null,
      status: "Ativo",
      primeiro_vencimento: "2024-12-05T03:00:00.000Z",
    });
    expect(r.cliente_desde).toBe("2024-12-05");
  });
});

describe("normalizarDoc", () => {
  it.each([
    ["12.345.678/0001-90", "12345678000190"],
    ["12345678000190", "12345678000190"],
    ["", null],
    [null, null],
    ["   ", null],
  ])("%s → %s", (entrada, esperado) => {
    expect(normalizarDoc(entrada as string | null)).toBe(esperado);
  });
});

describe("interpretarEvento — os DOIS formatos de cliente.criado da Dashboard", () => {
  const env = (evento: string, dados: Record<string, unknown>) => ({
    evento,
    id: "evt_1",
    criado_em: "2026-08-25T10:00:00Z",
    dados,
  });

  it("formato do CRUD/importação vira criação de cliente", () => {
    const r = interpretarEvento(
      env("cliente.criado", { cliente_id: "c1", nome: "Acme LTDA", doc: "12.345.678/0001-90" })
    );
    expect(r.acao).toBe("criar");
    if (r.acao === "criar") {
      expect(r.cliente).toMatchObject({
        id: "c1",
        nome: "Acme LTDA",
        tipo: "Pessoa Jurídica",
        origem: "dashboard",
      });
    }
  });

  it("formato de perfil comercial (sem nome) é IGNORADO com motivo", () => {
    // Medido em 25/08/2026: a Dashboard emite `cliente.criado` com
    // `{cliente_id, setor, porte, status}` ao criar perfil comercial. Criar
    // um cliente sem nome a partir disso seria pior que ignorar.
    const r = interpretarEvento(
      env("cliente.criado", { cliente_id: "c1", setor: "varejo", porte: "PME", status: "ativo" })
    );
    expect(r.acao).toBe("ignorar");
    if (r.acao === "ignorar") expect(r.motivo).toContain("perfil comercial");
  });

  it("CPF de 11 dígitos vira Pessoa Física", () => {
    const r = interpretarEvento(
      env("cliente.criado", { cliente_id: "c1", nome: "João", doc: "123.456.789-00" })
    );
    if (r.acao === "criar") expect(r.cliente.tipo).toBe("Pessoa Física");
  });

  it("evento sem efeito financeiro é ignorado com motivo declarado", () => {
    const r = interpretarEvento(env("card.movido", { card_id: "x" }));
    expect(r.acao).toBe("ignorar");
    if (r.acao === "ignorar") expect(r.motivo).toContain("card.movido");
  });

  it("evento sem cliente_id é ignorado", () => {
    const r = interpretarEvento(env("cliente.criado", { nome: "Sem id" }));
    expect(r.acao).toBe("ignorar");
  });

  it("cliente.atualizado vira atualização, não criação", () => {
    const r = interpretarEvento(env("cliente.atualizado", { cliente_id: "c1", nome: "Novo nome" }));
    expect(r.acao).toBe("atualizar");
  });

  // ── `status`: o campo que a Dashboard não tem, e que por isso não pode
  // chegar de lá como "Ativo". Achado em 26/08/2026 lendo a emissão dela
  // (`lib/dominio/clientes.ts`): o payload manda cliente_id, nome, doc,
  // email, tel e fonte — status, nunca.
  it("payload sem status NÃO carrega status nenhum — a chave nem existe", () => {
    const r = interpretarEvento(env("cliente.atualizado", { cliente_id: "c1", nome: "Novo nome" }));
    if (r.acao === "atualizar") {
      // `toMatchObject` não pegaria isto: a ausência da chave é o teste.
      expect(Object.keys(r.cliente)).not.toContain("status");
    }
  });

  it("editar o nome na Dashboard não ressuscita cliente inativado aqui", () => {
    // O defeito: `status: … : "Ativo"` fixo fazia o upsert reescrever a coluna
    // a cada edição. Um cliente marcado Inativo daqui voltava a Ativo — e a
    // contagem do `/resumo` mudava sem ninguém pedir.
    const r = interpretarEvento(env("cliente.atualizado", { cliente_id: "c1", nome: "Nome corrigido" }));
    if (r.acao === "atualizar") expect(r.cliente.status).toBeUndefined();
  });

  it("status que VEM no payload é respeitado — quem manda continua mandando", () => {
    const r = interpretarEvento(
      env("cliente.atualizado", { cliente_id: "c1", nome: "Acme", status: "Inativo" })
    );
    if (r.acao === "atualizar") expect(r.cliente.status).toBe("Inativo");
  });

  it("na criação, a ausência de status cai no default do schema, não em null", () => {
    // `clientes.status` é `not null default 'Ativo'`: omitir a coluna no
    // insert dá Ativo. Mandar `null` explodiria a constraint.
    const r = interpretarEvento(env("cliente.criado", { cliente_id: "c1", nome: "Acme" }));
    if (r.acao === "criar") expect(Object.keys(r.cliente)).not.toContain("status");
  });
});

describe("servicosContratadosParaContrato — a perna que faltava na ponte", () => {
  const contrato = (over: Partial<LinhaContrato> = {}): LinhaContrato => ({
    id: "c1",
    cliente_id: "cli-1",
    servico: "WebDesign - Manutenção Recorrente",
    valor: 850,
    freq: "Mensal",
    categoria: "WebDesign",
    inicio: "2026-01-01",
    fim: null,
    status: "Ativo",
    ...over,
  });

  const assinatura = (
    over: Partial<LinhaAssinaturaContratada> = {}
  ): LinhaAssinaturaContratada => ({
    id: "a1",
    direcao: "receber",
    cliente_id: "cli-2",
    descricao: "Assinatura Plano PRO - CRM Scope System",
    plano: "Pro",
    valor: 399,
    ciclo: "mensal",
    inicio: "2026-02-01",
    fim: null,
    status: "Ativa",
    ...over,
  });

  const item = (over: Partial<LinhaContratoServico> = {}): LinhaContratoServico => ({
    id: "i1",
    contrato_id: "c1",
    servico_id: null,
    descricao: "WebDesign - Manutenção Recorrente",
    quantidade: 1,
    valor: 850,
    recorrencia: null,
    ...over,
  });

  it("achata contrato e assinatura no mesmo formato, com a fonte declarada", () => {
    const r = servicosContratadosParaContrato([contrato()], [assinatura()], [item()]);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({
      // ♻️ A referência é do ITEM desde 31/08/2026 — era do contrato. Com N
      // itens por contrato, a referência do contrato chegaria repetida, e a
      // reconciliação do outro lado não teria como distinguir um serviço do
      // outro.
      referencia: "i1",
      origem: "contrato",
      cliente_id: "cli-1",
      contrato_id: "c1",
      rotulo: "WebDesign - Manutenção Recorrente",
      valor: 850,
      // Item sem recorrência própria herda a do contrato.
      recorrencia: "Mensal",
      ativo: true,
      fonte: FONTE,
    });
    expect(r[1]).toMatchObject({
      referencia: "a1",
      origem: "assinatura",
      rotulo: "Assinatura Plano PRO - CRM Scope System",
      plano: "Pro",
      valor: 399,
      ativo: true,
    });
  });

  it("exclui assinatura `pagar` — é a Scope assinando ferramenta, não cliente", () => {
    const r = servicosContratadosParaContrato(
      [],
      [assinatura({ direcao: "pagar", cliente_id: null, descricao: "Figma Org" })]
    );
    expect(r).toEqual([]);
  });

  it("descarta linha sem cliente e item sem descrição — não há o que vincular", () => {
    const r = servicosContratadosParaContrato(
      [contrato({ cliente_id: null }), contrato({ id: "c2" })],
      [assinatura({ id: "a2", descricao: null, plano: null })],
      [item(), item({ id: "i2", contrato_id: "c2", descricao: "   " })]
    );
    expect(r).toEqual([]);
  });

  it("cai para `plano` quando a assinatura não tem descrição", () => {
    const r = servicosContratadosParaContrato([], [assinatura({ descricao: null })]);
    expect(r[0].rotulo).toBe("Pro");
  });

  it("`Pausado` atravessa com ativo=false — suspenso não é upsell, e some é pior", () => {
    const r = servicosContratadosParaContrato(
      [contrato({ status: "Pausado" })],
      [assinatura({ status: "Cancelada" })],
      [item()]
    );
    expect(r.map((l) => l.ativo)).toEqual([false, false]);
    expect(r).toHaveLength(2);
  });

  it("arredonda o valor em centavos — 0.1+0.2 não é 0.3, e o resíduo atravessa a ponte", () => {
    const r = servicosContratadosParaContrato([contrato()], [], [item({ valor: "1700.005" })]);
    expect(r[0].valor).toBe(1700.01);
  });

  it("valor ausente vira null, nunca zero — zero afirmaria que é de graça", () => {
    const r = servicosContratadosParaContrato([contrato()], [], [item({ valor: null })]);
    expect(r[0].valor).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════
//  A ligação 1:N — decisão do dono, 31/08/2026
//
//  *"um contrato pode ter N serviços e um serviço deve possuir um contrato"*.
//
//  O que estes testes protegem é a metade que não aparece na tela: o formato
//  que ATRAVESSA a ponte. Um contrato de dois serviços que chega do outro lado
//  como um só não levanta erro nenhum — some um serviço, e o relatório de lá
//  fica silenciosamente menor.
// ════════════════════════════════════════════════════════════════════
describe("contrato 1:N — um contrato, N serviços atravessando a ponte", () => {
  const contrato = (over: Partial<LinhaContrato> = {}): LinhaContrato => ({
    id: "c1",
    cliente_id: "cli-1",
    servico: "Landing Page + Automação",
    valor: 5000,
    freq: "Mensal",
    categoria: "WebDesign",
    inicio: "2026-03-01",
    fim: null,
    status: "Ativo",
    ...over,
  });

  const item = (over: Partial<LinhaContratoServico> = {}): LinhaContratoServico => ({
    id: "i1",
    contrato_id: "c1",
    servico_id: null,
    descricao: "Landing Page",
    quantidade: 1,
    valor: 2000,
    recorrencia: null,
    ...over,
  });

  it("um contrato com dois serviços vira DUAS linhas, não uma", () => {
    const r = servicosContratadosParaContrato(
      [contrato()],
      [],
      [item(), item({ id: "i2", descricao: "Automação", valor: 3000 })]
    );
    expect(r).toHaveLength(2);
    expect(r.map((l) => l.rotulo)).toEqual(["Landing Page", "Automação"]);
    // Cada linha tem a SUA referência: é o que impede a reconciliação do outro
    // lado de tratar as duas como o mesmo compromisso.
    expect(new Set(r.map((l) => l.referencia)).size).toBe(2);
  });

  it("cada linha carrega o contrato de origem — a metade 'serviço tem contrato'", () => {
    const r = servicosContratadosParaContrato([contrato()], [], [item()]);
    expect(r[0].contrato_id).toBe("c1");
    expect(r[0].contrato_rotulo).toBe("Landing Page + Automação (2026)");
  });

  it("assinatura vem sem contrato — ela não está dentro de um, ela É o compromisso", () => {
    const r = servicosContratadosParaContrato(
      [],
      [
        {
          id: "a1",
          direcao: "receber",
          cliente_id: "cli-2",
          descricao: "Assinatura do CRM",
          plano: "Pro",
          valor: 399,
          ciclo: "mensal",
          inicio: "2026-02-01",
          fim: null,
          status: "Ativa",
        },
      ]
    );
    expect(r[0].contrato_id).toBeNull();
    expect(r[0].contrato_rotulo).toBeNull();
  });

  it("contrato SEM item não emite linha — não há serviço para declarar", () => {
    // E é o certo: sumir da ponte significa que a reconciliação do outro lado
    // o encerra, com motivo. Um contrato sem serviços é, comercialmente, isso.
    const r = servicosContratadosParaContrato([contrato()], [], []);
    expect(r).toEqual([]);
  });

  it("leva o servico_id quando quem vendeu já escolheu o item do catálogo", () => {
    // É o que dispensa o palpite por substring do outro lado.
    const r = servicosContratadosParaContrato(
      [contrato()],
      [],
      [item({ servico_id: "cat-landing" })]
    );
    expect(r[0].servico_id).toBe("cat-landing");
  });

  it("sem vínculo de catálogo, servico_id é null e o rótulo segue valendo", () => {
    const r = servicosContratadosParaContrato([contrato()], [], [item()]);
    expect(r[0].servico_id).toBeNull();
    expect(r[0].rotulo).toBe("Landing Page");
  });

  it("quantidade multiplica o valor do item — 3 × 500 são 1500, não 500", () => {
    const r = servicosContratadosParaContrato(
      [contrato()],
      [],
      [item({ quantidade: 3, valor: 500 })]
    );
    expect(r[0].valor).toBe(1500);
  });

  it("manda o valor do ITEM, nunca o do contrato — senão dois itens viram o dobro", () => {
    const r = servicosContratadosParaContrato(
      [contrato({ valor: 5000 })],
      [],
      [item({ valor: 2000 }), item({ id: "i2", descricao: "Automação", valor: 3000 })]
    );
    expect(r.map((l) => l.valor)).toEqual([2000, 3000]);
    expect(r.reduce((s, l) => s + (l.valor ?? 0), 0)).toBe(5000);
  });

  it("item com recorrência própria não herda a do contrato", () => {
    const r = servicosContratadosParaContrato(
      [contrato({ freq: "Mensal" })],
      [],
      [item({ recorrencia: "Único" }), item({ id: "i2", descricao: "Manutenção" })]
    );
    expect(r.map((l) => l.recorrencia)).toEqual(["Único", "Mensal"]);
  });

  it("item de contrato que não está na lista é ignorado — não inventa dono", () => {
    const r = servicosContratadosParaContrato(
      [contrato()],
      [],
      [item(), item({ id: "i9", contrato_id: "c-fantasma", descricao: "Órfão" })]
    );
    expect(r).toHaveLength(1);
    expect(r[0].rotulo).toBe("Landing Page");
  });
});

describe("rotuloDoContrato — como a Dashboard reconhece um contrato sem espelhá-lo", () => {
  it("junta o resumo dos serviços com o ano de início", () => {
    expect(rotuloDoContrato({ servico: "Landing Page + Automação", inicio: "2026-03-01" })).toBe(
      "Landing Page + Automação (2026)"
    );
  });

  it("sem início, fica só o resumo — não inventa ano", () => {
    expect(rotuloDoContrato({ servico: "Landing Page", inicio: null })).toBe("Landing Page");
  });

  it("contrato que perdeu os serviços tem nome, em vez de vazio", () => {
    // Rótulo vazio na tela do outro lado seria uma linha em branco que ninguém
    // sabe clicar. Dizer o que houve é mais barato que esconder.
    expect(rotuloDoContrato({ servico: "", inicio: "2026-01-01" })).toBe(
      "Contrato sem serviços (2026)"
    );
  });
});
