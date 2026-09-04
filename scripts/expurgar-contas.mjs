/**
 * Apaga TODAS as contas — credencial e perfil — no dia zero (`D-101`).
 *
 * ⛔ **Por que um script, e não SQL.** A credencial mora no GoTrue
 * (`auth.users`), não no schema `public`. `delete from usuarios` apagaria só
 * o perfil e deixaria a credencial de pé: a pessoa continuaria conseguindo
 * autenticar e cairia num estado sem perfil, que a aplicação trata como
 * "cadastro não encontrado" — uma conta fantasma que nada denuncia.
 *
 * ⚠️ **Roda DEPOIS do expurgo do dado de negócio.** `vendas.colaborador_id`,
 * `comissoes.colaborador_id`, `contratos_comissao.colaborador_id` e
 * `cliente_servico_colaboradores.colaborador_id` são `on delete restrict`:
 * com dado de negócio de pé, este script falha no meio.
 *
 * Uso:
 *   node --env-file=.env.local scripts/expurgar-contas.mjs --seco
 *   node --env-file=.env.local scripts/expurgar-contas.mjs --confirmar
 */
import { createClient } from "@supabase/supabase-js";

const SECO = !process.argv.includes("--confirmar");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !chave) {
  console.error("expurgar-contas: faltam NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
  process.exitCode = 1;
  process.exit();
}

const supabase = createClient(url, chave, { auth: { persistSession: false } });

async function main() {
  const { data: lista, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw new Error(`listUsers: ${error.message}`);

  const contas = lista.users;
  if (contas.length === 0) {
    console.log("expurgar-contas: nenhuma conta — nada a fazer.");
    return;
  }

  console.log(
    `expurgar-contas: ${contas.length} conta(s)${SECO ? " — MODO SECO, nada será apagado" : ""}\n`
  );
  for (const u of contas) console.log(`  ${u.email ?? "(sem e-mail)"}  ${u.id}`);

  if (SECO) {
    console.log("\n  Para apagar de verdade: --confirmar");
    return;
  }

  // As tabelas que penduram no perfil e não caem sozinhas. `usuarios` por
  // último dentro deste bloco: as duas primeiras a referenciam.
  for (const tabela of ["usuario_capacidades", "usuario_telas", "usuarios"]) {
    // ⚠️ `not("id", "is", null)` e não `neq("id", "")`: o `id` é uuid, e a
    // string vazia estoura com "invalid input syntax for type uuid" — o
    // PostgREST exige um predicado, e este é o que vale para toda linha.
    const { error: e } = await supabase.from(tabela).delete().not("id", "is", null);
    // A tabela pode não existir neste sistema (o ScopeFinance não tem as
    // duas primeiras) — ausência não é falha aqui.
    // A tabela pode não existir neste sistema. O PostgREST diz isso de DUAS
    // formas: "does not exist" (SQL) e "Could not find the table … in the
    // schema cache" (cache do PostgREST). Reconhecer só a primeira fazia o
    // script morrer no ScopeFinance, que não tem `usuario_capacidades`.
    if (e && !/does not exist|could not find the table/i.test(e.message)) {
      throw new Error(`${tabela}: ${e.message}`);
    }
  }

  let apagadas = 0;
  for (const u of contas) {
    const { error: e } = await supabase.auth.admin.deleteUser(u.id);
    if (e) throw new Error(`deleteUser ${u.email}: ${e.message}`);
    apagadas++;
  }

  const { data: sobrou } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  console.log(
    `\nexpurgar-contas: ${apagadas} credencial(is) apagada(s). ` +
      `Restam ${sobrou?.users.length ?? "?"} em auth.users.`
  );
}

main().catch((e) => {
  console.error("expurgar-contas:", e.message);
  process.exitCode = 1;
});
