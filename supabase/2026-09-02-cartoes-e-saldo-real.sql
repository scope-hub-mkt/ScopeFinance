-- ════════════════════════════════════════════════════════════════════
--  02/09/2026 — o dinheiro passa a vir do Asaas, e o que era digitado sai
--
--  ⚖️ O DEFEITO, MEDIDO NO DIA:
--
--    bancos → linha "Asaas": saldo = 429.47
--    GET https://api.asaas.com/v3/finance/balance → { "balance": 13.79 }
--
--  A tela /bancos, a Dashboard e o relatório mostravam os R$ 429,47 — 31×
--  mais dinheiro do que existe — sem levantar erro nenhum. Número redondo,
--  no lugar certo, com cara de certo. É a família de falha que este repo já
--  catalogou: falha atrás de indicador verde.
--
--  ⛔ A correção NÃO é sincronizar o saldo para dentro desta tabela. Uma
--  cópia recomeça a divergir no primeiro lançamento, porque o gatilho
--  `apply_lancamento_saldo` soma em cima dela. O saldo do gateway passa a
--  ser LIDO do gateway a cada abertura de tela (`lib/asaas/conta.ts`), e
--  não tem cópia em lugar nenhum.
--
--  `bancos` continua existindo pelo motivo que sempre a justificou:
--  `contas_receber.conta_id`, `contas_pagar.conta_id`, `assinaturas.conta_id`
--  e `lancamentos.conta_id` apontam para ela. O que sai é o poder de digitar
--  saldo — `saldo` deixou de ser coluna gravável em `lib/resources.ts`.
-- ════════════════════════════════════════════════════════════════════

-- ─── CARTÕES ────────────────────────────────────────────────────────
--
-- ⚖️ A tabela some porque o conceito não existe deste lado. Ela guardava o
-- cartão DA EMPRESA (limite, usado, dia de fechamento) e o Asaas é o
-- RECEBEDOR: ele conhece o cartão de quem paga, nunca o limite dele.
--
-- ⚠️ Conferido antes de escrever este arquivo: `select count(*) from cartoes`
-- devolveu **0**. A tela viveu inteira mostrando "Nenhum cartão cadastrado"
-- enquanto 71 cobranças reais no cartão passavam pelo gateway sem aparecer em
-- lugar nenhum. Nenhum dado é perdido aqui.
--
-- A tela `/cartoes` passou a ler `GET /payments?billingType=CREDIT_CARD` e
-- `GET /installments` (`lib/asaas/cartoes.ts`), agregando por bandeira e
-- quatro últimos dígitos. Nada disso é gravado: é agregação por requisição.
drop trigger if exists trg_updated_cartoes on cartoes;
drop table if exists cartoes;

-- ─── SALDO DIGITADO ─────────────────────────────────────────────────
--
-- ⚠️ O default fica em 0 e a coluna PERMANECE: o gatilho
-- `apply_lancamento_saldo` continua sendo dono dela, e é ele que responde
-- "quanto entrou nesta conta do caixa interno pelos lançamentos deste
-- sistema". O que a tela mudou é a AFIRMAÇÃO: esse número é declarado como
-- soma de lançamentos, não como extrato de instituição financeira.
comment on column bancos.saldo is
  'Soma dos lançamentos vinculados a esta conta, mantida pelo gatilho apply_lancamento_saldo. '
  'NÃO é o saldo de uma instituição financeira e NÃO é gravável pela API '
  '(ver lib/resources.ts, 02/09/2026). O saldo real da conta Asaas é lido ao vivo '
  'em GET /finance/balance por lib/asaas/conta.ts e não tem cópia neste banco.';

-- ─── FISCAL / REVISÃO ───────────────────────────────────────────────
--
-- ⚠️ As telas `/fiscal` e `/revisao` foram removidas no mesmo dia, a pedido do
-- dono. As TABELAS ficam de propósito:
--
--   · `retencoes_fiscais` e `config_fiscal` continuam sendo lidas por
--     `lib/fiscal.ts` na emissão da NFS-e (`RN-43` — alíquota datada). Apagar
--     a tabela derrubaria a emissão junto com a tela de cadastro dela.
--   · `clientes.status_cadastro` continua bloqueando cobrança e nota fiscal
--     em `app/api/[resource]/route.ts`. O que sumiu é a LISTA numa tela
--     própria; a recusa, que é o que protege, continua de pé.
