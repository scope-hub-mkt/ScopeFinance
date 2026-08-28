-- ════════════════════════════════════════════════════════════════════
--  Credenciais de integração pela tela — o "Gerenciar" do painel
--  Aplicar com o SQL Editor do Supabase, ou pelo runner de schema.
-- ════════════════════════════════════════════════════════════════════
--
-- POR QUE ISTO EXISTE. Até 28/08/2026 o segredo do ScopeFinance morava só no
-- ambiente da Vercel, e a tela `/integracao` apenas **relatava presença**. Foi
-- o meio-termo honesto de 25/08 — mas ele custa um deploy a cada rotação de
-- chave, e um deploy é exatamente o que não se quer no meio de um incidente de
-- credencial. A Dashboard resolveu isso com `RF-58`/`D-41`; esta tabela é a
-- outra ponta da mesma decisão, para que as duas frentes se gerenciem igual.
--
-- ⚖️ A REGRA DE RESOLUÇÃO É A MESMA DOS DOIS LADOS: **tela primeiro, ambiente
-- como fallback**. Apagar a linha devolve o comportamento anterior sem deploy —
-- é o que torna a mudança reversível sem susto.
--
-- ⛔ A CHAVE É O NOME DA VARIÁVEL que ela substitui. Um segundo vocabulário
-- ("chave_dashboard" para `SCOPE_DASHBOARD_API_KEY`) obrigaria todo mundo a
-- traduzir de cabeça, e o dia do erro de tradução é o dia da integração muda.

create table if not exists integracao_credenciais (
  chave          text primary key,
  valor          text not null,
  atualizado_por uuid,
  atualizado_em  timestamptz not null default now()
);

comment on table integracao_credenciais is
  'Credenciais de integração preenchidas pela tela. Resolução: esta tabela primeiro, process.env como fallback. O valor NUNCA volta para o cliente — a tela exibe prefixo mascarado.';

-- ⛔ RLS ligada e SEM policy de leitura: só a chave de serviço (server-side)
-- alcança esta tabela. Uma credencial legível pelo cliente anônimo seria a
-- própria definição de vazamento — e o padrão do PostgREST é permitir quando
-- há policy, então a ausência de policy é a proteção, não um esquecimento.
alter table integracao_credenciais enable row level security;
