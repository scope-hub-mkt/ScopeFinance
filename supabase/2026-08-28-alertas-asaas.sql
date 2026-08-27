-- ═══════════════════════════════════════════════════════════════════════
--  Onde vão parar os eventos que pedem um humano — Fase 7, §4.8 ondas 2 e 3.
--
--  ⚖️ **O problema que esta tabela resolve.** Os 54 eventos P1 e P2 vinham
--  sendo gravados desde o dia 1 e marcados `ignored`: o dado guardado, a regra
--  inexistente. Isso estava certo enquanto a regra não existia — mas metade
--  deles não é telemetria, é **pedido de atenção**: chargeback aberto,
--  negativação, cartão recusado na captura, conta do gateway reprovada,
--  chave de API expirando.
--
--  ⛔ Deixá-los só em `asaas_webhook_events` significaria que a única forma de
--  saber que houve um chargeback é alguém rodar um `select` na caixa de
--  entrada. É a mesma classe de defeito do §2.3: um estado que importa e que
--  ninguém vê. **Ausência de tela é ausência de aviso.**
--
--  ⚖️ **Por que uma tabela e não uma coluna em `asaas_webhook_events`.** Um
--  evento é o que o Asaas disse; um alerta é o que alguém precisa fazer. Os
--  dois têm ciclos de vida diferentes — o evento nunca muda depois de gravado
--  (é registro de auditoria, §15.4), o alerta é resolvido. Misturá-los faria
--  "resolver um alerta" virar edição de registro de auditoria.
--
--  Idempotente.
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists asaas_alertas (
  id           uuid primary key default gen_random_uuid(),
  -- ⛔ Sem `on delete cascade`: linha de caixa de entrada nunca é apagada
  -- (§15.4), então a cascata seria letra morta — e declará-la sugeriria que
  -- apagar evento é uma operação prevista. Não é.
  evento_id    text not null references asaas_webhook_events(id),
  event_type   text not null,

  -- cobranca | fiscal | conta | seguranca
  categoria    text not null,
  -- critico  → alguém perde dinheiro ou a operação para
  -- atencao  → precisa de decisão, mas não é urgente
  severidade   text not null default 'atencao',

  titulo       text not null,
  detalhe      text,

  entity_type  text,
  entity_id    text,
  cliente_id   uuid references clientes(id) on delete set null,
  -- O que o alerta custa, quando dá para dizer. Chargeback de R$ 5.000 e de
  -- R$ 50 não são a mesma urgência, e a fila precisa poder ordenar por isso.
  valor        numeric(14,2),

  criado_em    timestamptz not null default now(),
  resolvido_em timestamptz,
  resolvido_por text,
  observacao   text
);

do $$ begin
  alter table asaas_alertas add constraint asaas_alertas_categoria_chk
    check (categoria in ('cobranca', 'fiscal', 'conta', 'seguranca'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table asaas_alertas add constraint asaas_alertas_severidade_chk
    check (severidade in ('critico', 'atencao'));
exception when duplicate_object then null; end $$;

-- ⛔ Um evento gera **um** alerta. A entrega do Asaas é `at least once`
-- (`RN-AS-02`) e a varredura do §4.5 reprocessa o que ficou `failed` — sem
-- esta restrição, o mesmo chargeback apareceria três vezes na fila e ninguém
-- saberia se são três disputas ou uma reprocessada.
create unique index if not exists ux_asaas_alertas_evento
  on asaas_alertas (evento_id);

-- A fila lê sempre "o que está aberto, mais crítico primeiro, mais antigo
-- primeiro". O índice parcial serve exatamente essa consulta e não paga por
-- alerta já resolvido, que é a maioria com o tempo.
create index if not exists idx_asaas_alertas_abertos
  on asaas_alertas (severidade, criado_em) where resolvido_em is null;

create index if not exists idx_asaas_alertas_entidade
  on asaas_alertas (entity_type, entity_id);

comment on table asaas_alertas is
  'Fase 7: os eventos P1/P2 que pedem um humano. Evento é o que o Asaas disse e não muda; alerta é o que alguém precisa fazer e é resolvido. Por isso são tabelas distintas.';

-- RLS — mesmo tratamento das demais.
do $$
begin
  execute 'alter table asaas_alertas enable row level security';
  execute 'drop policy if exists "auth_all" on asaas_alertas';
  execute 'create policy "auth_all" on asaas_alertas for all to authenticated using (true) with check (true)';
end $$;
