import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * As constraints reais do Postgres — a metade que a suíte em memória **não
 * consegue** provar.
 *
 * ⚖️ **O risco que este arquivo fecha, e ele estava escrito no próprio
 * README.** A seção *"O que este sistema NÃO tem (leia antes de confiar)"*
 * declarava: *"os testes usam um Supabase em memória: provam a regra de
 * negócio, **não** o SQL. Constraint de banco só é exercitada rodando o
 * schema."* Aceito não é resolvido — este arquivo é a resolução, e o passo de
 * Postgres no CI é o que faz ele rodar.
 *
 * **Três constraints, e nenhuma é decorativa:**
 *
 * 1. **`ux_clientes_doc_norm`** — o índice funcional sobre o documento
 *    normalizado. Era o **Ponto 1 do Gate G0** da Scope Dashboard: sem ele,
 *    `12.345.678/0001-90` e `12345678000190` viravam dois clientes, e a
 *    replicação de `RN-03` herdava a duplicidade.
 * 2. **`unique (assinatura_id, competencia)`** — a idempotência da
 *    recorrência. É o que faz *"rodar duas vezes não duplica"* ser fato de
 *    banco, e não promessa de código.
 * 3. **`ux_pagar_ref_externa`** — a idempotência do lançamento de comissão
 *    vindo da Dashboard. Sem ela, reprocessar uma aprovação duplicaria a
 *    despesa.
 *
 * **Pula sozinho quando não há banco**, como o equivalente da Dashboard
 * (`L-41`): passa a valer no minuto em que a variável existir, sem ninguém
 * precisar lembrar de voltar aqui.
 *
 *   DATABASE_URL='postgresql://…' npm test
 *
 * ⚠️ **Não deixa resíduo:** tudo dentro de uma transação com `rollback` no
 * fim. Teste que escreve no banco compartilhado e some com a evidência é pior
 * que teste nenhum.
 */

const URL_BANCO = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL ?? "";
const temBanco = URL_BANCO.length > 0;

type Cliente = {
  query: (sql: string, valores?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  end: () => Promise<void>;
};

describe.skipIf(!temBanco)("constraints reais do Postgres (ScopeFinance)", () => {
  let cliente: Cliente;

  beforeAll(async () => {
    // `pg` só é carregado quando há banco: importar no topo faria o arquivo
    // pagar o custo do driver em toda execução, inclusive nas que pulam.
    const { default: pg } = await import("pg");
    cliente = new pg.Client({ connectionString: URL_BANCO }) as unknown as Cliente;
    await (cliente as unknown as { connect: () => Promise<void> }).connect();
    await cliente.query("begin");
  });

  afterAll(async () => {
    if (!cliente) return;
    await cliente.query("rollback");
    await cliente.end();
  });

  // ───────────────────────────────────────────────────────────────────
  //  1 — documento único por DÍGITOS (Ponto 1 do Gate G0)
  // ───────────────────────────────────────────────────────────────────

  it("recusa o MESMO CNPJ escrito com e sem máscara", async () => {
    await cliente.query("savepoint s1");
    await cliente.query("insert into clientes (nome, doc) values ($1, $2)", [
      "Empresa com máscara",
      "12.345.678/0001-90",
    ]);

    await expect(
      cliente.query("insert into clientes (nome, doc) values ($1, $2)", [
        "Mesma empresa sem máscara",
        "12345678000190",
      ])
    ).rejects.toThrow();

    // ⚖️ É a prova de que o índice é FUNCIONAL. Um `unique (doc)` cru deixaria
    // os dois entrarem, e este caso passaria a falhar — que é exatamente o
    // sinal que se quer.
    await cliente.query("rollback to savepoint s1");
  });

  it("aceita dois clientes com documentos realmente diferentes", async () => {
    await cliente.query("savepoint s2");
    await cliente.query("insert into clientes (nome, doc) values ($1, $2)", [
      "Uma",
      "11.111.111/0001-11",
    ]);
    await cliente.query("insert into clientes (nome, doc) values ($1, $2)", [
      "Outra",
      "22.222.222/0001-22",
    ]);
    const r = await cliente.query(
      "select count(*)::int as n from clientes where doc in ($1, $2)",
      ["11.111.111/0001-11", "22.222.222/0001-22"]
    );
    expect(r.rows[0].n).toBe(2);
    await cliente.query("rollback to savepoint s2");
  });

  it("aceita VÁRIOS clientes sem documento — o índice é parcial", async () => {
    // Cliente sem CNPJ é caso real (prospect que ainda não mandou os dados).
    // Um índice único não-parcial travaria o segundo, e o cadastro perderia
    // uma etapa inteira do funil.
    await cliente.query("savepoint s3");
    await cliente.query("insert into clientes (nome, doc) values ($1, null)", ["Sem doc A"]);
    await cliente.query("insert into clientes (nome, doc) values ($1, null)", ["Sem doc B"]);
    const r = await cliente.query(
      "select count(*)::int as n from clientes where doc is null and nome like 'Sem doc %'"
    );
    expect(r.rows[0].n).toBe(2);
    await cliente.query("rollback to savepoint s3");
  });

  // ───────────────────────────────────────────────────────────────────
  //  2 — idempotência da recorrência
  // ───────────────────────────────────────────────────────────────────

  it("a mesma competência da mesma assinatura não entra duas vezes", async () => {
    await cliente.query("savepoint s4");
    const clienteId = randomUUID();
    await cliente.query("insert into clientes (id, nome) values ($1, $2)", [
      clienteId,
      "Cliente da assinatura",
    ]);
    const assinaturaId = randomUUID();
    await cliente.query(
      `insert into assinaturas (id, cliente_id, descricao, valor, ciclo, direcao, status, proximo_venc)
       values ($1, $2, 'Mensalidade', 100, 'mensal', 'receber', 'Ativa', current_date)`,
      [assinaturaId, clienteId]
    );

    const inserirCobranca = () =>
      cliente.query(
        `insert into contas_receber (cliente_id, assinatura_id, competencia, descricao, valor, vencimento, status)
         values ($1, $2, '2026-08-01', 'Mensalidade 08/2026', 100, current_date, 'Pendente')`,
        [clienteId, assinaturaId]
      );

    await inserirCobranca();
    // ⚖️ *"Rodar duas vezes não duplica"* deixa de ser promessa do motor e
    // passa a ser fato do banco — que é o único lugar onde ela sobrevive a
    // um cron que dispara duas vezes.
    await expect(inserirCobranca()).rejects.toThrow();

    await cliente.query("rollback to savepoint s4");
  });

  // ───────────────────────────────────────────────────────────────────
  //  3 — idempotência do lançamento vindo da Dashboard
  // ───────────────────────────────────────────────────────────────────

  it("a mesma `referencia_externa` não vira duas despesas", async () => {
    await cliente.query("savepoint s5");
    const ref = `comissao-${randomUUID()}`;
    const inserir = () =>
      cliente.query(
        `insert into contas_pagar (fornecedor, descricao, valor, categoria, status, referencia_externa, vencimento)
         values ('Colaborador', 'Comissão 08/2026', 250, 'Comissão', 'Pendente', $1, current_date)`,
        [ref]
      );

    await inserir();
    // Reprocessar a aprovação de comissão na Dashboard não pode gerar a
    // segunda despesa aqui — `RN-01`: o dinheiro é deste lado.
    await expect(inserir()).rejects.toThrow();

    await cliente.query("rollback to savepoint s5");
  });
});
