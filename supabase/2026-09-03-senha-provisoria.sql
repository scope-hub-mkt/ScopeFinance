-- ════════════════════════════════════════════════════════════════════
--  03/09/2026 — a senha provisória vira mecanismo (RF-99, RN-56, D-101)
--
--  ⚖️ A DECISÃO, do dono, ao entregar as três contas vivas:
--
--    "Senha padrão das três: ScopeRec@2026 — troque no primeiro acesso."
--
--  ⛔ O QUE A MEDIÇÃO ACHOU:
--
--  Não existe `senha_provisoria`, `primeiro_acesso` nem `trocar_senha` em
--  NENHUM dos dois repositórios (varredura em 03/09/2026). "Troque no
--  primeiro acesso" era convenção sem mecanismo — isto é, uma promessa que o
--  sistema não cumpre. Três pessoas com a mesma senha conhecida, e nada
--  obrigando a troca.
--
--  ⚠️ A mesma migração existe no ScopeFinance, com o mesmo nome de coluna.
--  Os dois sistemas têm usuários independentes (`D-94`), mas a regra de
--  primeiro acesso é a mesma — e divergir o nome da coluna faria a próxima
--  pessoa procurar duas vezes.
-- ════════════════════════════════════════════════════════════════════

alter table usuarios
  add column if not exists senha_provisoria boolean not null default false;

comment on column usuarios.senha_provisoria is
  'RF-99/RN-56: enquanto true, a sessão só alcança a troca de senha. Limpa ao trocar. Nasce false: conta antiga não é barrada retroativamente.';

-- ⛔ **Default `false`, não `true`.** Ligar para todo mundo trancaria as
-- contas existentes numa tela de troca que elas não pediram — e o expurgo
-- deste mesmo dia já vai recriar as contas com a marca ligada
-- explicitamente, que é onde ela deve nascer.
create index if not exists idx_usuarios_senha_provisoria
  on usuarios (senha_provisoria) where senha_provisoria;
