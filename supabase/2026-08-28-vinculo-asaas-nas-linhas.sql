-- ═══════════════════════════════════════════════════════════════════════
--  O vínculo do gateway nas linhas que ele origina.
--
-- ⚖️ **O problema que isto resolve.** O webhook grava a cobrança mesmo quando
-- o `customer` do Asaas ainda não é conhecido aqui — e isso é decisão, não
-- descuido: o §1.1 do plano proíbe o gateway de ser origem de cliente novo
-- sem passar pela conciliação por documento (§2.4). Guardar a cobrança
-- desvinculada é melhor que perdê-la, e muito melhor que criar uma duplicata
-- de cliente que depois não se desfaz.
--
-- Mas isso só é verdade se existir o segundo tempo: quando o cliente enfim
-- aparece — pela conciliação, pelo CRM ou pela tela —, as linhas que o
-- esperavam precisam encontrar o dono. Sem uma coluna que diga *de qual
-- customer aquela cobrança veio*, esse religamento não tem por onde acontecer,
-- e "guardar desvinculada" vira "guardar desvinculada para sempre" — o
-- cemitério silencioso que o §2.3 descreve.
--
-- ⚠️ `notas_fiscais` tem `payload` e as outras duas não; tentar religar pelo
-- payload funcionaria só num terço dos casos, e falharia calado nos outros
-- dois. Uma coluna explícita nas três é o que torna o religamento um `update`
-- com `where`, não uma varredura de JSON que erra em silêncio.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════

alter table contas_receber add column if not exists asaas_customer_id text;
alter table assinaturas    add column if not exists asaas_customer_id text;
alter table notas_fiscais  add column if not exists asaas_customer_id text;

comment on column contas_receber.asaas_customer_id is
  'De qual customer do Asaas esta cobrança veio. Existe para religar ao cliente quando ele passar a existir aqui — o gateway NUNCA cria cliente sozinho (§1.1/§2.4).';

-- ⛔ NÃO é único: um customer tem muitas cobranças. O índice serve à consulta
-- do religamento (`cliente_id is null and asaas_customer_id = ?`), e o parcial
-- é o certo porque a linha já religada não interessa mais a essa busca.
create index if not exists idx_receber_asaas_customer
  on contas_receber (asaas_customer_id) where cliente_id is null;
create index if not exists idx_assinaturas_asaas_customer
  on assinaturas (asaas_customer_id) where cliente_id is null;
create index if not exists idx_notas_asaas_customer
  on notas_fiscais (asaas_customer_id) where cliente_id is null;
