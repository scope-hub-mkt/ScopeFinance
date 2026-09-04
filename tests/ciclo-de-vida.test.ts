import { describe, it, expect } from "vitest";
import { descreverDuracao, descreverCiclo, descreverTermino } from "@/lib/ciclo-de-vida";

/**
 * `RF-105` — o serviço se descreve no tempo com o rótulo, não só com o número.
 *
 * ⛔ O defeito relatado pelo dono em 04/09/2026: a tela dizia
 * `recorrente · 51 dias`, e "51 dias" pode ser ciclo, tempo restante, prazo
 * de entrega ou tempo decorrido. Quatro leituras, quatro decisões diferentes.
 */

describe("descreverDuracao — escala de leitura", () => {
  it("conta em dias enquanto uma pessoa ainda conta em dias", () => {
    expect(descreverDuracao(0)).toBe("hoje");
    expect(descreverDuracao(1)).toBe("1 dia");
    expect(descreverDuracao(12)).toBe("12 dias");
    expect(descreverDuracao(44)).toBe("44 dias");
  });

  it("vira meses quando dias deixam de ser legíveis", () => {
    expect(descreverDuracao(45)).toBe("1 mês");
    expect(descreverDuracao(51)).toBe("2 meses");
    expect(descreverDuracao(180)).toBe("6 meses");
  });

  it("vira anos depois de dois anos, com o resto em meses", () => {
    expect(descreverDuracao(730)).toBe("2 anos");
    expect(descreverDuracao(800)).toBe("2 anos e 2 meses");
    expect(descreverDuracao(1096)).toBe("3 anos");
  });

  it("recusa entrada impossível em vez de inventar", () => {
    // ⚖️ Um número negativo aqui só chega por data invertida. Devolver
    // "-3 dias" espalharia o defeito para a tela; nomeá-lo o mantém visível.
    expect(descreverDuracao(-3)).toBe("período indefinido");
    expect(descreverDuracao(NaN)).toBe("período indefinido");
  });
});

describe("descreverCiclo — o rótulo que faltava", () => {
  it("recorrente em curso diz há quanto tempo está ativo", () => {
    expect(
      descreverCiclo({ recorrente: true, encerrado: false, dias: 51, temFim: false })
    ).toBe("recorrente · ativo há 2 meses");
  });

  it("pontual em curso diz que ainda está em andamento", () => {
    // ⚖️ A distinção importa: o recorrente É um estado que dura; o pontual é
    // trabalho que ainda não terminou.
    expect(
      descreverCiclo({ recorrente: false, encerrado: false, dias: 12, temFim: false })
    ).toBe("pontual · em andamento há 12 dias");
  });

  it("encerrado fala no passado", () => {
    expect(
      descreverCiclo({ recorrente: true, encerrado: true, dias: 240, temFim: true })
    ).toBe("recorrente · durou 8 meses");
    expect(
      descreverCiclo({ recorrente: false, encerrado: true, dias: 3, temFim: true })
    ).toBe("pontual · durou 3 dias");
  });

  it("sem data de início NÃO inventa duração", () => {
    // ⛔ "0 dias" afirmaria um começo que ninguém registrou.
    expect(
      descreverCiclo({ recorrente: true, encerrado: false, dias: null, temFim: false })
    ).toBe("recorrente · sem data de início");
  });

  it("nunca devolve número solto — sempre com o que ele significa", () => {
    const casos = [
      { recorrente: true, encerrado: false, dias: 51, temFim: false },
      { recorrente: false, encerrado: false, dias: 51, temFim: false },
      { recorrente: true, encerrado: true, dias: 51, temFim: true },
    ];
    for (const c of casos) {
      const frase = descreverCiclo(c);
      expect(frase).toMatch(/ativo há|em andamento há|durou|sem data/);
    }
  });
});

describe("descreverTermino — quando a falta de fim é lacuna", () => {
  it("recorrente sem fim é desenho, não lacuna", () => {
    const t = descreverTermino({ recorrente: true, encerrado: false, dias: 51, temFim: false });
    expect(t.texto).toBe("sem fim previsto");
    expect(t.lacuna).toBe(false);
  });

  it("pontual em andamento sem prazo É lacuna, e a tela precisa mostrar", () => {
    // ⚖️ Trabalho aberto sem prazo não está errado — mas é o tipo de coisa
    // que ninguém decidiu, só deixou acontecer.
    const t = descreverTermino({ recorrente: false, encerrado: false, dias: 51, temFim: false });
    expect(t.texto).toBe("sem prazo definido");
    expect(t.lacuna).toBe(true);
    expect(t.explicacao).toContain("confirmar com o cliente");
  });

  it("encerrado sem data de fim é lacuna de cadastro", () => {
    const t = descreverTermino({ recorrente: false, encerrado: true, dias: 10, temFim: false });
    expect(t.texto).toBe("encerrado sem data");
    expect(t.lacuna).toBe(true);
  });

  it("com data de fim, a tela mostra a data e este módulo se cala", () => {
    const t = descreverTermino({ recorrente: false, encerrado: true, dias: 10, temFim: true });
    expect(t.texto).toBe("");
    expect(t.lacuna).toBe(false);
  });
});
