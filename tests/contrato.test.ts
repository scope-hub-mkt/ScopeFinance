import { describe, expect, it } from "vitest";
import {
  baseLiquida,
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
    expect(p.fonte).toBe("scopefinance");
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
    expect(calcularResumo([], [], 0, hoje).fonte).toBe("scopefinance");
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
      })
    ).toEqual({
      cliente_id: "abc",
      nome: "Acme",
      doc: "123",
      email: null,
      tel: null,
      status: "Ativo",
    });
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
});
