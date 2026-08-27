-- ═══════════════════════════════════════════════════════════════════════
-- Tabelas de `8a8abca` (RF-60/61/63) que nunca foram aplicadas no banco.
--
-- O código foi para produção em 27/08/2026 (deploy b7c1ed6) lendo três
-- tabelas que não existem. Efeito medido: GET /api/retencoes_fiscais devolve
-- 500, e como lib/store.tsx carrega os 10 recursos num Promise.all, o
-- AppFrame troca QUALQUER tela pelo banner de erro — inclusive /clientes,
-- que está intacta.
--
-- Extraído literalmente de supabase/schema.sql (linhas 363-406 e 426-456).
-- Idempotente: `if not exists` / `drop policy if exists` em tudo.
--
-- ✅ APLICADO em 27/08/2026 no projeto teewposuwjvoxfgmispn, seguido do
-- schema.sql inteiro (idempotente) e de `notify pgrst, 'reload schema'`.
-- Verificado depois: os 10 recursos de /api respondem 200 em produção.
--
-- ⚠️ O que este arquivo NÃO conserta, e por isso lib/carga.ts existe: a
-- fragilidade do carregador. Aplicar DDL tira ESTE 500 do caminho; não impede
-- que o próximo derrube as dez telas de novo.
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists retencoes_fiscais (
  id              uuid primary key default gen_random_uuid(),
  sigla           text not null,          -- ISS, COFINS, CSLL, INSS, IR, PIS
  nome            text not null,
  percentual      numeric(6,3) not null check (percentual >= 0 and percentual <= 100),
  -- `retido` cobre o `retainIss` do Asaas: para o ISS, "quanto" e "retido na
  -- fonte" são duas perguntas, e a segunda também muda por vigência.
  retido          boolean not null default false,
  vigencia_inicio date not null,
  vigencia_fim    date,
  municipio       text,
  observacao      text,
  ativo           boolean not null default true,
  criado_por      text,
  criado_em       timestamptz not null default now()
);
create index if not exists idx_retencoes_vigencia
  on retencoes_fiscais (vigencia_inicio desc);

-- ⚠️ NENHUMA retenção é semeada, pela mesma razão que a Dashboard não semeia:
-- quais incidem, e com que alíquota, é dado que só o contador tem. Semear "as
-- usuais" faria o sistema reter imposto que talvez não exista. Sem cadastro, a
-- emissão cai no fallback de `ASAAS_NF_*` e **declara** que caiu.

create table if not exists config_fiscal (
  id                       int primary key default 1 check (id = 1),
  municipal_service_code   text,
  municipal_service_id     text,
  municipal_service_name   text,
  atualizado_por           text,
  atualizado_em            timestamptz not null default now()
);

-- RLS — mesmo tratamento das demais.
do $$
declare t text;
begin
  foreach t in array array['retencoes_fiscais','config_fiscal']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "auth_all" on %I', t);
    execute format('create policy "auth_all" on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

create table if not exists ciclos_recorrencia (
  id               uuid primary key default gen_random_uuid(),
  -- O que vai em `assinaturas.ciclo`. Único: duas linhas com a mesma chave
  -- significa que ninguém sabe de quantos meses é o ciclo.
  chave            text not null unique,
  nome             text not null,
  meses            int  not null check (meses >= 1 and meses <= 120),
  -- 'mesmo-dia' | 'dia-fixo' | 'ultimo-dia'
  regra_vencimento text not null default 'mesmo-dia'
                   check (regra_vencimento in ('mesmo-dia', 'dia-fixo', 'ultimo-dia')),
  -- Só para 'dia-fixo'. 31 é aceito e LIMITADO ao último dia do mês destino
  -- pelo código — 31 em fevereiro vira 28/29, nunca 3 de março.
  dia              int check (dia is null or (dia >= 1 and dia <= 31)),
  ativo            boolean not null default true,
  atualizado_por   text,
  atualizado_em    timestamptz not null default now()
);

-- 'dia-fixo' sem dia é um ciclo que não sabe quando vence. A trava é no
-- banco porque a UI não é o único caminho de escrita.
alter table ciclos_recorrencia drop constraint if exists ciclo_dia_fixo_tem_dia;
alter table ciclos_recorrencia add constraint ciclo_dia_fixo_tem_dia
  check (regra_vencimento <> 'dia-fixo' or dia is not null);

do $$
begin
  execute 'alter table ciclos_recorrencia enable row level security';
  execute 'drop policy if exists "auth_all" on ciclos_recorrencia';
  execute 'create policy "auth_all" on ciclos_recorrencia for all to authenticated using (true) with check (true)';
end $$;
