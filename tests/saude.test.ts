import { describe, expect, it } from "vitest";
import { descreverFalha, sondar, type Contagem } from "@/lib/integracao/config";

/**
 * O endpoint de saúde, exercitado sem banco e sem rede.
 *
 * ⚖️ **O que estes testes protegem.** Em 26/08/2026 a rota `/api/integracao/saude`
 * foi corrigida duas vezes no mesmo dia, e a segunda correção só existiu
 * porque a primeira produziu a linha **`"integracao_enviados: "`** contra a
 * produção — falha anunciada, motivo em branco. A causa é estrutural: sonda de
 * contagem usa `head: true`, ou seja HTTP HEAD, que por protocolo não tem
 * corpo; o `postgrest-js` monta a mensagem do erro a partir do corpo, e para
 * um HEAD ele é sempre `""`. Nenhum teste travava isso, e por isso ele
 * chegou à produção duas vezes.
 */

const resposta = (p: Partial<Contagem> = {}): Contagem => ({
  count: 0,
  error: null,
  status: 200,
  statusText: "OK",
  ...p,
});

/** O que o postgrest-js devolve quando um HEAD volta com status de erro. */
const falhaDeHead = (status: number, statusText: string): Contagem =>
  resposta({ count: null, error: { message: "" }, status, statusText });

describe("descreverFalha — o motivo nunca pode sair em branco", () => {
  it("sonda que passou não é falha nenhuma", () => {
    expect(descreverFalha("clientes", resposta({ count: 8 }))).toBeNull();
  });

  it("HEAD com erro (mensagem vazia) cai no status HTTP, não em string vazia", () => {
    // Este é O caso: era ele que produzia `"integracao_enviados: "`.
    expect(descreverFalha("integracao_enviados", falhaDeHead(503, "Service Unavailable"))).toBe(
      "integracao_enviados: HTTP 503 Service Unavailable"
    );
  });

  it("mensagem de verdade continua aparecendo, com o status junto", () => {
    expect(
      descreverFalha(
        "contas_receber",
        resposta({
          count: null,
          error: { message: 'relation "contas_receber" does not exist', code: "42P01" },
          status: 404,
          statusText: "Not Found",
        })
      )
    ).toBe(
      'contas_receber: relation "contas_receber" does not exist · 42P01 · HTTP 404 Not Found'
    );
  });

  it("falha de rede não inventa 'HTTP 0' — o postgrest-js usa status 0 quando o fetch nem saiu", () => {
    const dito = descreverFalha(
      "clientes",
      resposta({ count: null, error: { message: "FetchError: fetch failed" }, status: 0, statusText: "" })
    );
    expect(dito).toBe("clientes: FetchError: fetch failed");
    expect(dito).not.toContain("HTTP 0");
  });

  it("erro sem absolutamente nada ainda assim diz alguma coisa", () => {
    expect(descreverFalha("clientes", { error: { message: "" } })).toBe(
      "clientes: falhou sem mensagem, sem código e sem status"
    );
  });

  it("campos só de espaço em branco contam como ausentes", () => {
    expect(
      descreverFalha("clientes", { error: { message: "   ", code: "  ", hint: null }, status: 502 })
    ).toBe("clientes: HTTP 502");
  });
});

describe("sondar — retentar não é esconder", () => {
  /** Encadeia respostas: a 1ª chamada devolve a 1ª, a 2ª devolve a 2ª. */
  function contadorDe(...respostas: Contagem[]) {
    let i = 0;
    const chamadas = () => i;
    return {
      contar: () => Promise.resolve(respostas[Math.min(i++, respostas.length - 1)]),
      chamadas,
    };
  }

  it("passando de primeira, não tenta de novo", async () => {
    const c = contadorDe(resposta({ count: 8 }));
    const m = await sondar({ nome: "clientes", contar: c.contar });
    expect(m).toEqual({ nome: "clientes", contagem: 8, erro: null, instavel: null });
    expect(c.chamadas()).toBe(1);
  });

  it("blip de partida a frio: 2ª tentativa salva, e a 1ª falha FICA no relatório", async () => {
    const c = contadorDe(falhaDeHead(503, "Service Unavailable"), resposta({ count: 14 }));
    const m = await sondar({ nome: "contas_receber", contar: c.contar });
    expect(c.chamadas()).toBe(2);
    expect(m.contagem).toBe(14);
    // Alcançável: o banco respondeu.
    expect(m.erro).toBeNull();
    // E mesmo assim o blip não some — é a diferença entre "tudo bem" e
    // "bem agora". Apagá-lo seria mentir por omissão.
    expect(m.instavel).toBe("contas_receber: HTTP 503 Service Unavailable");
  });

  it("queda de verdade sobrevive às duas tentativas e vira erro, não blip", async () => {
    const c = contadorDe(falhaDeHead(500, "Internal Server Error"));
    const m = await sondar({ nome: "clientes", contar: c.contar });
    expect(c.chamadas()).toBe(2);
    expect(m.erro).toBe("clientes: HTTP 500 Internal Server Error");
    expect(m.instavel).toBeNull();
    expect(m.contagem).toBeNull();
  });

  it("contagem ausente sem erro continua sendo null — 'não contou' não é 'falhou'", async () => {
    const c = contadorDe(resposta({ count: null }));
    const m = await sondar({ nome: "fila", contar: c.contar });
    expect(m.contagem).toBeNull();
    expect(m.erro).toBeNull();
  });
});
