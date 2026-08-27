import { describe, expect, it, vi } from "vitest";
import {
  ATRASO_MAXIMO_MS,
  ESPERAS_MS,
  MENSAGEM_PGRST303,
  criarFetchComRetentativa,
  ehJwtNoFuturo,
} from "@/lib/supabase/retentativa";

const CORPO_303 = JSON.stringify({
  code: "PGRST303",
  message: "JWT issued at future",
  details: null,
  hint: null,
});

const r401 = () =>
  new Response(CORPO_303, { status: 401, headers: { "content-type": "application/json" } });
const r200 = (corpo = "[]") =>
  new Response(corpo, { status: 200, headers: { "content-type": "application/json" } });

/** Fila de respostas + o registro de quantas vezes a rede foi chamada. */
function fetchFalso(respostas: (() => Response)[]) {
  let i = 0;
  const chamadas: { url: string; body?: unknown }[] = [];
  const f = vi.fn(async (input: unknown, init?: RequestInit) => {
    chamadas.push({ url: String(input), body: init?.body });
    const fabrica = respostas[Math.min(i, respostas.length - 1)];
    i++;
    return fabrica();
  });
  return { f: f as unknown as typeof fetch, chamadas, espiao: f };
}

describe("ehJwtNoFuturo", () => {
  it("reconhece o 401 com PGRST303", () => {
    expect(ehJwtNoFuturo(401, CORPO_303)).toBe(true);
  });

  it("reconhece pela mensagem, se o código não vier", () => {
    expect(ehJwtNoFuturo(401, '{"message":"JWT issued at future"}')).toBe(true);
  });

  it("PGRST301 (JWT expirado) NÃO é este defeito", () => {
    // Token vencido é outra coisa: repetir não conserta, só atrasa o 401 que
    // precisa chegar. O gatilho estreito é a garantia de que a retentativa
    // nunca mascara um erro de credencial de verdade.
    expect(ehJwtNoFuturo(401, '{"code":"PGRST301","message":"JWT expired"}')).toBe(false);
  });

  it("mesmo corpo com outro status não conta", () => {
    expect(ehJwtNoFuturo(500, CORPO_303)).toBe(false);
    expect(ehJwtNoFuturo(200, CORPO_303)).toBe(false);
  });
});

describe("criarFetchComRetentativa", () => {
  it("resposta boa passa direto, sem custo e sem segunda chamada", async () => {
    const { f, espiao } = fetchFalso([() => r200('[{"id":1}]')]);
    const wrap = criarFetchComRetentativa(f, async () => {});
    const res = await wrap("https://x/rest/v1/clientes");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('[{"id":1}]');
    expect(espiao).toHaveBeenCalledTimes(1);
  });

  it("PGRST303 na primeira e sucesso na segunda: o chamador nunca vê o erro", async () => {
    const { f, espiao } = fetchFalso([r401, () => r200("[]")]);
    const wrap = criarFetchComRetentativa(f, async () => {});
    const res = await wrap("https://x/rest/v1/clientes");
    expect(res.status).toBe(200);
    expect(espiao).toHaveBeenCalledTimes(2);
  });

  it("erro de negócio (400) sai na hora, sem retentativa", async () => {
    const { f, espiao } = fetchFalso([
      () => new Response('{"code":"23505"}', { status: 400 }),
    ]);
    const wrap = criarFetchComRetentativa(f, async () => {});
    const res = await wrap("https://x/rest/v1/clientes");
    expect(res.status).toBe(400);
    expect(espiao).toHaveBeenCalledTimes(1);
  });

  it("401 de credencial errada não vira retentativa", async () => {
    const { f, espiao } = fetchFalso([
      () => new Response('{"message":"Invalid API key"}', { status: 401 }),
    ]);
    const wrap = criarFetchComRetentativa(f, async () => {});
    const res = await wrap("https://x/rest/v1/clientes");
    expect(res.status).toBe(401);
    expect(espiao).toHaveBeenCalledTimes(1);
  });

  it("teimando em todas: 1 original + as retentativas, e a mensagem troca", async () => {
    const { f, espiao } = fetchFalso([r401]);
    const esperas: number[] = [];
    const wrap = criarFetchComRetentativa(f, async (ms) => {
      esperas.push(ms);
    });
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await wrap("https://x/rest/v1/clientes");
    erro.mockRestore();

    expect(espiao).toHaveBeenCalledTimes(ESPERAS_MS.length + 1);
    expect(esperas).toEqual([...ESPERAS_MS]);
    expect(esperas.reduce((a, b) => a + b, 0)).toBe(ATRASO_MAXIMO_MS);

    expect(res.status).toBe(401);
    const corpo = (await res.json()) as Record<string, unknown>;
    // O código do PostgREST sobrevive — quem depura ainda consegue procurar
    // por PGRST303. O que muda é só a frase que o usuário lê.
    expect(corpo.code).toBe("PGRST303");
    expect(corpo.message).toBe(MENSAGEM_PGRST303);
    expect(String(corpo.details)).toContain("JWT issued at future");
  });

  it("o POST é reenviado com o mesmo corpo, e só por isso a retentativa vale", async () => {
    const { f, chamadas } = fetchFalso([r401, () => r200("{}")]);
    const wrap = criarFetchComRetentativa(f, async () => {});
    const body = JSON.stringify({ nome: "Cliente" });
    const res = await wrap("https://x/rest/v1/clientes", { method: "POST", body });
    expect(res.status).toBe(200);
    expect(chamadas.map((c) => c.body)).toEqual([body, body]);
  });

  it("corpo que não dá para repetir sai traduzido, sem reenvio às cegas", async () => {
    // Um stream se esgota na primeira passada: reenviar mandaria corpo vazio,
    // que é pior que o erro original.
    const { f, espiao } = fetchFalso([r401]);
    const wrap = criarFetchComRetentativa(f, async () => {});
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await wrap("https://x/rest/v1/clientes", {
      method: "POST",
      body: new ReadableStream(),
      // @ts-expect-error duplex só existe no Node/undici
      duplex: "half",
    });
    erro.mockRestore();
    expect(espiao).toHaveBeenCalledTimes(1);
    expect(((await res.json()) as Record<string, unknown>).message).toBe(MENSAGEM_PGRST303);
  });

  it("a mensagem final diz o que fazer, não só o que quebrou", () => {
    expect(MENSAGEM_PGRST303).toContain("PGRST303");
    expect(MENSAGEM_PGRST303).toContain("Recarregue a página");
    expect(MENSAGEM_PGRST303).toContain("Supabase");
    expect(MENSAGEM_PGRST303).not.toContain("JWT issued at future");
  });
});
