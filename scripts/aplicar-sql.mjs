/**
 * Aplica um arquivo `.sql` no banco remoto do ScopeFinance.
 *
 * ⚖️ Por que existe: até 27/08/2026 a única forma de aplicar DDL aqui era
 * colar no SQL Editor do Supabase. Isso funciona e não deixa rastro — não há
 * como saber depois se um arquivo foi aplicado, nem repetir a aplicação em
 * outro ambiente sem alguém lembrar de colar de novo. O `supabase/schema.sql`
 * continua sendo o original; este script só o executa.
 *
 * Por que não `supabase db push`: aquele comando espera `supabase/migrations/`.
 * Copiar os `.sql` para lá criaria duas fontes de verdade do schema — e o dia
 * em que divergirem, o banco vira a terceira.
 *
 * Segurança: a senha **nunca** entra em arquivo versionado. Vem por
 * `SUPABASE_DB_PASSWORD` no ambiente do processo e some quando ele termina.
 * Vai como campo separado, não embutida numa URL — o que evita o bug clássico
 * de `@` e `#` na senha quebrarem o parse.
 *
 * ⛔ Tudo roda numa transação só. Um `alter table` que passa seguido de um
 * `create unique index` que aborta por duplicata deixaria o banco no meio do
 * caminho — que é o pior estado possível para um schema.
 *
 * Uso:
 *   SUPABASE_DB_PASSWORD='…' node scripts/aplicar-sql.mjs supabase/schema.sql [--dry]
 */
import { readFileSync } from "node:fs";
import pg from "pg";

const REF = process.env.SUPABASE_PROJECT_REF || "teewposuwjvoxfgmispn";
const SENHA = process.env.SUPABASE_DB_PASSWORD;
const SECO = process.argv.includes("--dry");
const arquivo = process.argv.slice(2).find((a) => !a.startsWith("--"));

if (!SENHA || !arquivo) {
  console.error(
    "aplicar-sql: uso — SUPABASE_DB_PASSWORD='…' node scripts/aplicar-sql.mjs <arquivo.sql> [--dry]"
  );
  process.exit(1);
}

const sql = readFileSync(arquivo, "utf8");
console.log(`aplicar-sql: ${arquivo} — ${sql.split(/\r?\n/).length} linhas`);

if (SECO) {
  console.log("aplicar-sql: --dry, nada foi executado.");
  process.exit(0);
}

// A conexão direta saiu do ar em projetos novos (só IPv6) e o pooler é o
// caminho que funciona nos dois casos. Tenta na ordem, e diz qual pegou —
// "não conectou" sem dizer onde tentou é diagnóstico pela metade.
//
// ⚠️ **A lista tinha só `aws-0-*`, e isso custou uma investigação inteira em
// 28/08/2026.** Medido: `db.teewposuwjvoxfgmispn.supabase.co` resolve **só em
// IPv6**, e numa rede sem rota IPv6 a tentativa direta ora dava `ETIMEDOUT`,
// ora `password authentication failed` — o segundo é o pior, porque **acusa a
// senha** e manda a pessoa trocar de novo a credencial que estava certa. Os
// hosts `aws-0-*` desta lista **não resolvem** para este projeto; o dele é
// `aws-1-us-east-1`.
//
// ⛔ Por isso `aws-1-*` entra e a ordem muda: **pooler primeiro, direta por
// último**. O pooler resolve em IPv4 e funciona nas duas famílias de rede; a
// direta só serve onde há IPv6, e tentá-la antes transforma um problema de
// rota num diagnóstico de credencial.
const REGIOES = ["us-east-1", "sa-east-1", "us-east-2"];
const CANDIDATOS = [
  ...REGIOES.flatMap((r) =>
    ["aws-1", "aws-0"].map((p) => ({
      host: `${p}-${r}.pooler.supabase.com`,
      port: 5432,
      user: `postgres.${REF}`,
      rotulo: `pooler ${p}-${r} (sessão)`,
    }))
  ),
  { host: `db.${REF}.supabase.co`, port: 5432, user: "postgres", rotulo: "direta (só IPv6)" },
];

let cliente = null;
for (const c of CANDIDATOS) {
  const tentativa = new pg.Client({
    host: c.host,
    port: c.port,
    user: c.user,
    password: SENHA,
    database: "postgres",
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15_000,
  });
  try {
    await tentativa.connect();
    console.log(`aplicar-sql: conectado pela rota ${c.rotulo}`);
    cliente = tentativa;
    break;
  } catch (e) {
    console.log(`aplicar-sql: ${c.rotulo} não respondeu — ${e.message.split("\n")[0]}`);
  }
}

if (!cliente) {
  console.error("aplicar-sql: nenhuma rota de conexão respondeu.");
  process.exit(1);
}

try {
  await cliente.query("begin");
  await cliente.query(sql);
  await cliente.query("commit");
  console.log("aplicar-sql: aplicado e commitado.");
} catch (e) {
  await cliente.query("rollback").catch(() => {});
  console.error(`aplicar-sql: ABORTOU e desfez tudo — ${e.message}`);
  process.exitCode = 1;
} finally {
  // PostgREST guarda o schema em cache; sem isto uma coluna nova existe no
  // banco e continua invisível para `/rest/v1` até o serviço reciclar.
  try {
    await cliente.query("notify pgrst, 'reload schema'");
  } catch {
    /* o notify é conveniência, não pode derrubar a aplicação bem-sucedida */
  }
  await cliente.end();
}
