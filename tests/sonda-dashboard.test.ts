import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sondarDashboard } from "@/lib/integracao/sonda-dashboard";

/**
 * A sonda que faltava, e o 401 que ela veio nomear.
 *
 * ⚖️ **O sintoma que originou este arquivo** — 26/08/2026. A tela
 * `/integracao` mostrava "Pronto · Pronto · 0 pendentes" e o botão *Testar
 * conexão* dizia "Serviço de integração no ar", enquanto **toda** passada da
 * reconciliação voltava `{"motivo": "Dashboard respondeu 401"}`. As duas
 * afirmações verdes eram verdadeiras e nenhuma media o que importava: a
 * primeira media presença de variável, a segunda media o nosso próprio
 * `/saude`. A chamada à Dashboard não era feita por ninguém.
 *
 * ⛔ Estes testes travam as duas metades do conserto: a sonda **chama a rota
 * real com a chave real**, e o motivo **carrega o corpo** — porque `401`
 * sozinho cabe em três causas com correções diferentes.
 */

const BASE = "https://dashboard.example/api/v1";

const comAmbiente = (extra: Record<string, string> = {}) => {
  process.env.SCOPE_DASHBOARD_API_BASE = BASE;
  process.env.SCOPE_DASHBOARD_API_KEY_OUT = "sk_live_valorInteiro";
  Object.assign(process.env, extra);
};

beforeEach(() => {
  delete process.env.SCOPE_DASHBOARD_API_BASE;
  delete process.env.SCOPE_DASHBOARD_API_KEY_OUT;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sondarDashboard — presença de variável não é prova de valor certo", () => {
  it("sem as variáveis, nomeia quais faltam e não inventa uma chamada", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const r = await sondarDashboard();

    expect(r.ok).toBe(false);
    expect(r.mensagem).toContain("SCOPE_DASHBOARD_API_BASE");
    expect(r.mensagem).toContain("SCOPE_DASHBOARD_API_KEY_OUT");
    // O ponto: não adianta "testar conexão" sem material para testá-la.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("bate na MESMA rota que a reconciliação usa, com a chave no Bearer", async () => {
    comAmbiente();
    const fetchSpy = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify({ dados: [{ id: "1" }, { id: "2" }] }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchSpy);

    const r = await sondarDashboard();

    // Uma sonda que batesse num endpoint mais fácil voltaria verde sem
    // provar nada — que é exatamente o defeito que ela veio corrigir.
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`${BASE}/clientes-mestre`);
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer sk_live_valorInteiro",
    });
    expect(r.ok).toBe(true);
    expect(r.clientes).toBe(2);
  });

  it("401 da APLICAÇÃO manda gerar chave nova e copiar o valor inteiro", async () => {
    comAmbiente();
    // O corpo real da Dashboard, medido em produção em 26/08/2026.
    vi.stubGlobal("fetch", async () =>
      new Response(
        JSON.stringify({ error: { code: "unauthorized", message: "API key ausente ou inválida" } }),
        { status: 401 }
      )
    );

    const r = await sondarDashboard();

    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
    // O corpo entra no motivo: é ele que separa esta causa das outras duas.
    expect(r.mensagem).toContain("API key ausente ou inválida");
    expect(r.acao).toMatch(/valor INTEIRO|prefixo mascarado/);
  });

  it("401 que NÃO é da aplicação aponta para a URL, não para a chave", async () => {
    comAmbiente();
    // Vercel Authentication numa implantação protegida: HTML, sem `code`.
    vi.stubGlobal("fetch", async () =>
      new Response("<!doctype html><title>Authentication Required</title>", { status: 401 })
    );

    const r = await sondarDashboard();

    expect(r.ok).toBe(false);
    // Mandar trocar a chave aqui faria o dono girar credencial por nada.
    expect(r.acao).toContain("SCOPE_DASHBOARD_API_BASE");
    expect(r.acao).not.toMatch(/valor INTEIRO/);
  });

  it("403 é escopo, 404 é URL — cada status ganha a correção que lhe cabe", async () => {
    comAmbiente();

    vi.stubGlobal("fetch", async () => new Response("{}", { status: 403 }));
    expect((await sondarDashboard()).acao).toContain("clientes:read");

    vi.stubGlobal("fetch", async () => new Response("{}", { status: 404 }));
    expect((await sondarDashboard()).acao).toContain("/api/v1");
  });

  it("a chamada que nem sai vira motivo legível, não exceção", async () => {
    comAmbiente();
    vi.stubGlobal("fetch", async () => {
      throw new Error("fetch failed");
    });

    const r = await sondarDashboard();

    expect(r.ok).toBe(false);
    expect(r.status).toBeNull();
    expect(r.mensagem).toBe("fetch failed");
  });
});
