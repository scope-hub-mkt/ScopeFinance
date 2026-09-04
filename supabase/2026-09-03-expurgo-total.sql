-- ════════════════════════════════════════════════════════════════════
--  03/09/2026 — o expurgo do deploy final (RF-101, D-99, D-101)
--
--  ⚖️ A INSTRUÇÃO, do dono: *"apague TODOS esses dados fakes existentes na
--  dashboard e os linkados ao finance"*.
--
--  ⛔ **A ORDEM SEGUE AS CHAVES ESTRANGEIRAS**, do mais dependente para o
--  menos: nota fiscal aponta para conta a receber, conta a receber aponta
--  para contrato e assinatura, contrato aponta para cliente com
--  `on delete restrict`.
--
--  ⚠️ **O que a medição mudou em relação ao plano.** O plano previa apagar
--  "as `contas_pagar` de comissão". Medido em 03/09/2026: **não existe
--  nenhuma** — as cinco linhas de `contas_pagar` são obrigações reais
--  (salário, honorários de contabilidade, telefonia, DAS, DARF INSS), todas
--  com `referencia_externa` nula, isto é, nenhuma veio da Dashboard. Apagar
--  qualquer uma seria destruir dívida real, e por isso a tabela **não é
--  tocada**.
-- ════════════════════════════════════════════════════════════════════

begin;

-- ── 1. Fiscal (depende de conta a receber e de cliente) ────────────
delete from notas_fiscais;

-- ── 2. Recebíveis, de qualquer origem ──────────────────────────────
--
-- Inclui os 16 lançados à mão e os 185 espelhados do Asaas. Os do gateway
-- voltam pelo backfill, com o mesmo `asaas_payment_id`; os manuais não
-- voltam, e é isso que o expurgo quer.
delete from contas_receber;

-- ── 3. Contratos e assinaturas ─────────────────────────────────────
delete from contrato_servicos;
delete from contratos;
delete from assinaturas;

-- ── 4. Movimento derivado ──────────────────────────────────────────
--
-- ⚖️ Os lançamentos existentes têm `origem = 'receber'`: eles nasceram da
-- baixa de recebíveis que acabaram de ser apagados. Mantê-los deixaria um
-- movimento de caixa sem a cobrança que o originou — e o gatilho
-- `apply_lancamento_saldo` já somou cada um em `bancos.saldo`, de modo que a
-- soma continuaria refletindo dinheiro cuja origem não existe mais.
delete from lancamentos;

-- ── 5. Espelho do catálogo da Dashboard ────────────────────────────
--
-- ⛔ **Este é o passo que o `D-90` ensinou a não esquecer.** Exclusão na
-- Dashboard **não emite evento**: apagar o catálogo de lá não limpa este
-- espelho, e foi exatamente assim que 7 linhas `[DEMO]` e 3 de teste
-- ficaram presas aqui enquanto a Dashboard já estava zerada. Os dois lados
-- são apagados explicitamente.
delete from servicos_espelho;

-- ── 6. Clientes ────────────────────────────────────────────────────
--
-- Voltam pelo backfill do Asaas, com o mesmo `asaas_customer_id`,
-- conciliados por documento — e replicam para a Dashboard pela ponte, com o
-- mesmo `id` dos dois lados.
delete from clientes;

commit;

-- ════════════════════════════════════════════════════════════════════
--  O QUE FICA DE PÉ, E POR QUÊ
--
--  ⛔ `asaas_webhook_events` — **a caixa de entrada do gateway**, com 51
--     eventos. Limpá-la faria o dedupe por id de evento perder a memória, e
--     o backfill reprocessaria do zero como se fosse novidade.
--     `spec-scope` §15.4 é explícito: não se limpa caixa de entrada.
--
--  ⛔ `crm_webhook_events`, `integracao_recebidos`, `integracao_enviados` —
--     pelo mesmo motivo, nas outras duas pontes. `integracao_enviados` ainda
--     guarda o histórico de entrega e a dead-letter.
--
--  ⛔ `contas_pagar` — obrigações REAIS, medidas linha a linha antes de
--     decidir. Nenhuma é comissão.
--
--  ⛔ `bancos` — cadastro de conta bancária, referenciado por
--     `conta_id` em três tabelas. `saldo` deixou de ser gravável em
--     02/09/2026; o saldo real é lido do Asaas ao vivo.
--
--  ⛔ `retencoes_fiscais`, `config_fiscal`, `ciclos_recorrencia`,
--     `integracao_credenciais` — configuração do negócio. Apagar as
--     credenciais desligaria a ponte.
--
--  ⚠️ Conferência depois de aplicar:
--
--    select 'clientes', count(*) from clientes
--    union all select 'contas_receber', count(*) from contas_receber
--    union all select 'servicos_espelho', count(*) from servicos_espelho;
--      -- as três em zero
--
--    select count(*) from asaas_webhook_events;  -- 51, INALTERADO
--    select count(*) from contas_pagar;          -- 5, INALTERADO
-- ════════════════════════════════════════════════════════════════════
