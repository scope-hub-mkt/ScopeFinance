-- ════════════════════════════════════════════════════════════════════
--  Usuários do ScopeFinance — 31/08/2026 · decisão do dono (`RF-FIN-10`)
--
--  ⚖️ *"inserir o CRUD de usuários no finance e na dashboard (editar email,
--  nome, senha, informações pessoais, upload de foto de perfil… etc.
--  basicamente tudo que envolve o crud numa aplicação real)"*.
--
--  📐 **O que existia aqui até hoje: nada.** O ScopeFinance autenticava pelo
--  `auth.users` do Supabase e parava aí — não havia tabela de perfil, não havia
--  papel, não havia tela. Quem entrava via tudo, e a única forma de cadastrar
--  alguém era o painel do fornecedor.
--
--  ⚖️ **Usuários independentes dos da Dashboard — decisão do dono, 31/08/2026.**
--  São dois projetos Supabase distintos (`teewpo…` aqui, `lwfwhm…` lá), logo
--  dois `auth.users`. As alternativas pesadas e recusadas: espelhar o perfil da
--  Dashboard (a senha continuaria local de qualquer forma, então seria meia
--  unificação) e fundir os dois projetos (migração de auth, fora do escopo).
--
--  ⛔ Aditivo e idempotente.
-- ════════════════════════════════════════════════════════════════════

create table if not exists usuarios (
  -- ⛔ Sem `default`: o `id` é o de `auth.users`, sempre. Gerar um aqui criaria
  -- perfil que nenhuma credencial alcança — visível na lista e incapaz de
  -- entrar, sem nada explicando por quê.
  id              uuid primary key,
  nome            text not null,
  email           text unique not null,
  -- ⚖️ Três papéis, e não os cinco da Dashboard: aqui o que se faz é
  -- financeiro. `admin` administra usuários; `financeiro` opera cobrança e
  -- baixa; `leitura` consulta e não escreve.
  papel           text not null default 'financeiro'
                  check (papel in ('admin', 'financeiro', 'leitura')),
  ativo           boolean not null default true,
  -- Dados pessoais — todos opcionais. Exigir CPF no primeiro acesso travaria
  -- quem foi convidado hoje e precisa trabalhar agora.
  telefone        text,
  documento       text,
  data_nascimento date,
  foto_url        text,
  sobre           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table usuarios is
  'Perfil de quem usa o ScopeFinance (RF-FIN-10, 31/08/2026). O id é o de auth.users; a credencial mora lá, a pessoa mora aqui.';

-- ⛔ Unicidade PARCIAL: documento é identificador de pessoa, e dois cadastros
-- com o mesmo CPF são a mesma pessoa duas vezes. Mas a coluna é opcional, e um
-- `unique` comum bloquearia todo mundo que não informou.
create unique index if not exists uq_usuarios_documento
  on usuarios (documento) where documento is not null and btrim(documento) <> '';

create index if not exists idx_usuarios_ativo on usuarios (ativo, nome);

drop trigger if exists trg_usuarios_upd on usuarios;
create trigger trg_usuarios_upd before update on usuarios
  for each row execute function set_updated_at();


-- ─── A conta administradora ──────────────────────────────────────────
--
-- ⛔ **Uma só, e quem garante é o Postgres.** Regra de unicidade que vive só no
-- código sobrevive até o primeiro caminho que ninguém lembrou de cobrir. Mesma
-- doutrina de `RN-45` na Dashboard.
alter table usuarios add column if not exists master boolean not null default false;
create unique index if not exists uq_usuario_master on usuarios (master) where master;

comment on column usuarios.master is
  'A conta administradora única. Só ela troca e-mail e senha de outra pessoa — trocar credencial de alguém é tomar a conta dessa pessoa.';


-- ─── Semeadura: quem já entra hoje ───────────────────────────────────
--
-- ⚖️ **Sem isto, a tela nasceria vazia e ninguém entraria.** O middleware já
-- exige sessão; assim que a aplicação passar a exigir perfil, quem tem
-- credencial e não tem linha aqui fica de fora — inclusive quem aplicou esta
-- migração.
--
-- ⛔ **O primeiro vira master; os demais, admin.** "Primeiro" é o mais antigo
-- em `auth.users`, que é quem criou o projeto. Não é palpite sobre hierarquia:
-- é o único critério verificável que existe no banco, e a master é transferível
-- pela tela depois.
insert into usuarios (id, nome, email, papel, master)
select
  u.id,
  -- Nome não existe no `auth.users`; o trecho antes do `@` é o melhor palpite
  -- disponível, e a pessoa o corrige no próprio perfil no primeiro acesso.
  coalesce(nullif(btrim(u.raw_user_meta_data->>'nome'), ''), split_part(u.email, '@', 1)),
  u.email,
  'admin',
  u.created_at = (select min(created_at) from auth.users where email is not null)
from auth.users u
where u.email is not null
  and not exists (select 1 from usuarios p where p.id = u.id);


-- ─── O bucket da foto ────────────────────────────────────────────────
--
-- Público, pela mesma decisão do dono que vale na Dashboard. O caminho carrega
-- um sufixo aleatório: público não significa adivinhável.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatares', 'avatares', true, 2097152,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "avatares_leitura_publica" on storage.objects;
create policy "avatares_leitura_publica" on storage.objects
  for select using (bucket_id = 'avatares');


-- ─── RLS ─────────────────────────────────────────────────────────────
-- O back-end acessa por service_role (bypassa RLS). A policy protege o caso de
-- alguém usar a anon key.
alter table usuarios enable row level security;
drop policy if exists "auth_all" on usuarios;
create policy "auth_all" on usuarios
  for all to authenticated using (true) with check (true);
