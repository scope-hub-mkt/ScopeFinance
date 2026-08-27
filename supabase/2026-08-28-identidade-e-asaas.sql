-- ═══════════════════════════════════════════════════════════════════════
--  Identidade do cliente + caixas de entrada do Asaas e do CRM
--  Fase 0 do `spec-scope/03-PLANO-DE-IMPLEMENTACAO.md` (§2, §4.4, §7.1, §7.2)
--
--  ⚖️ A decisão que este arquivo materializa (dono, 27/08/2026): *"o dado raiz
--  de informação do cliente nasce do CRM e é criado uma única vez no Scope
--  Finance, onde após isso é propagado para o Asaas e para o Dashboard."*
--  Isso INVERTE o `RN-03` de 21/08/2026, que dava o cadastro-mestre à
--  Dashboard. A decisão antiga não é apagada — é substituída, com data.
--
--  Idempotente: `if not exists` / `drop … if exists` em tudo. Pode rodar de
--  novo sem quebrar.
--
--  ⚠️ MEDIDO ANTES DE ESCREVER (27/08/2026, no banco de produção
--  teewposuwjvoxfgmispn), porque o §7.1.1 avisa que esta tabela NÃO está
--  vazia e que o índice único aborta se houver duplicata:
--
--    select count(*) from clientes;                                  →  7
--    select count(*) from clientes where doc is null or doc = '';    →  0
--    -- colisões de documento normalizado:                           →  0 linhas
--
--  Os dois riscos do §7.1.1 estão limpos: todos os 7 têm documento e nenhum
--  colide. Logo, os 7 nascem `efetivo` e NENHUM cliente ativo sai de
--  faturamento por causa desta migração. O §7.1.1 manda conferir o total de
--  ativos antes e depois — a consulta está no fim deste arquivo.
-- ═══════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════
--  1. CLIENTES — pessoa **E** empresa (`RF-FIN-02`, §7.1)
-- ════════════════════════════════════════════════════════════════════
--
-- Hoje o cadastro aceita dados de pessoa OU de empresa (uma coluna `doc`,
-- um `tipo`). Precisa aceitar **os dois no mesmo registro**: o contato que
-- assina é uma pessoa e o CNPJ que recebe a nota é uma empresa, e os dois
-- são o mesmo cliente.
--
-- ⛔ `doc` e `tel` PERMANECEM. Não são legado a limpar: são o contrato que a
-- Dashboard lê hoje (`lib/integracao/contrato.ts` → `ClienteContrato`).
-- Removê-los quebraria a ponte provada do §3.1/§3.2 do ESTADO para trocar o
-- nome de uma coluna. `doc` passa a ser o documento EXIBIDO; quem responde
-- "esta empresa já é nossa cliente?" é `documento_principal`.

-- ─── pessoa ────────────────────────────────────────────────────────
alter table clientes add column if not exists cpf text;

-- ─── empresa ───────────────────────────────────────────────────────
alter table clientes add column if not exists cnpj           text;
alter table clientes add column if not exists razao_social   text;
alter table clientes add column if not exists nome_fantasia  text;

-- ─── identidade e vínculos (§2.1) ──────────────────────────────────
--
-- As três chaves respondem perguntas diferentes, e usar uma no papel da
-- outra é o erro que o §2.1 existe para impedir:
--
--   documento_principal → "esta empresa já é nossa cliente?"   (identidade)
--   crm_id              → "este card já foi processado?"       (anti-reprocessamento)
--   asaas_customer_id   → "que cadastro do gateway é este?"    (vínculo)
--
-- ⛔ `crm_id` NÃO serve como chave de identidade: dois cards diferentes da
-- mesma empresa têm `crm_id` diferentes e SÃO o mesmo cliente.
alter table clientes add column if not exists documento_principal text;
alter table clientes add column if not exists crm_id              text;
-- `asaas_customer_id` já existe desde o schema original.

-- ─── estado do cadastro (§2.3) ─────────────────────────────────────
--
-- ⚠️ O default é 'provisorio' e vale para LINHA NOVA. Cliente que já existe
-- e já é cobrado não pode virar provisório de uma hora para outra — pelo
-- §2.3 ele pararia de contar em faturamento e MRR, e os números de todo
-- mundo mudariam sem explicação. O backfill do bloco 3 resolve isso.
alter table clientes add column if not exists status_cadastro text not null default 'provisorio';

do $$ begin
  alter table clientes add constraint clientes_status_cadastro_chk
    check (status_cadastro in ('provisorio', 'efetivo', 'em_conflito'));
exception when duplicate_object then null; end $$;

comment on column clientes.status_cadastro is
  '§2.3: provisorio = criado pelo CRM sem documento válido (NÃO cria customer no Asaas, NÃO emite NFS-e, NÃO entra em faturamento/MRR/comissão). efetivo = documento presente e sem conflito. em_conflito = o documento já pertence a outro cliente; decisão humana (§2.4).';

comment on column clientes.documento_principal is
  '§2.2: somente os DÍGITOS de (cnpj se houver, senão cpf). CNPJ vence CPF — a nota é emitida contra a pessoa jurídica. Mantido por trigger, não pela aplicação.';

-- ─── procedência (§7.1) ────────────────────────────────────────────
--
-- 📐 O plano §7.1 pede uma coluna `origem_cadastro`. Ela NÃO é criada aqui,
-- e o desvio é deliberado: `clientes.origem` já existe desde 25/08/2026,
-- já está preenchida nas 7 linhas, é escrita por `lib/integracao/sincronia.ts`
-- e fica FORA das colunas graváveis de `lib/resources.ts` de propósito.
-- Uma segunda coluna para o mesmo fato criaria as duas verdades que o próprio
-- plano proíbe no §5.1 ("dois catálogos são dois preços"). O que muda é o
-- domínio: `origem` passa a aceitar as quatro origens do §7.1.
--
--   'scopefinance' → digitado aqui          (o 'finance' do plano)
--   'dashboard'    → chegou pela replicação
--   'crm'          → nasceu em Validação Contratual  (novo)
--   'asaas'        → conciliado do gateway           (novo)
alter table clientes drop constraint if exists clientes_origem_chk;
alter table clientes add constraint clientes_origem_chk
  check (origem in ('scopefinance', 'dashboard', 'crm', 'asaas'));


-- ════════════════════════════════════════════════════════════════════
--  2. A trigger que mantém a identidade — e por que não é a aplicação
-- ════════════════════════════════════════════════════════════════════
--
-- ⚖️ §2.2 manda que a comparação NUNCA aconteça sobre o texto formatado, e
-- que seja o índice — não o código — a garantir a regra. Uma trigger é a
-- outra metade disso: existem quatro caminhos de escrita nesta tabela (o
-- CRUD da tela, a replicação da Dashboard, a reconciliação, e o backfill do
-- Asaas que vem na Fase 2). Normalizar na aplicação obrigaria os quatro a
-- lembrar; normalizar aqui é uma vez só, e vale inclusive para o `psql` de
-- alguém com pressa.
create or replace function set_documento_principal() returns trigger as $$
declare
  cpf_norm  text := nullif(regexp_replace(coalesce(new.cpf,  ''), '\D', '', 'g'), '');
  cnpj_norm text := nullif(regexp_replace(coalesce(new.cnpj, ''), '\D', '', 'g'), '');
  doc_norm  text := nullif(regexp_replace(coalesce(new.doc,  ''), '\D', '', 'g'), '');
begin
  -- Guarda os dígitos, sempre. "12.345.678/0001-90" e "12345678000190" são o
  -- mesmo cliente, e essa igualdade tem de existir no dado, não na consulta.
  new.cpf  := cpf_norm;
  new.cnpj := cnpj_norm;

  -- Legado: linha que só tem `doc` continua tendo identidade. 14 dígitos é
  -- CNPJ, 11 é CPF; qualquer outro comprimento é documento que ninguém sabe
  -- classificar — vira identidade mesmo assim, mas não preenche cpf/cnpj.
  if cnpj_norm is null and doc_norm is not null and length(doc_norm) = 14 then
    cnpj_norm := doc_norm;
    new.cnpj  := doc_norm;
  elsif cpf_norm is null and doc_norm is not null and length(doc_norm) = 11 then
    cpf_norm := doc_norm;
    new.cpf  := doc_norm;
  end if;

  -- §2.2: CNPJ vence CPF quando os dois existem. O motivo é fiscal.
  new.documento_principal := coalesce(cnpj_norm, cpf_norm, doc_norm);

  -- `doc` continua sendo o que a Dashboard lê. Sem isto, um cliente criado
  -- pelo CRM (que manda cnpj) chegaria lá com `doc` nulo, e o consumidor
  -- perderia justamente a chave de conciliação dele.
  if new.doc is null or btrim(new.doc) = '' then
    new.doc := new.documento_principal;
  end if;

  -- `tipo` deixa de ser digitado errado: quem tem CNPJ é PJ.
  if cnpj_norm is not null then
    new.tipo := 'Pessoa Jurídica';
  elsif cpf_norm is not null then
    new.tipo := 'Pessoa Física';
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_clientes_documento on clientes;
create trigger trg_clientes_documento
  before insert or update on clientes
  for each row execute function set_documento_principal();


-- ════════════════════════════════════════════════════════════════════
--  3. BACKFILL — na ordem do §7.1.1: primeiro o documento, depois o estado
-- ════════════════════════════════════════════════════════════════════
--
-- ⚠️ Um `update` vazio dispara a trigger acima, que faz todo o trabalho de
-- normalização. É por isso que o comando abaixo parece não fazer nada.
update clientes set doc = doc;

-- ⛔ Cliente que já existe e já é cobrado NÃO vira provisório. Só quem
-- ficaria sem documento nenhum cai em `provisorio` — e, medido hoje, isso é
-- ninguém.
update clientes
   set status_cadastro = case
         when documento_principal is not null then 'efetivo'
         else 'provisorio'
       end
 where status_cadastro = 'provisorio';


-- ════════════════════════════════════════════════════════════════════
--  4. OS ÍNDICES ÚNICOS — a regra mora aqui, não no código
-- ════════════════════════════════════════════════════════════════════
--
-- ⚠️ Se algum destes FALHAR ao rodar, ele está funcionando: significa que já
-- existe duplicata na base. Medido em 27/08/2026: nenhuma. A consulta de
-- diagnóstico, para quando isso mudar:
--
--   select documento_principal, count(*), array_agg(id)
--   from clientes where documento_principal is not null
--   group by 1 having count(*) > 1;
--
-- ⛔ Cada colisão é decisão humana (§2.4), nunca um `delete`: resolver na
-- marra apaga um cadastro que pode ter nota fiscal emitida contra ele.
create unique index if not exists ux_clientes_documento_principal
  on clientes (documento_principal) where documento_principal is not null;

-- §3.5: o mesmo card entregue duas vezes ATUALIZA o cliente existente e
-- devolve o mesmo `cliente_id`. Nunca cria o segundo.
create unique index if not exists ux_clientes_crm_id
  on clientes (crm_id) where crm_id is not null;

-- Sem isto, o cliente que entra pelo link de pagamento do Asaas vira
-- duplicata do que veio do CRM.
create unique index if not exists ux_clientes_asaas_customer
  on clientes (asaas_customer_id) where asaas_customer_id is not null;

-- A fila do §2.3 é lida pelo mais antigo primeiro — é o que impede o estado
-- provisório de virar um cemitério silencioso de cadastros pela metade.
create index if not exists idx_clientes_status_cadastro
  on clientes (status_cadastro, created_at)
  where status_cadastro <> 'efetivo';

-- O índice de 25/08 sobre `doc` continua valendo e não conflita: ele guarda
-- a coluna exibida, o novo guarda a identidade. Manter os dois é barato e
-- pega a escrita que passar por qualquer um dos caminhos.


-- ════════════════════════════════════════════════════════════════════
--  5. VALOR CONTRATADO × VALOR COBRADO (§4.7)
-- ════════════════════════════════════════════════════════════════════
--
-- ⚖️ O conflito "o valor foi editado no Finance e depois chegou
-- PAYMENT_UPDATED do Asaas, quem ganha?" desaparece quando os dois fatos
-- deixam de disputar o mesmo campo. Não é uma flag `valor_editado_manualmente`:
-- são colunas distintas, porque não são versões do mesmo número — são
-- **fatos diferentes**. Uma flag obriga o sistema a escolher uma verdade e
-- apagar a outra; duas colunas guardam as duas e deixam a divergência visível.
--
--   valor_contratado → o que foi combinado com o cliente.  Dono: ScopeFinance.  Editável (RN-03).
--   valor_cobrado    → o que o Asaas efetivamente cobrou.  Dono: Asaas.         ⛔ espelho, nunca editável.
--   valor_liquido    → o que sobrou depois da taxa.        Dono: Asaas.         ⛔ espelho, nunca editável.
alter table contas_receber add column if not exists valor_contratado numeric(14,2);
alter table contas_receber add column if not exists valor_cobrado    numeric(14,2);
alter table contas_receber add column if not exists valor_liquido    numeric(14,2);
alter table contas_receber add column if not exists asaas_status     text;

comment on column contas_receber.valor_liquido is
  '§4.10: base da comissão é `netValue`, não `value` — comissionar sobre o bruto é pagar comissão sobre dinheiro que a Scope não recebeu.';

-- O que já existe foi combinado com o cliente por definição: não houve
-- gateway nenhum nessas 14 linhas.
update contas_receber set valor_contratado = valor where valor_contratado is null;

-- Idempotência do espelho do gateway. Sem estes índices, uma reentrega do
-- Asaas (que é `at least once`, `RN-AS-02`) criaria a segunda cobrança — e a
-- receita seria contada duas vezes.
create unique index if not exists ux_receber_asaas_payment
  on contas_receber (asaas_payment_id) where asaas_payment_id is not null;
create unique index if not exists ux_assinaturas_asaas_subscription
  on assinaturas (asaas_subscription_id) where asaas_subscription_id is not null;
create unique index if not exists ux_notas_asaas_invoice
  on notas_fiscais (asaas_invoice_id) where asaas_invoice_id is not null;


-- ════════════════════════════════════════════════════════════════════
--  6. CAIXA DE ENTRADA DO ASAAS (§4.4)
-- ════════════════════════════════════════════════════════════════════
--
-- ⛔ Tudo que chega é gravado ANTES de ser processado. É a doutrina de caixa
-- de entrada que os dois sistemas já seguem (`integracao_recebidos`), e é o
-- que torna qualquer problema **reprocessável** em vez de perdido.
create table if not exists asaas_webhook_events (
  -- O `id` do próprio evento (evt_…). `insert … on conflict do nothing`
  -- resolve o `RN-AS-02` em uma linha — e é o banco garantindo, não o código
  -- lembrando.
  id              text primary key,
  event_type      text not null,
  entity_type     text,                              -- payment | subscription | invoice | checkout | account | token
  entity_id       text,                              -- pay_… | sub_… | inv_…
  -- ⛔ O JSON CRU, íntegro, SEMPRE — inclusive o de evento que o código não
  -- sabe tratar. É a única coisa que permite reprocessar depois de descobrir
  -- um bug, e não custa nada.
  payload         jsonb not null,
  received_at     timestamptz not null default now(),
  processed_at    timestamptz,
  process_status  text not null default 'pending',   -- pending | done | failed | ignored
  process_error   text,
  attempts        int not null default 0
);

do $$ begin
  alter table asaas_webhook_events add constraint asaas_events_status_chk
    check (process_status in ('pending', 'done', 'failed', 'ignored'));
exception when duplicate_object then null; end $$;

create index if not exists idx_asaas_events_entidade
  on asaas_webhook_events (entity_type, entity_id);
-- A varredura do §4.5 (a rede de segurança do `after()` que morreu no meio)
-- lê exatamente por aqui.
create index if not exists idx_asaas_events_fila
  on asaas_webhook_events (process_status, received_at)
  where process_status in ('pending', 'failed');


-- ════════════════════════════════════════════════════════════════════
--  7. CAIXA DE ENTRADA DO CRM (§7.2)
-- ════════════════════════════════════════════════════════════════════
--
-- Mesmo formato, pela mesma razão. A chave é o `id_externo_crm`: é ele que
-- responde "este card já foi processado?" e o que faz o card sair da coluna
-- e voltar não criar um segundo cliente (§3.5).
create table if not exists crm_webhook_events (
  id              uuid primary key default gen_random_uuid(),
  id_externo_crm  text not null,
  event_type      text not null,
  payload         jsonb not null,
  received_at     timestamptz not null default now(),
  processed_at    timestamptz,
  process_status  text not null default 'pending',
  process_error   text,
  cliente_id      uuid references clientes(id) on delete set null,
  attempts        int not null default 0
);

do $$ begin
  alter table crm_webhook_events add constraint crm_events_status_chk
    check (process_status in ('pending', 'done', 'failed', 'ignored', 'conflito'));
exception when duplicate_object then null; end $$;

create index if not exists idx_crm_events_externo on crm_webhook_events (id_externo_crm, received_at desc);
create index if not exists idx_crm_events_fila
  on crm_webhook_events (process_status, received_at)
  where process_status in ('pending', 'failed');


-- ════════════════════════════════════════════════════════════════════
--  8. ESPELHO DO CATÁLOGO DE SERVIÇOS (§5)
-- ════════════════════════════════════════════════════════════════════
--
-- ✅ Decidido: **a Dashboard é a dona do catálogo; o Finance recebe uma cópia.**
-- O item de menu `Serviços` existe (o board pede, e ele é necessário para
-- vincular serviço a cobrança), mas mostra um espelho SOMENTE LEITURA, com
-- link para editar na Dashboard.
--
-- ⛔ Por que não dois catálogos editáveis: dois catálogos são dois preços
-- para o mesmo serviço. A divergência não aparece no dia em que nasce —
-- aparece meses depois, num relatório, quando já contaminou proposta
-- comercial e comissão apurada.
--
-- 📐 O `id` é o MESMO dos dois lados (`ESTADO §8.4`), e é isso que mantém
-- cobrança já gravada apontando para serviço válido.
create table if not exists servicos_espelho (
  id             uuid primary key,
  nome           text not null,
  slug           text,
  area           text,
  tipo_cobranca  text,
  preco_tabela   numeric(14,2),
  custo          numeric(14,2),
  recorrencia    text,
  ativo          boolean not null default true,
  -- `servico.encerrado` marca inativo — NUNCA apaga, porque há cobrança
  -- histórica apontando para ele.
  encerrado_em   timestamptz,
  sincronizado_em timestamptz not null default now(),
  fonte          text not null default 'dashboard'
);
create index if not exists idx_servicos_espelho_ativo on servicos_espelho (ativo, nome);


-- ════════════════════════════════════════════════════════════════════
--  9. RLS — mesmo tratamento das demais tabelas
-- ════════════════════════════════════════════════════════════════════
-- O back-end acessa por service_role (bypassa RLS). As policies garantem que
-- somente usuário autenticado leia/escreva se a anon key for usada.
do $$
declare t text;
begin
  foreach t in array array['asaas_webhook_events','crm_webhook_events','servicos_espelho']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "auth_all" on %I', t);
    execute format('create policy "auth_all" on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;


-- ════════════════════════════════════════════════════════════════════
--  10. CONFERÊNCIA — o §7.1.1 manda comparar antes e depois
-- ════════════════════════════════════════════════════════════════════
--
--   select status_cadastro, count(*) from clientes group by 1;
--   select count(*) from clientes where status = 'Ativo';   -- tem de ser o MESMO de antes
--   select count(*) from clientes where documento_principal is null;
--
-- ⚠️ Se o total de ativos mudar, alguma coisa saiu do lugar — e é muito mais
-- barato descobrir isso no minuto seguinte ao `update` do que no fechamento
-- do mês.
