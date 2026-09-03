-- ════════════════════════════════════════════════════════════════════
--  03/09/2026 — o recebível declara de onde nasceu (RF-93 / RN-52 / D-100)
--
--  ⚖️ A DECISÃO, do dono, na abertura do deploy final:
--
--    "apartir de agora, os dados financeiros que exibem da dashboard vem
--     exclusivamente da api do asaas"
--
--  e, perguntado o que fazer com a cobrança criada fora do gateway:
--
--    "tem como criar uma parte exclusiva so para essas cobranças manuais ?"
--
--  O que muda: `contas_receber` passa a dizer se a linha veio do Asaas ou
--  foi digitada. A partir disso, a tela separa, o KPI separa, e a ponte
--  para a Dashboard entrega SÓ o que veio do gateway (`RF-94`).
--
--  ⛔ Isto NÃO move a fronteira de `RN-01`. O ScopeFinance continua dono do
--  número financeiro e a Dashboard continua sem recalcular. O que a regra
--  fixa é de ONDE o dono recebe o fato — e a resposta passou a ser: do
--  gateway, nunca de digitação.
-- ════════════════════════════════════════════════════════════════════

-- ⛔ **O default é 'manual', e isso é o contrário do que a intuição pede.**
--
-- A leitura natural seria "quase tudo vem do Asaas, então o default é
-- 'asaas'". Ela está errada pelo motivo que importa: com esse default,
-- QUALQUER linha que apareça sem alguém ter dito de onde veio — uma falha de
-- escrita, um caminho novo que ninguém lembrou de marcar, um insert manual no
-- SQL Editor — entra no total do gateway e vira **receita fantasma**, com
-- cara de certo.
--
-- Com o default 'manual', o mesmo acidente vira um recebível manual visível,
-- rotulado, fora do KPI. O preço é que `aplicarCobranca()` precisa gravar
-- 'asaas' EXPLICITAMENTE; o benefício é que o erro cai para o lado seguro.
--
-- É a mesma doutrina que corrigiu a contagem de clientes ativos em 28/08: a
-- trava fica onde a pergunta é feita, não onde a resposta é escrita.
alter table contas_receber
  add column if not exists origem_lancamento text not null default 'manual';

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'contas_receber_origem_lancamento_check') then
    alter table contas_receber drop constraint contas_receber_origem_lancamento_check;
  end if;
  alter table contas_receber add constraint contas_receber_origem_lancamento_check
    check (origem_lancamento in ('asaas','manual'));
end $$;

comment on column contas_receber.origem_lancamento is
  'RF-93/RN-52: ''asaas'' nasceu no gateway; ''manual'' foi digitado. Só ''asaas'' atravessa a ponte para a Dashboard (RF-94). Default ''manual'' de propósito: linha não marcada não é do gateway.';

-- ── Backfill ────────────────────────────────────────────────────────
--
-- O critério é `asaas_payment_id`, e não `asaas_status` nem `tipo_venda`:
-- é a única coluna cuja presença PROVA que a linha nasceu de uma cobrança
-- do gateway. As outras duas podem estar preenchidas por espelhamento
-- parcial e diriam "asaas" sobre linha que o Asaas nunca criou.
update contas_receber
   set origem_lancamento = 'asaas'
 where asaas_payment_id is not null
   and origem_lancamento <> 'asaas';

-- ── Índice ──────────────────────────────────────────────────────────
--
-- Parcial e sobre 'asaas' porque é essa a consulta quente: as quatro rotas
-- da ponte filtram por ela a cada leitura da Dashboard. O lado 'manual' é
-- varrido por uma tela só, e por gente, não por integração.
create index if not exists idx_receber_origem_asaas
  on contas_receber (origem_lancamento, pago_em)
  where origem_lancamento = 'asaas';

-- ⚠️ Conferência que vale rodar depois de aplicar — as duas contagens têm
-- de bater, e se não baterem é porque existe linha com `asaas_payment_id`
-- que o backfill não alcançou:
--
--   select origem_lancamento, count(*) from contas_receber group by 1;
--   select count(*) from contas_receber where asaas_payment_id is not null;
