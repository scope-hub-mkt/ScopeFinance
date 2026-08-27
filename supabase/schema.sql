-- ════════════════════════════════════════════════════════════════════
--  ScopeFinance — schema Postgres (Supabase)
--  Rode no SQL Editor do Supabase (cole tudo e execute) OU via CLI.
--  É idempotente: pode rodar de novo sem quebrar.
-- ════════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";

-- ─── util: atualiza updated_at ──────────────────────────────────────
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ════════════════════════ CLIENTES ════════════════════════
create table if not exists clientes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  tipo text not null default 'Pessoa Física',          -- Pessoa Física | Pessoa Jurídica
  doc text,                                             -- CPF / CNPJ
  email text,
  tel text,
  status text not null default 'Ativo',                 -- Ativo | Inativo | Prospect
  endereco text,
  obs text,
  asaas_customer_id text,                               -- vínculo futuro com Asaas
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ════════════════════════ BANCOS ════════════════════════
create table if not exists bancos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  banco text,
  tipo text not null default 'Conta corrente',          -- Conta corrente | poupança | digital
  saldo numeric(14,2) not null default 0,               -- ajustado automaticamente por lançamentos
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ════════════════════════ CARTÕES ════════════════════════
create table if not exists cartoes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  bandeira text default 'Visa',
  limite numeric(14,2) not null default 0,
  usado numeric(14,2) not null default 0,
  fechamento int,                                        -- dia do fechamento
  vencimento int,                                        -- dia do vencimento
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ════════════════════════ CONTRATOS ════════════════════════
create table if not exists contratos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid references clientes(id) on delete set null,
  servico text not null,
  valor numeric(14,2) not null default 0,
  freq text not null default 'Único',                    -- Único | Mensal | Trimestral | Anual
  categoria text default 'WebDesign',                    -- WebDesign | Automação | IA | CRM | Consultoria | Outro
  inicio date,
  fim date,
  status text not null default 'Ativo',                  -- Ativo | Pausado | Encerrado | Em negociação
  obs text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ════════════════════════ ASSINATURAS ════════════════════════
-- direcao = 'receber'  -> cliente assina o CRM/serviço da Scope  -> gera CONTAS A RECEBER
-- direcao = 'pagar'    -> a Scope assina uma ferramenta/serviço  -> gera CONTAS A PAGAR
create table if not exists assinaturas (
  id uuid primary key default gen_random_uuid(),
  direcao text not null default 'receber',               -- receber | pagar
  cliente_id uuid references clientes(id) on delete set null,   -- quando receber
  fornecedor text,                                       -- quando pagar
  descricao text,
  plano text,                                            -- Starter | Pro | Business | Enterprise (CRM)
  categoria text,                                        -- p/ pagar: Software/SaaS, Infraestrutura...
  valor numeric(14,2) not null default 0,
  ciclo text not null default 'mensal',                  -- mensal | trimestral | anual
  dia_venc int,                                          -- dia do mês (1-31)
  inicio date not null default current_date,
  proximo_venc date,                                     -- próxima data a gerar cobrança/conta
  fim date,                                              -- término (null = sem fim)
  conta_id uuid references bancos(id) on delete set null,
  status text not null default 'Ativa',                  -- Ativa | Suspensa | Cancelada
  asaas_subscription_id text,                            -- vínculo futuro com Asaas
  obs text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ════════════════════════ CONTAS A RECEBER ════════════════════════
create table if not exists contas_receber (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid references clientes(id) on delete set null,
  contrato_id uuid references contratos(id) on delete set null,
  assinatura_id uuid references assinaturas(id) on delete set null,
  descricao text not null,
  valor numeric(14,2) not null default 0,
  vencimento date,
  status text not null default 'Pendente',               -- Pendente | Pago | Vencido | Cancelado
  forma_pagamento text default 'PIX',
  pago_em date,
  conta_id uuid references bancos(id) on delete set null,
  competencia date,                                      -- mês de referência (recorrência)
  asaas_payment_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assinatura_id, competencia)                    -- não duplica a cobrança do mesmo ciclo
);

-- ════════════════════════ CONTAS A PAGAR ════════════════════════
create table if not exists contas_pagar (
  id uuid primary key default gen_random_uuid(),
  fornecedor text not null,
  assinatura_id uuid references assinaturas(id) on delete set null,
  descricao text not null,
  valor numeric(14,2) not null default 0,
  vencimento date,
  categoria text default 'Infraestrutura',
  status text not null default 'Pendente',
  pago_em date,
  conta_id uuid references bancos(id) on delete set null,
  competencia date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assinatura_id, competencia)
);

-- ════════════════════════ LANÇAMENTOS ════════════════════════
create table if not exists lancamentos (
  id uuid primary key default gen_random_uuid(),
  tipo text not null,                                    -- entrada | saida
  descricao text not null,
  valor numeric(14,2) not null default 0,
  data date not null default current_date,
  categoria text,
  conta_id uuid references bancos(id) on delete set null,
  origem text default 'manual',                          -- manual | receber | pagar
  origem_id uuid,
  created_at timestamptz not null default now()
);

-- ════════════════════════ NOTAS FISCAIS (NFS-e via Asaas) ════════════════════════
create table if not exists notas_fiscais (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid references clientes(id) on delete set null,
  conta_receber_id uuid references contas_receber(id) on delete set null,
  descricao_servico text,
  valor numeric(14,2) not null default 0,
  status text not null default 'Pendente',               -- Pendente | Agendada | Emitida | Cancelada | Erro
  asaas_invoice_id text,
  numero text,
  data_emissao date,
  pdf_url text,
  xml_url text,
  payload jsonb,
  erro text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─── índices úteis ──────────────────────────────────────────────────
create index if not exists idx_receber_status on contas_receber(status);
create index if not exists idx_receber_venc on contas_receber(vencimento);
create index if not exists idx_pagar_status on contas_pagar(status);
create index if not exists idx_pagar_venc on contas_pagar(vencimento);
create index if not exists idx_assin_status on assinaturas(status);
create index if not exists idx_assin_prox on assinaturas(proximo_venc);
create index if not exists idx_lanc_data on lancamentos(data);

-- ════════════════════════ TRIGGERS ════════════════════════

-- updated_at automático
do $$
declare t text;
begin
  foreach t in array array['clientes','bancos','cartoes','contratos','assinaturas','contas_receber','contas_pagar','notas_fiscais']
  loop
    execute format('drop trigger if exists trg_updated_%1$s on %1$s', t);
    execute format('create trigger trg_updated_%1$s before update on %1$s for each row execute function set_updated_at()', t);
  end loop;
end $$;

-- Ajuste automático do saldo do banco a cada lançamento (append-only: insert/delete)
create or replace function apply_lancamento_saldo() returns trigger as $$
begin
  if (tg_op = 'INSERT') then
    if new.conta_id is not null then
      update bancos
        set saldo = saldo + (case when new.tipo = 'entrada' then new.valor else -new.valor end),
            updated_at = now()
        where id = new.conta_id;
    end if;
    return new;
  elsif (tg_op = 'DELETE') then
    if old.conta_id is not null then
      update bancos
        set saldo = saldo - (case when old.tipo = 'entrada' then old.valor else -old.valor end),
            updated_at = now()
        where id = old.conta_id;
    end if;
    return old;
  end if;
  return null;
end;
$$ language plpgsql;

drop trigger if exists trg_lancamento_saldo on lancamentos;
create trigger trg_lancamento_saldo
  after insert or delete on lancamentos
  for each row execute function apply_lancamento_saldo();

-- ════════════════════════ RLS (Row Level Security) ════════════════════════
-- O back-end acessa via service_role (bypassa RLS). As policies abaixo
-- garantem que somente usuários autenticados leiam/escrevam se a anon key for usada.
do $$
declare t text;
begin
  foreach t in array array['clientes','bancos','cartoes','contratos','assinaturas','contas_receber','contas_pagar','lancamentos','notas_fiscais']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "auth_all" on %I', t);
    execute format('create policy "auth_all" on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════
--  INTEGRAÇÃO COM A SCOPE DASHBOARD — 25/08/2026
--
--  Contexto: `docs/03-CONTRATO-DE-INTEGRACAO ✅.md` da Dashboard e o
--  Gate G0 (`docs/tasks/02-ROTEIRO-GATE-G0 ✅.md`), assinado em 21/08/2026.
--
--  A relação entre os dois sistemas foi definida pelo dono em 25/08/2026:
--  **não é hierarquia, é papel.** A Dashboard é o CEO, o ScopeFinance é o
--  CFO — poderes equivalentes, funções distintas, **núcleo de dados
--  compartilhado**. O cadastro de cliente nasce em qualquer um dos dois e
--  replica para o outro **com o mesmo `id`**.
--
--  É esse "mesmo id" que faz a replicação bidirecional não gerar as duas
--  verdades do conflito 4.3 do `00-LEVANTAMENTO`: sem ele, cada lado
--  geraria um uuid próprio e a mesma empresa teria duas identidades.
-- ════════════════════════════════════════════════════════════════════

-- ─── 1. Unicidade do documento (Gate G0 Ponto 1, decisão `D-19`) ────
--
-- ⚠️ Se este índice FALHAR ao rodar, ele está funcionando: significa que já
-- existem CNPJs duplicados na base. Rode a query de diagnóstico abaixo,
-- resolva as duplicatas e rode o schema de novo.
--
--   select regexp_replace(doc,'[^0-9]','','g') as doc_norm, count(*), array_agg(id)
--   from clientes where doc is not null and doc <> ''
--   group by 1 having count(*) > 1;
--
-- Índice FUNCIONAL, não `unique (doc)`: "12.345.678/0001-90" e
-- "12345678000190" são o mesmo CNPJ e passariam os dois por um unique cru —
-- a restrição existiria sem impedir a duplicata que promete impedir.
-- É a mesma normalização que a tabela `clientes` da Dashboard já aplica.
create unique index if not exists ux_clientes_doc_norm
  on clientes (regexp_replace(doc, '[^0-9]', '', 'g'))
  where doc is not null and doc <> '';

-- ─── 2. Procedência do cadastro (RNF-19 da Dashboard) ───────────────
-- Todo dado declara de onde veio. Um cliente que chegou pela Dashboard e um
-- que foi digitado aqui não são a mesma coisa na hora de auditar.
alter table clientes add column if not exists origem text not null default 'scopefinance';
alter table clientes add column if not exists sincronizado_em timestamptz;
do $$ begin
  alter table clientes add constraint clientes_origem_chk
    check (origem in ('scopefinance','dashboard'));
exception when duplicate_object then null; end $$;

-- ─── 3. Base LÍQUIDA da comissão (RN-04 da Dashboard) ───────────────
-- `valor` é o que foi cobrado; `valor_pago` é o que entrou de fato (pode
-- divergir: desconto, juros, pagamento parcial). `deducoes` são tributos e
-- taxas retidos. A comissão da Dashboard calcula sobre (pago − deduções) —
-- calcular sobre o bruto pagaria comissão sobre dinheiro que a Scope não viu.
alter table contas_receber add column if not exists valor_pago numeric(14,2);
alter table contas_receber add column if not exists deducoes numeric(14,2) not null default 0;

-- ─── 4. Idempotência do lançamento de comissão (RN-14 da Dashboard) ─
-- A Dashboard manda a comissão aprovada para cá. Sem esta coluna, um retry
-- de rede lançaria a mesma comissão duas vezes — e ninguém notaria até o
-- fechamento do mês.
alter table contas_pagar add column if not exists referencia_externa text;
create unique index if not exists ux_pagar_ref_externa
  on contas_pagar (referencia_externa) where referencia_externa is not null;

-- ─── 5. Caixa de entrada de eventos (o que a Dashboard nos manda) ───
-- Grava ANTES de processar: nada se perde, tudo é auditável e reprocessável.
-- `evento_id` único é o que torna a entrega idempotente — a Dashboard tem
-- escada de retry, então receber o mesmo evento duas vezes é o normal, não a
-- exceção.
create table if not exists integracao_recebidos (
  id uuid primary key default gen_random_uuid(),
  evento_id text not null unique,
  evento_tipo text not null,
  payload jsonb not null,
  processado boolean not null default false,
  processado_em timestamptz,
  erro text,
  recebido_em timestamptz not null default now()
);
create index if not exists idx_recebidos_pend on integracao_recebidos(processado, recebido_em);

-- ─── 6. Outbox de eventos (o que MANDAMOS para a Dashboard) ─────────
-- Mesmo padrão da Dashboard (`03` §4.4) e pela mesma razão: gravar o evento
-- e entregá-lo são passos distintos, senão a Dashboard fora do ar passa a
-- travar o cadastro de cliente daqui.
create table if not exists integracao_enviados (
  id uuid primary key default gen_random_uuid(),
  evento_tipo text not null,
  payload jsonb not null,
  entregue boolean not null default false,
  entregue_em timestamptz,
  tentativas int not null default 0,
  ultimo_status int,
  ultimo_erro text,
  proxima_tentativa_em timestamptz not null default now(),
  criado_em timestamptz not null default now()
);
create index if not exists idx_enviados_fila
  on integracao_enviados(entregue, proxima_tentativa_em) where entregue = false;

-- RLS das tabelas novas — mesmo tratamento das demais.
do $$
declare t text;
begin
  foreach t in array array['integracao_recebidos','integracao_enviados']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "auth_all" on %I', t);
    execute format('create policy "auth_all" on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ════════════════════════ FISCAL — RF-60, RF-61, RN-43 ════════════════════════
--
-- ⚖️ Por que estas duas tabelas existem, e por que só uma tem vigência.
--
-- Até 27/08/2026 as alíquotas da NFS-e viviam em `ASAAS_NF_*` — variável de
-- ambiente, **sem data nenhuma**. O problema não é a inconveniência do
-- redeploy: é que uma alíquota sem vigência **reescreve nota já emitida**.
-- Corrigir o ISS de 3% para 5% hoje passaria a calcular agosto a 5%, e um mês
-- fechado que muda sozinho é defeito de auditoria, não de configuração.
--
-- O modelo aqui é cópia deliberada do que a Dashboard já provou em `RF-53`
-- (`retencoes_fiscais` lá): alíquota + vigência datada, e o cálculo lê a
-- vigência **da data do fato gerador**. `RN-43` generaliza a regra para os
-- dois sistemas.
--
-- ⛔ `config_fiscal` NÃO tem vigência, e a assimetria é intencional (`RF-61`):
-- o código de serviço municipal muda quando o município troca de tabela, não
-- por competência. Versioná-lo por data seria cerimônia sem auditoria a
-- proteger — é N2, e N2 é o nível certo para ele.

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

-- ═══════════════════ CICLOS DE RECORRÊNCIA — RF-63 ═══════════════════
--
-- ⚖️ Fecha `C-4` do PLANO-UNIFICADO-SCOPE.md §5 — a última das quatro da
-- régua, e a única que continuava em N0. Até 27/08/2026 o ciclo era um
-- ternário em `lib/format.ts`: vender um plano semestral exigia editar
-- código e fazer deploy.
--
-- ⛔ SEM VIGÊNCIA, e a assimetria com `retencoes_fiscais` é deliberada.
-- Alíquota sem vigência reescreve nota já emitida; definição de ciclo não
-- reescreve conta nenhuma, porque cada conta gerada guarda a própria
-- `competencia` e o próprio `vencimento`. É N2, e N2 é o nível certo.
--
-- ⚠️ NADA é semeado aqui. `mensal`/`trimestral`/`anual` vivem em
-- `CICLOS_EMBUTIDOS` (lib/ciclos.ts) e são o PISO: o sistema funciona com a
-- tabela vazia — ou inexistente. O cadastro SOBREPÕE por `chave`, nunca
-- mescla (mesma decisão de `D-52` no fiscal): cadastrar `mensal` com
-- `dia-fixo: 5` substitui o mensal embutido.

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
