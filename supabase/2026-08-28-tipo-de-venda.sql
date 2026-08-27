-- ═══════════════════════════════════════════════════════════════════════
--  A classificação que os submenus de Vendas leem — §8.1 do plano.
--
--  O board pede `Vendas → Todas · Avulsas · Contratos · Assinaturas`, e o §8.1
--  define a origem de cada um:
--
--    Avulsas     → PAYMENT_* SEM assinatura associada
--    Assinaturas → SUBSCRIPTION_* mais os PAYMENT_* filhos
--    Contratos   → cobranças parceladas
--    Todas       → a união
--
-- ⚖️ **Por que uma coluna e não um cálculo na consulta.** "Tem assinatura" a
-- consulta responde (`assinatura_id is not null`); "é parcela de um
-- parcelamento" ela **não** responde, porque o `installment` do Asaas não
-- estava sendo guardado em lugar nenhum. Recalcular exigiria voltar ao payload
-- cru a cada listagem — e o payload cru só existe para as linhas que vieram
-- por webhook, não para as do backfill.
--
-- Com a coluna, cada submenu é um `where` sobre um índice, e a classificação é
-- feita UMA vez, por `tipoDaVenda` em `lib/asaas/mapear.ts` — a mesma função
-- para o webhook e para a importação.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════

alter table contas_receber add column if not exists tipo_venda text;
alter table contas_receber add column if not exists parcela_numero int;
alter table contas_receber add column if not exists parcelamento_id text;

do $$ begin
  alter table contas_receber add constraint contas_tipo_venda_chk
    check (tipo_venda is null or tipo_venda in ('avulsa', 'contrato', 'assinatura'));
exception when duplicate_object then null; end $$;

comment on column contas_receber.tipo_venda is
  '§8.1: avulsa | contrato (parcelado) | assinatura. Classificado por tipoDaVenda() em lib/asaas/mapear.ts — a MESMA função no webhook e no backfill.';

-- ─── Backfill do que já está aqui ───────────────────────────────────
--
-- ⚠️ Só as duas classificações que o dado existente sustenta. Nenhuma linha
-- vira 'contrato' neste `update`: o `installment` do Asaas não foi guardado nas
-- importações anteriores, e chutar parcelamento a partir da descrição seria
-- inventar. As linhas reimportadas passam pelo `mapear.ts` e ganham o valor
-- certo; as demais ficam com o que é verificável.
update contas_receber
   set tipo_venda = case when assinatura_id is not null then 'assinatura' else 'avulsa' end
 where tipo_venda is null;

create index if not exists idx_receber_tipo_venda
  on contas_receber (tipo_venda, vencimento desc);
