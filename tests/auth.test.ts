import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import {
  assinarEstiloHub,
  assinarEstiloScope,
  autenticarChave,
  verificarEntregaDaDashboard,
  JANELA_ASSINATURA_S,
} from "@/lib/integracao/auth";
import { diagnostico, estadoIntegracao, veredito } from "@/lib/integracao/config";

describe("autenticarChave", () => {
  it("chave certa passa", () => {
    expect(autenticarChave("segredo", "Bearer segredo").ok).toBe(true);
  });

  it("aceita sem o prefixo Bearer — quem pluga erra isso o tempo todo", () => {
    expect(autenticarChave("segredo", "segredo").ok).toBe(true);
  });

  it("chave errada é 401", () => {
    const r = autenticarChave("segredo", "Bearer outra");
    expect(r).toMatchObject({ ok: false, status: 401 });
  });

  it("prefixo certo com sufixo errado NÃO passa", () => {
    expect(autenticarChave("segredo", "Bearer segredoX").ok).toBe(false);
  });

  it("header ausente é 401", () => {
    expect(autenticarChave("segredo", null)).toMatchObject({ ok: false, status: 401 });
  });

  it("servidor SEM chave configurada é 503, não 401", () => {
    // A distinção é o que faz quem pluga olhar para o lado certo: 401 manda
    // conferir a credencial enviada; 503 diz que este servidor não foi
    // provisionado. Confundi-los custa uma tarde de depuração no lado errado.
    const r = autenticarChave(null, "Bearer qualquer");
    expect(r).toMatchObject({ ok: false, status: 503 });
    if (!r.ok) expect(r.motivo).toContain("SCOPE_DASHBOARD_API_KEY");
  });
});

describe("assinatura — os dois dialetos", () => {
  it("estilo Scope assina {timestamp}.{corpo}, como o contrato da Dashboard define", () => {
    const esperado =
      "sha256=" + createHmac("sha256", "s3cr3t").update("1755702000.{}").digest("hex");
    expect(assinarEstiloScope("s3cr3t", 1755702000, "{}")).toBe(esperado);
  });

  it("estilo Hub assina só o corpo, como a tela de webhooks de entrada valida", () => {
    const esperado = "sha256=" + createHmac("sha256", "s3cr3t").update("{}").digest("hex");
    expect(assinarEstiloHub("s3cr3t", "{}")).toBe(esperado);
  });

  it("os dois dialetos produzem assinaturas diferentes para o mesmo corpo", () => {
    // Se um dia coincidirem, é porque alguém apagou o timestamp do material
    // assinado — e a proteção contra replay foi junto.
    expect(assinarEstiloScope("s", 1, "{}")).not.toBe(assinarEstiloHub("s", "{}"));
  });
});

describe("verificarEntregaDaDashboard", () => {
  const agora = 1_755_702_000;
  const corpo = JSON.stringify({ evento: "cliente.criado", dados: { cliente_id: "c1" } });

  const headers = (over: Record<string, string> = {}) =>
    new Headers({
      "x-scope-timestamp": String(agora),
      "x-scope-signature-256": assinarEstiloScope("segredo", agora, corpo),
      ...over,
    });

  it("entrega íntegra e no prazo passa", () => {
    expect(verificarEntregaDaDashboard("segredo", headers(), corpo, agora).ok).toBe(true);
  });

  it("corpo alterado no caminho é recusado", () => {
    const adulterado = corpo.replace("c1", "c2");
    const r = verificarEntregaDaDashboard("segredo", headers(), adulterado, agora);
    expect(r).toMatchObject({ ok: false, status: 401 });
  });

  it("segredo diferente é recusado", () => {
    expect(verificarEntregaDaDashboard("outro", headers(), corpo, agora).ok).toBe(false);
  });

  it("replay fora da janela de 5 min é recusado, mesmo com assinatura válida", () => {
    const r = verificarEntregaDaDashboard(
      "segredo",
      headers(),
      corpo,
      agora + JANELA_ASSINATURA_S + 1
    );
    expect(r).toMatchObject({ ok: false, status: 401 });
    if (!r.ok) expect(r.motivo).toContain("replay");
  });

  it("dentro da janela, mesmo atrasado, passa", () => {
    expect(
      verificarEntregaDaDashboard("segredo", headers(), corpo, agora + JANELA_ASSINATURA_S - 1).ok
    ).toBe(true);
  });

  it("reassinar corpo antigo com timestamp novo NÃO engana", () => {
    // O timestamp entra no material assinado exatamente para isto: sem ele,
    // trocar só o header bastaria para reviver uma entrega antiga.
    const h = new Headers({
      "x-scope-timestamp": String(agora + 100),
      "x-scope-signature-256": assinarEstiloScope("segredo", agora, corpo),
    });
    expect(verificarEntregaDaDashboard("segredo", h, corpo, agora + 100).ok).toBe(false);
  });

  it("sem header de assinatura é 401", () => {
    const h = new Headers({ "x-scope-timestamp": String(agora) });
    expect(verificarEntregaDaDashboard("segredo", h, corpo, agora)).toMatchObject({ status: 401 });
  });

  it("sem segredo provisionado é 503", () => {
    expect(verificarEntregaDaDashboard(null, headers(), corpo, agora)).toMatchObject({
      ok: false,
      status: 503,
    });
  });
});

describe("diagnóstico das variáveis — o que a tela /integracao mostra", () => {
  it("ambiente vazio: nada pronto, e a lista do que falta é nominal", () => {
    const v = veredito(diagnostico(estadoIntegracao({})));
    expect(v.pronta).toBe(false);
    expect(v.entrada).toBe(false);
    expect(v.saida).toBe(false);
    expect(v.faltando).toContain("SCOPE_DASHBOARD_API_KEY");
  });

  it("as duas direções são independentes — dá para receber sem enviar", () => {
    const v = veredito(
      diagnostico(
        estadoIntegracao({
          SCOPE_DASHBOARD_API_KEY: "k",
          SCOPE_WEBHOOK_SECRET: "s",
        })
      )
    );
    expect(v.entrada).toBe(true);
    expect(v.saida).toBe(false);
    expect(v.pronta).toBe(false);
  });

  it("variável presente mas vazia conta como ausente", () => {
    // Vercel devolve string vazia para variável criada sem valor. Tratá-la
    // como configurada faria a tela mentir exatamente onde ela existe para
    // não mentir.
    const e = estadoIntegracao({ SCOPE_DASHBOARD_API_KEY: "   " });
    expect(e.apiKey).toBeNull();
  });

  it("barra final na URL base é removida — senão vira //clientes", () => {
    const e = estadoIntegracao({
      SCOPE_DASHBOARD_API_BASE: "https://x.app/api/v1/",
    });
    expect(e.dashboardBase).toBe("https://x.app/api/v1");
  });

  it("com tudo preenchido, fica pronta", () => {
    const v = veredito(
      diagnostico(
        estadoIntegracao({
          SCOPE_DASHBOARD_API_KEY: "k",
          SCOPE_WEBHOOK_SECRET: "s",
          SCOPE_DASHBOARD_WEBHOOK_URL: "https://d/api/webhooks/incoming/scopefinance",
          SCOPE_DASHBOARD_WEBHOOK_SECRET: "w",
          SCOPE_DASHBOARD_API_BASE: "https://d/api/v1",
          SCOPE_DASHBOARD_API_KEY_OUT: "o",
        })
      )
    );
    expect(v).toMatchObject({ pronta: true, entrada: true, saida: true, faltando: [] });
  });
});
