-- ════════════════════════════════════════════════════════════════════
--  ETL — retratos prontos de exibição (D-91, 30/08/2026)
-- ════════════════════════════════════════════════════════════════════
--
-- ⚖️ Por que o ScopeFinance ganha o mesmo mecanismo que a Dashboard já tem
-- (`RNF-25`, `D-81`): até 30/08/2026 TODA página deste sistema pagava a carga
-- de **10 tabelas inteiras no navegador** — `StoreProvider` monta, `useEffect`
-- dispara `/api/clientes`, `/api/contratos`, `/api/assinaturas`, … e o browser
-- recebe cada tabela completa, em toda navegação, inclusive nas telas que usam
-- uma só delas.
--
-- É o oposto exato do que o dono pediu em 30/08/2026: *"o backend triturando
-- os dados e fazendo as requisições, exportando o json clean tratado com ETL e
-- sendo consumido pelo front, deixando ele extremamente leve"*.
--
-- ⛔ **Retrato NUNCA é fonte de verdade.** Apagar esta tabela inteira é seguro:
-- na leitura seguinte cada chave se refaz da origem. É por isso que ela não
-- tem FK para nada e nada tem FK para ela — o dia em que alguém precisar
-- limpar, `delete from etl_snapshots` resolve sem consequência.
create table if not exists etl_snapshots (
  -- A chave nomeia a seção e o recorte: 'clientes:lista'. Prefixo com ':' é o
  -- que permite invalidar por família (like 'clientes:%').
  chave       text primary key,
  -- O JSON que alimenta a exibição — nunca dado cru de origem.
  dados       jsonb not null,
  gerado_em   timestamptz not null default now(),
  -- Quanto custou produzir este retrato — é o que responde "valeu a pena?"
  duracao_ms  int,
  -- Versão do FORMATO do JSON. O código só aceita a versão que conhece;
  -- versão diferente é tratada como ausência e o retrato é refeito.
  versao      int not null default 1
);

comment on table etl_snapshots is
  'JSON pronto de exibição por seção do ScopeFinance (D-91). Retrato datado, nunca fonte de verdade — apagar tudo é seguro.';

-- Mesmo tratamento das demais tabelas: o back acessa por service_role (que
-- bypassa RLS); a policy garante que só usuário autenticado leia se alguém
-- usar a anon key.
alter table etl_snapshots enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'etl_snapshots' and policyname = 'etl_snapshots_auth'
  ) then
    execute 'create policy etl_snapshots_auth on etl_snapshots for all to authenticated using (true) with check (true)';
  end if;
end $$;
