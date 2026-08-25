import { beforeEach, describe, expect, it, vi } from "vitest";
import { BancoFake } from "./fakes/supabase-fake";
import { aplicarEvento, enfileirarEvento, entregarFila } from "@/lib/integracao/sincronia";
import type { Envelope } from "@/lib/integracao/contrato";

/**
 * A via de mão dupla, exercitada contra o Supabase de mentira.
 *
 * O que estes testes protegem é o que o Gate G0 mediu como aberto: *"não
 * existe uma linha sequer sobre webhook no ScopeFinance"* (Ponto 7, `D-21`) —
 * e a consequência escrita lá: **hoje, todo cliente cadastrado na Dashboard é
 * um cliente que o financeiro não tem**.
 */

let banco: BancoFake;

function novoBanco(seed: Record<string, Record<string, unknown>[]> = {}) {
  banco = new BancoFake(seed, {
    integracao_recebidos: {
      unicos: [{ colunas: ["evento_id"], nome: "integracao_recebidos_evento_id_key" }],
      defaults: { processado: false, recebido_em: () => new Date().toISOString() },
    },
    integracao_enviados: {
      defaults: {
        entregue: false,
        tentativas: 0,
        proxima_tentativa_em: () => new Date().toISOString(),
        criado_em: () => new Date().toISOString(),
      },
    },
    clientes: { defaults: { origem: "scopefinance", status: "Ativo" } },
  });
  return banco;
}

const envelope = (dados: Record<string, unknown>, over: Partial<Envelope> = {}): Envelope => ({
  evento: "cliente.criado",
  id: "evt_abc",
  criado_em: "2026-08-25T10:00:00Z",
  dados,
  ...over,
});

beforeEach(() => {
  novoBanco();
  vi.unstubAllEnvs();
});

describe("aplicarEvento — a Dashboard cadastrou um cliente", () => {
  it("cria o cliente com o MESMO id — é o que impede duas identidades", () => {
    // O id compartilhado é o núcleo da decisão do dono de 25/08/2026. Se cada
    // lado gerasse o seu, a mesma empresa teria duas identidades e nenhuma
    // conta a receber saberia a qual cliente da Dashboard pertence.
    return aplicarEvento(banco as never, envelope({ cliente_id: "c-1", nome: "Acme", doc: "111" }))
      .then((r) => {
        expect(r).toMatchObject({ estado: "aplicado", acao: "criar", cliente_id: "c-1" });
        expect(banco.tabela("clientes")).toHaveLength(1);
        expect(banco.tabela("clientes")[0]).toMatchObject({
          id: "c-1",
          nome: "Acme",
          origem: "dashboard",
        });
      });
  });

  it("carimba a procedência: origem = dashboard, não scopefinance", async () => {
    await aplicarEvento(banco as never, envelope({ cliente_id: "c-1", nome: "Acme" }));
    expect(banco.tabela("clientes")[0].origem).toBe("dashboard");
  });

  it("grava na caixa de entrada ANTES de processar", async () => {
    await aplicarEvento(banco as never, envelope({ cliente_id: "c-1", nome: "Acme" }));
    const [recebido] = banco.tabela("integracao_recebidos");
    expect(recebido).toMatchObject({ evento_id: "evt_abc", processado: true, erro: null });
  });

  it("evento repetido devolve 'duplicado' e NÃO grava de novo", async () => {
    // A escada de retry da Dashboard faz reentrega ser rotina. Sem esta
    // idempotência, cada retry sobrescreveria o cadastro local.
    await aplicarEvento(banco as never, envelope({ cliente_id: "c-1", nome: "Acme" }));
    const r = await aplicarEvento(
      banco as never,
      envelope({ cliente_id: "c-1", nome: "OUTRO NOME" })
    );
    expect(r.estado).toBe("duplicado");
    expect(banco.tabela("clientes")[0].nome).toBe("Acme");
    expect(banco.tabela("integracao_recebidos")).toHaveLength(1);
  });

  it("cliente.atualizado sobrescreve o cadastro existente", async () => {
    novoBanco({ clientes: [{ id: "c-1", nome: "Antigo", origem: "dashboard" }] });
    const r = await aplicarEvento(
      banco as never,
      envelope({ cliente_id: "c-1", nome: "Novo" }, { evento: "cliente.atualizado", id: "evt_2" })
    );
    expect(r).toMatchObject({ estado: "aplicado", acao: "atualizar" });
    expect(banco.tabela("clientes")[0].nome).toBe("Novo");
  });

  it("payload de perfil comercial é ignorado, com motivo, sem criar nada", async () => {
    const r = await aplicarEvento(
      banco as never,
      envelope({ cliente_id: "c-1", setor: "varejo", porte: "PME", status: "ativo" })
    );
    expect(r.estado).toBe("ignorado");
    expect(banco.tabela("clientes")).toHaveLength(0);
    // Mas o evento fica registrado: ignorar não é perder o rastro.
    expect(banco.tabela("integracao_recebidos")).toHaveLength(1);
  });

  it("documento já usado por OUTRO cliente vira erro declarado, não duplicata", async () => {
    // É o conflito 4.3 do `00-LEVANTAMENTO` da Dashboard: a mesma empresa com
    // duas identidades. Escolher qual apagar não é decisão do código.
    novoBanco({
      clientes: [{ id: "local-9", nome: "Acme (cadastrado aqui)", doc: "12.345.678/0001-90" }],
    });
    const r = await aplicarEvento(
      banco as never,
      envelope({ cliente_id: "c-1", nome: "Acme LTDA", doc: "12345678000190" })
    );
    expect(r.estado).toBe("erro");
    if (r.estado === "erro") {
      expect(r.motivo).toContain("local-9");
      expect(r.motivo).toContain("duas identidades");
    }
    expect(banco.tabela("clientes")).toHaveLength(1);
  });

  it("mesmo documento no MESMO id não é conflito — é a reentrega normal", async () => {
    novoBanco({ clientes: [{ id: "c-1", nome: "Acme", doc: "12345678000190" }] });
    const r = await aplicarEvento(
      banco as never,
      envelope({ cliente_id: "c-1", nome: "Acme LTDA", doc: "12.345.678/0001-90" })
    );
    expect(r.estado).toBe("aplicado");
  });

  it("⛔ aplicar evento da Dashboard NÃO enfileira evento de volta", async () => {
    // Supressão de eco. Sem ela, um cadastro geraria ping-pong infinito entre
    // os dois sistemas, e cada volta gravaria linha nas duas outbox.
    await aplicarEvento(banco as never, envelope({ cliente_id: "c-1", nome: "Acme" }));
    expect(banco.tabela("integracao_enviados")).toHaveLength(0);
  });
});

describe("enfileirarEvento / entregarFila — a via de volta", () => {
  it("enfileirar grava na outbox e não faz rede", async () => {
    const espiao = vi.fn();
    vi.stubGlobal("fetch", espiao);
    await enfileirarEvento(banco as never, "cliente.criado", { cliente_id: "c-9" });
    expect(banco.tabela("integracao_enviados")).toHaveLength(1);
    // Se `enfileirarEvento` fizesse fetch, uma Dashboard lenta passaria a
    // atrasar o cadastro de cliente que originou o evento.
    expect(espiao).not.toHaveBeenCalled();
  });

  it("sem URL/segredo provisionados, a fila não some — só não é entregue", async () => {
    await enfileirarEvento(banco as never, "cliente.criado", { cliente_id: "c-9" });
    const r = await entregarFila(banco as never);
    expect(r.motivo).toContain("SCOPE_DASHBOARD_WEBHOOK_URL");
    expect(banco.tabela("integracao_enviados")[0].entregue).toBe(false);
  });

  it("entrega assinada no dialeto X-Hub-Signature-256 e marca entregue", async () => {
    vi.stubEnv("SCOPE_DASHBOARD_WEBHOOK_URL", "https://dash/api/webhooks/incoming/scopefinance");
    vi.stubEnv("SCOPE_DASHBOARD_WEBHOOK_SECRET", "w3bh00k");

    const chamadas: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      chamadas.push({ url, init });
      return new Response("{}", { status: 200 });
    });

    await enfileirarEvento(banco as never, "cliente.criado", { cliente_id: "c-9", nome: "Nova" });
    const r = await entregarFila(banco as never);

    expect(r).toMatchObject({ processados: 1, entregues: 1, falhas: 0 });
    const headers = chamadas[0].init.headers as Record<string, string>;
    expect(headers["X-Hub-Signature-256"]).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(headers["X-Scope-Event"]).toBe("cliente.criado");
    // A origem viaja no corpo: é o que permite à Dashboard suprimir o eco dela.
    expect(JSON.parse(chamadas[0].init.body as string).origem).toBe("scopefinance");
    expect(banco.tabela("integracao_enviados")[0].entregue).toBe(true);
  });

  it("falha do outro lado agenda nova tentativa, sem perder o evento", async () => {
    vi.stubEnv("SCOPE_DASHBOARD_WEBHOOK_URL", "https://dash/x");
    vi.stubEnv("SCOPE_DASHBOARD_WEBHOOK_SECRET", "w");
    vi.stubGlobal("fetch", async () => new Response("nao", { status: 500 }));

    await enfileirarEvento(banco as never, "cliente.criado", { cliente_id: "c-9" });
    const r = await entregarFila(banco as never);

    expect(r).toMatchObject({ processados: 1, entregues: 0, falhas: 1, em_dead_letter: 0 });
    const linha = banco.tabela("integracao_enviados")[0];
    expect(linha).toMatchObject({ entregue: false, tentativas: 1, ultimo_status: 500 });
    expect(new Date(linha.proxima_tentativa_em as string).getTime()).toBeGreaterThan(Date.now());
  });

  it("erro de rede também é falha registrada, não exceção que sobe", async () => {
    vi.stubEnv("SCOPE_DASHBOARD_WEBHOOK_URL", "https://dash/x");
    vi.stubEnv("SCOPE_DASHBOARD_WEBHOOK_SECRET", "w");
    vi.stubGlobal("fetch", async () => {
      throw new Error("ECONNREFUSED");
    });

    await enfileirarEvento(banco as never, "cliente.criado", { cliente_id: "c-9" });
    const r = await entregarFila(banco as never);
    expect(r.falhas).toBe(1);
    expect(banco.tabela("integracao_enviados")[0].ultimo_erro).toBe("ECONNREFUSED");
  });

  it("na 5ª falha vai para dead-letter — sai da fila ativa, não do banco", async () => {
    vi.stubEnv("SCOPE_DASHBOARD_WEBHOOK_URL", "https://dash/x");
    vi.stubEnv("SCOPE_DASHBOARD_WEBHOOK_SECRET", "w");
    vi.stubGlobal("fetch", async () => new Response("", { status: 503 }));

    await enfileirarEvento(banco as never, "cliente.criado", { cliente_id: "c-9" });
    banco.tabela("integracao_enviados")[0].tentativas = 4;

    const r = await entregarFila(banco as never);
    expect(r.em_dead_letter).toBe(1);
    // Apagar seria perder a evidência de que a integração do outro lado quebrou.
    expect(banco.tabela("integracao_enviados")).toHaveLength(1);
  });

  it("evento em dead-letter não é reprocessado pela fila", async () => {
    vi.stubEnv("SCOPE_DASHBOARD_WEBHOOK_URL", "https://dash/x");
    vi.stubEnv("SCOPE_DASHBOARD_WEBHOOK_SECRET", "w");
    const espiao = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", espiao);

    await enfileirarEvento(banco as never, "cliente.criado", { cliente_id: "c-9" });
    banco.tabela("integracao_enviados")[0].tentativas = 5;

    const r = await entregarFila(banco as never);
    expect(r.processados).toBe(0);
    expect(espiao).not.toHaveBeenCalled();
  });
});
