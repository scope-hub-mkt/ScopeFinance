-- ════════════════════════════════════════════════════════════════════
--  Contrato → N serviços — 31/08/2026 · decisão do dono
--
--  ⚖️ *"um contrato pode ter N serviços (ligação 1:n) e um serviço deve
--  possuir um contrato; cada cliente possui 1 ou N contratos, mas cada
--  contrato deve ter um cliente"*.
--
--  📐 **O que existia até aqui:** `contratos.servico` era UM texto livre.
--  Um contrato = um serviço, e o nome dele não era um item de catálogo, era
--  uma frase. Vender "Landing Page + Automação" no mesmo contrato só cabia
--  escrevendo as duas coisas na mesma linha de texto — e aí nenhum relatório
--  conseguia mais separá-las.
--
--  ⛔ **Esta migração NÃO apaga `contratos.servico`.** Ele vira **derivado**:
--  um resumo dos itens, mantido por gatilho, para que tudo que já o lê
--  (a ponte com a Dashboard, a tela, os relatórios) continue lendo a verdade
--  em vez de um campo congelado no dia da migração.
--
--  ⛔ Tudo aditivo e idempotente: roda duas vezes sem estragar nada.
-- ════════════════════════════════════════════════════════════════════

-- ════════════════════════ 1. CONTRATO EXIGE CLIENTE ════════════════════════
--
-- ⚖️ A regra é do dono: *"cada contrato deve ter um cliente"*. Ela já era
-- verdade nos dados (medido em 31/08/2026: 3 contratos, 0 sem cliente) e não
-- era verdade no schema — `cliente_id` aceitava nulo e o `on delete set null`
-- ATIVAMENTE criava órfão ao excluir um cliente.
--
-- ⛔ O `on delete set null` era a parte perigosa: apagar um cliente
-- transformava silenciosamente o contrato dele em contrato de ninguém. Com
-- `restrict`, a exclusão passa a ser recusada enquanto houver contrato — que é
-- o que "todo contrato tem um cliente" significa quando se leva a sério.
do $$
declare orfaos int;
begin
  select count(*) into orfaos from contratos where cliente_id is null;
  if orfaos > 0 then
    raise exception
      'Há % contrato(s) sem cliente. Atribua um cliente a cada um antes de aplicar esta migração — inventar um destino aqui seria pior que parar.', orfaos;
  end if;
end $$;

alter table contratos alter column cliente_id set not null;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'contratos_cliente_id_fkey' and conrelid = 'contratos'::regclass
  ) then
    alter table contratos drop constraint contratos_cliente_id_fkey;
  end if;
end $$;

alter table contratos
  add constraint contratos_cliente_id_fkey
  foreign key (cliente_id) references clientes(id) on delete restrict;

comment on column contratos.cliente_id is
  'Todo contrato tem um cliente (decisão do dono, 31/08/2026). on delete restrict: excluir cliente com contrato é recusado, não silenciosamente orfanado.';


-- ════════════════════════ 2. OS ITENS DO CONTRATO ════════════════════════
--
-- 📐 **`servico_id` é opcional de propósito, `descricao` não.**
--
-- O catálogo é da Dashboard (`servicos_espelho` é espelho, não fonte) e nem
-- todo item vendido tem correspondente nele — um escopo fechado sob medida
-- existe, é faturável, e não é item de catálogo. Exigir `servico_id` obrigaria
-- a inventar uma entrada de catálogo para poder faturar.
--
-- ⛔ Mas `descricao` é obrigatória: item sem nome é linha que ninguém sabe
-- explicar na hora de cobrar. Quando `servico_id` existe, `descricao` guarda o
-- nome **como estava na venda** — renomear o serviço no catálogo depois não
-- reescreve o que foi contratado.
create table if not exists contrato_servicos (
  id           uuid primary key default gen_random_uuid(),
  -- ⚖️ *"um serviço deve possuir um contrato"* — `not null` + `cascade`.
  -- Item é parte do contrato, não entidade que sobrevive a ele.
  contrato_id  uuid not null references contratos(id) on delete cascade,
  -- `restrict`: serviço do catálogo com item vendido não some do espelho sem
  -- que alguém veja. É a mesma doutrina de `cliente_servicos.servico_id` na
  -- Dashboard.
  servico_id   uuid references servicos_espelho(id) on delete restrict,
  descricao    text not null check (length(btrim(descricao)) > 0),
  quantidade   int not null default 1 check (quantidade > 0),
  valor        numeric(14,2) not null default 0,
  -- Nulo = herda a frequência do contrato. Preenchido = este item foge dela
  -- (uma implantação única dentro de um contrato mensal, por exemplo).
  recorrencia  text,
  obs          text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table contrato_servicos is
  'Itens de um contrato (1:N). Decisão do dono, 31/08/2026: contrato tem N serviços; serviço vendido pertence a exatamente um contrato.';

create index if not exists idx_contrato_servicos_contrato on contrato_servicos (contrato_id);
create index if not exists idx_contrato_servicos_servico  on contrato_servicos (servico_id);

drop trigger if exists trg_contrato_servicos_upd on contrato_servicos;
create trigger trg_contrato_servicos_upd before update on contrato_servicos
  for each row execute function set_updated_at();


-- ════════════════════════ 3. BACKFILL ════════════════════════
--
-- Cada contrato existente vira um contrato de UM item, com o texto e o valor
-- que ele já tinha. Nada é interpretado: o texto vira `descricao` como está.
--
-- ⛔ **`servico_id` fica NULO de propósito.** Casar "WebDesign - Manutenção
-- Recorrente" com o item `manutencao-webdesign` do catálogo é um palpite, e
-- palpite sobre o que o cliente contratou não é decisão de migração — é
-- decisão de quem vendeu. A tela mostra o item sem vínculo e deixa escolher;
-- é o mesmo princípio de `servico_mapa_finance` na Dashboard, onde o dono
-- edita o mapa em vez de o código adivinhar.
--
-- `not exists` torna o backfill repetível: rodar de novo não duplica item.
insert into contrato_servicos (contrato_id, descricao, valor, recorrencia)
select c.id, btrim(c.servico), c.valor, c.freq
from contratos c
where btrim(coalesce(c.servico, '')) <> ''
  and not exists (select 1 from contrato_servicos cs where cs.contrato_id = c.id);


-- ════════════════════════ 4. `contratos.servico` VIRA DERIVADO ══════════════
--
-- ⚖️ **Por que manter uma coluna que os itens substituem.** Porque ela é lida
-- em lugares que não fazem parte desta mudança — a ponte da Dashboard, o
-- painel, futuros relatórios. Zerá-la quebraria todos eles; congelá-la no
-- valor de hoje seria pior: viraria uma segunda verdade, que passa a mentir no
-- primeiro item adicionado e não avisa.
--
-- Mantida por gatilho, ela nunca discorda dos itens. É resumo, não fonte.
create or replace function contrato_resumo_servicos() returns trigger as $$
declare
  alvo uuid := coalesce(new.contrato_id, old.contrato_id);
  resumo text;
begin
  select string_agg(descricao, ' + ' order by created_at, id)
    into resumo
  from contrato_servicos where contrato_id = alvo;

  update contratos set servico = coalesce(resumo, '') where id = alvo;
  return null;
end $$ language plpgsql;

drop trigger if exists trg_contrato_resumo on contrato_servicos;
create trigger trg_contrato_resumo
  after insert or update or delete on contrato_servicos
  for each row execute function contrato_resumo_servicos();

-- O `not null` continua; o default vazio permite criar o contrato antes do
-- primeiro item, e o gatilho preenche em seguida.
alter table contratos alter column servico set default '';

comment on column contratos.servico is
  'DERIVADO (31/08/2026): resumo dos itens de contrato_servicos, mantido por gatilho. Não escreva aqui — a fonte é contrato_servicos.';

-- Reaplica o resumo em tudo que já existe, para a coluna nascer coerente.
update contratos c
set servico = coalesce(
  (select string_agg(cs.descricao, ' + ' order by cs.created_at, cs.id)
   from contrato_servicos cs where cs.contrato_id = c.id),
  c.servico
);


-- ════════════════════════ 5. TOTAIS POR CONTRATO ════════════════════════
--
-- ⚖️ **`contratos.valor` NÃO passa a ser a soma dos itens.** Ele é o valor
-- acordado, e é dele que a cobrança sai — mexer nisso mudaria dinheiro já
-- contratado, que é exatamente o que `RN-01` proíbe fazer por conta própria.
--
-- A view expõe as duas grandezas lado a lado para que a tela possa **declarar
-- a divergência** quando os itens não somam o total. Divergência declarada é
-- informação; divergência escondida é o defeito que aparece meses depois, num
-- relatório, sem ninguém saber de onde veio.
create or replace view vw_contrato_servicos_totais as
select
  c.id                                                   as contrato_id,
  count(cs.id)                                           as itens,
  coalesce(sum(cs.valor * cs.quantidade), 0)             as valor_itens,
  c.valor                                                as valor_contrato,
  coalesce(sum(cs.valor * cs.quantidade), 0) - c.valor   as diferenca,
  count(cs.id) filter (where cs.servico_id is null)      as itens_sem_catalogo
from contratos c
left join contrato_servicos cs on cs.contrato_id = c.id
group by c.id, c.valor;


-- ════════════════════════ 6. RLS ════════════════════════
-- Mesmo tratamento das demais tabelas: o back-end usa service_role (bypassa),
-- a policy protege o caso de alguém usar a anon key.
alter table contrato_servicos enable row level security;
drop policy if exists "auth_all" on contrato_servicos;
create policy "auth_all" on contrato_servicos
  for all to authenticated using (true) with check (true);


-- ════════════════════ 7. TROCAR OS ITENS DE UMA VEZ ════════════════════
--
-- ⚖️ **Por que uma função, e não N chamadas da API genérica.** Salvar um
-- contrato de três serviços pela API CRUD são quatro requisições HTTP
-- independentes (o contrato e cada item), sem transação entre elas. Uma falha
-- de rede na terceira deixa o contrato gravado com dois serviços — e o dado
-- resultante não é "incompleto", é **errado**: um contrato que diz valer
-- R$ 3.000 exibindo R$ 2.000 em serviços, sem nada indicando que faltou algo.
--
-- Dentro de uma função, tudo acontece numa transação só: ou os três itens
-- ficam, ou nenhum fica. É a diferença entre um erro que o operador vê e
-- repete, e um erro que ele não vê.
--
-- ⛔ **Só mexe no contrato indicado.** O `delete` é escopado por
-- `contrato_id`; um payload vazio esvazia aquele contrato e nada mais.
create or replace function definir_servicos_do_contrato(
  p_contrato uuid,
  p_itens    jsonb
) returns setof contrato_servicos as $$
declare
  ids_mantidos uuid[];
begin
  if not exists (select 1 from contratos where id = p_contrato) then
    raise exception 'Contrato % não existe.', p_contrato;
  end if;

  -- Os itens que o payload traz COM id são os que sobrevivem; o resto do
  -- contrato é removido. `coalesce` cobre o payload vazio, em que o array
  -- agregado vem nulo e `<> all (null)` não removeria nada.
  select coalesce(array_agg((i->>'id')::uuid), '{}')
    into ids_mantidos
  from jsonb_array_elements(p_itens) i
  where nullif(i->>'id', '') is not null;

  delete from contrato_servicos
  where contrato_id = p_contrato
    and id <> all (ids_mantidos);

  update contrato_servicos cs set
    servico_id  = nullif(i->>'servico_id', '')::uuid,
    descricao   = btrim(i->>'descricao'),
    quantidade  = coalesce((i->>'quantidade')::int, 1),
    valor       = coalesce((i->>'valor')::numeric, 0),
    recorrencia = nullif(i->>'recorrencia', ''),
    obs         = nullif(i->>'obs', '')
  from jsonb_array_elements(p_itens) i
  where cs.id = (i->>'id')::uuid
    -- ⛔ A trava contra mover item de contrato por payload forjado: um id de
    -- item de OUTRO contrato não é atualizado aqui e não é apagado acima.
    and cs.contrato_id = p_contrato;

  insert into contrato_servicos (contrato_id, servico_id, descricao, quantidade, valor, recorrencia, obs)
  select
    p_contrato,
    nullif(i->>'servico_id', '')::uuid,
    btrim(i->>'descricao'),
    coalesce((i->>'quantidade')::int, 1),
    coalesce((i->>'valor')::numeric, 0),
    nullif(i->>'recorrencia', ''),
    nullif(i->>'obs', '')
  from jsonb_array_elements(p_itens) i
  where nullif(i->>'id', '') is null;

  return query
    select * from contrato_servicos where contrato_id = p_contrato order by created_at, id;
end $$ language plpgsql;

comment on function definir_servicos_do_contrato(uuid, jsonb) is
  'Troca os N serviços de um contrato numa transação só. Ver PUT /api/contratos/[id]/servicos.';
