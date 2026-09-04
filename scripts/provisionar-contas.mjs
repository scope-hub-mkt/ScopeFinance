/**
 * Cria as três contas vivas no ScopeFinance — `RF-100`, `D-101`.
 *
 * ⚖️ **Gêmeo do script da Dashboard, com os papéis DE CÁ.** Os dois sistemas
 * têm usuários independentes (`D-94`) e vocabulários de papel diferentes: lá
 * são cinco (`manager`, `comercial`, `operacao`, `financeiro`, `socio`) mais
 * a camada de cargos; aqui são três (`admin`, `financeiro`, `leitura`) e não
 * há cargo nenhum.
 *
 * ⛔ **O que NÃO muda é o `master`.** Leonardo é master nos dois, e nos dois
 * a unicidade é garantida pelo índice parcial `uq_usuario_master`.
 *
 * Uso:
 *   node --env-file=.env.local scripts/provisionar-contas.mjs --seco
 *   node --env-file=.env.local scripts/provisionar-contas.mjs
 */
import { createClient } from "@supabase/supabase-js";

const SECO = process.argv.includes("--seco");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !chave) {
  console.error(
    "provisionar-contas: faltam NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY."
  );
  process.exitCode = 1;
  process.exit();
}

const supabase = createClient(url, chave, { auth: { persistSession: false } });

/** A senha é a mesma dos dois lados — e a marca de provisória é o que a torna segura. */
const SENHA = "ScopeRec@2026";

const CONTAS = [
  // Leonardo primeiro: `uq_usuario_master` é índice único parcial.
  { email: "leonardo@scopecompany.com.br", nome: "Leonardo", papel: "admin", master: true },
  // ⚖️ `admin` sem `master` já não manda em credencial alheia (`D-96`), e a
  // partir de `D-101` também não lança recebível manual (`RN-53`).
  { email: "aiko@scopecompany.com.br", nome: "Aiko L.", papel: "admin", master: false },
  { email: "jordana@scopecompany.com.br", nome: "Jordana", papel: "admin", master: false },
];

async function main() {
  const { count } = await supabase.from("usuarios").select("id", { count: "exact", head: true });

  if ((count ?? 0) > 0 && !SECO) {
    console.error(
      `provisionar-contas: já existem ${count} usuário(s). Este script é do dia zero.\n` +
        "  Para acrescentar alguém depois, use a tela /usuarios."
    );
    process.exitCode = 1;
    return;
  }

  console.log(SECO ? "provisionar-contas: --seco, nada será gravado.\n" : "provisionar-contas: criando.\n");

  for (const c of CONTAS) {
    const rotulo = `  conta  ${c.email.padEnd(32)} ${c.papel}${c.master ? " · MASTER" : ""}`;
    if (SECO) {
      console.log(rotulo);
      continue;
    }

    const { data: criado, error: erroAuth } = await supabase.auth.admin.createUser({
      email: c.email,
      password: SENHA,
      email_confirm: true,
      user_metadata: { nome: c.nome },
    });
    if (erroAuth || !criado.user) throw new Error(`auth ${c.email}: ${erroAuth?.message}`);

    const { error: erroPerfil } = await supabase.from("usuarios").insert({
      id: criado.user.id,
      nome: c.nome,
      email: c.email,
      papel: c.papel,
      master: c.master,
      ativo: true,
      senha_provisoria: true,
    });

    if (erroPerfil) {
      // Credencial órfã desfeita — mesma ordem do `convidarUsuario`.
      await supabase.auth.admin.deleteUser(criado.user.id);
      throw new Error(`perfil ${c.email}: ${erroPerfil.message}`);
    }

    console.log(rotulo);
  }

  console.log(
    `\nprovisionar-contas: ${SECO ? "seria criado" : "criado"} — senha provisória "${SENHA}", ` +
      "trocada obrigatoriamente no primeiro acesso."
  );
}

main().catch((e) => {
  console.error("provisionar-contas:", e.message);
  process.exitCode = 1;
});
