import { describe, expect, it } from "vitest";
import {
  emailPlausivel,
  recusaAoMexerEmUsuario,
  recusaDeSenha,
  soDigitos,
  SENHA_MINIMA,
  PAPEIS,
} from "@/lib/dominio/usuarios";
import { caminhoDaFoto, caminhoDaUrl, recusaDeFoto, TAMANHO_MAXIMO_FOTO } from "@/lib/dominio/avatar";

/**
 * `RF-FIN-10` — o CRUD de usuário (dono, 31/08/2026).
 *
 * ⚖️ **O que estes testes trancam é o que o banco não consegue trancar.** As
 * travas de integridade (documento único, papel válido, uma master só) são
 * `constraint` e se defendem sozinhas. O que vive só no código é **quem pode
 * mexer em quem** — e o erro ali não levanta exceção nenhuma: alguém troca a
 * senha de um colega e entra como ele, sem que nada acuse.
 */

const eu = (over: Partial<Parameters<typeof recusaAoMexerEmUsuario>[0]> = {}) => ({
  id: "eu",
  master: false,
  papel: "financeiro" as const,
  ...over,
});
const alvo = (over: Partial<Parameters<typeof recusaAoMexerEmUsuario>[1]> = {}) => ({
  id: "outro",
  master: false,
  ...over,
});

describe("recusaAoMexerEmUsuario — quem pode mexer em quem", () => {
  it("⛔ papel admin NÃO troca credencial de outra pessoa — só a master", () => {
    // ⚖️ Administrar acesso é uma coisa; trocar a senha de alguém é TOMAR a
    // conta dessa pessoa, e nenhuma auditoria desfaz isso. Confundir as duas
    // daria a todo administrador o poder de entrar como qualquer colega.
    const r = recusaAoMexerEmUsuario(eu({ papel: "admin" }), alvo(), { credencial: true });
    expect(r).toBeTruthy();
    expect(r).toContain("administradora");
  });

  it("a master troca credencial de outra pessoa — é o caminho que destrava", () => {
    expect(
      recusaAoMexerEmUsuario(eu({ master: true, papel: "admin" }), alvo(), { credencial: true })
    ).toBeNull();
  });

  it("qualquer pessoa troca a PRÓPRIA credencial, mesmo sem papel nenhum", () => {
    expect(
      recusaAoMexerEmUsuario(eu({ papel: "leitura" }), alvo({ id: "eu" }), { credencial: true })
    ).toBeNull();
  });

  it("quem não é admin não mexe no cadastro de outra pessoa", () => {
    const r = recusaAoMexerEmUsuario(eu({ papel: "financeiro" }), alvo(), { papel: "admin" });
    expect(r).toBe("Você não administra usuários.");
  });

  it("⛔ a conta administradora não se desativa — o sistema ficaria sem quem administra", () => {
    const r = recusaAoMexerEmUsuario(
      eu({ id: "m", master: true, papel: "admin" }),
      alvo({ id: "m", master: true }),
      { ativo: false }
    );
    expect(r).toContain("não se desativa");
  });

  it("⛔ a conta administradora não se rebaixa", () => {
    const r = recusaAoMexerEmUsuario(
      eu({ id: "m", master: true, papel: "admin" }),
      alvo({ id: "m", master: true }),
      { papel: "leitura" }
    );
    expect(r).toContain("não se rebaixa");
  });

  it("⛔ e ninguém de fora a rebaixa", () => {
    const r = recusaAoMexerEmUsuario(
      eu({ papel: "admin" }),
      alvo({ id: "m", master: true }),
      { papel: "leitura" }
    );
    expect(r).toContain("só é alterada por ela mesma");
  });

  it("a master continua podendo mexer em si mesma no que não é rebaixamento", () => {
    expect(
      recusaAoMexerEmUsuario(
        eu({ id: "m", master: true, papel: "admin" }),
        alvo({ id: "m", master: true }),
        { papel: "admin" }
      )
    ).toBeNull();
  });

  it("admin mexe no cadastro de quem não é master", () => {
    expect(
      recusaAoMexerEmUsuario(eu({ papel: "admin" }), alvo(), { papel: "leitura" })
    ).toBeNull();
  });
});

describe("PAPEIS — os três, e o que cada um significa", () => {
  it("são exatamente os três do CHECK do banco", () => {
    // ⚖️ Divergir daqui não quebra o build: quebra a gravação, em produção,
    // com "violates check constraint" na cara de quem cadastrou alguém.
    expect(PAPEIS.map((p) => p.valor)).toEqual(["admin", "financeiro", "leitura"]);
  });

  it("todo papel explica o que faz — seletor sem descrição vira adivinhação", () => {
    for (const p of PAPEIS) expect(p.descricao.length).toBeGreaterThan(10);
  });
});

describe("recusaDeSenha — comprimento, e só", () => {
  it("recusa abaixo do mínimo dizendo qual é o mínimo", () => {
    expect(recusaDeSenha("a".repeat(SENHA_MINIMA - 1))).toContain(String(SENHA_MINIMA));
  });

  it("aceita exatamente o mínimo — a borda não pode ser exclusiva por acidente", () => {
    expect(recusaDeSenha("a".repeat(SENHA_MINIMA))).toBeNull();
  });

  it("⛔ recusa espaço nas pontas — senha que não se redigita é conta perdida", () => {
    expect(recusaDeSenha(" senhaboa ")).not.toBeNull();
    expect(recusaDeSenha("senha com espaco no meio")).toBeNull();
  });

  it("não exige maiúscula, número nem símbolo", () => {
    expect(recusaDeSenha("cavalobateriagrampo")).toBeNull();
  });
});

describe("emailPlausivel — o suficiente para não gravar lixo", () => {
  it("aceita os válidos que uma regex ambiciosa recusa", () => {
    expect(emailPlausivel("aiko+fin@sub.scopehub.com.br")).toBe(true);
    expect(emailPlausivel("a@b.technology")).toBe(true);
  });

  it("recusa o que claramente não é e-mail", () => {
    for (const v of ["", "sem-arroba", "a@b", "a b@c.com", "@c.com"]) {
      expect(emailPlausivel(v), v).toBe(false);
    }
  });
});

describe("soDigitos — o CPF que o índice único compara", () => {
  it("tira pontuação, porque é assim que o banco compara", () => {
    expect(soDigitos("123.456.789-00")).toBe("12345678900");
  });

  it("vazio vira null — o índice é parcial e string vazia participaria dele", () => {
    expect(soDigitos("")).toBeNull();
    expect(soDigitos("...--")).toBeNull();
    expect(soDigitos(null)).toBeNull();
  });
});

describe("foto de perfil — público, mas não adivinhável", () => {
  it("recusa acima de 2 MB com a mensagem que o Storage não dá", () => {
    expect(recusaDeFoto({ size: TAMANHO_MAXIMO_FOTO + 1, type: "image/png" })).toContain("2 MB");
  });

  it("aceita exatamente o limite e os três formatos declarados no bucket", () => {
    for (const t of ["image/jpeg", "image/png", "image/webp"]) {
      expect(recusaDeFoto({ size: TAMANHO_MAXIMO_FOTO, type: t }), t).toBeNull();
    }
  });

  it("recusa formato de fora, nomeando o que veio", () => {
    expect(recusaDeFoto({ size: 100, type: "image/gif" })).toContain("image/gif");
  });

  it("o caminho carrega sufixo aleatório — é o que torna o bucket público seguro", () => {
    const a = caminhoDaFoto("u1", "image/png");
    expect(a).toMatch(/^u\/u1\/[0-9a-f-]{36}\.png$/);
    expect(a).not.toBe(caminhoDaFoto("u1", "image/png"));
  });

  it("⛔ caminhoDaUrl recusa URL de fora do bucket — nada a apagar", () => {
    expect(caminhoDaUrl("https://exemplo.com/foto.png")).toBeNull();
    expect(caminhoDaUrl(null)).toBeNull();
  });

  it("⛔ e recusa caminho que não começa em `u/` — coluna adulterada", () => {
    // Sem esta recusa, uma URL forjada viraria `remove()` num caminho
    // arbitrário do Storage.
    expect(caminhoDaUrl("https://x/avatares/../../outro.png")).toBeNull();
    expect(caminhoDaUrl("https://x/avatares/u/u1/abc.png")).toBe("u/u1/abc.png");
  });
});
