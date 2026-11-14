-- Backend for tap.samdw.ca (Snuske leaderboard + NFC tag registry).
--
-- Security model:
--   * Tables have RLS on and NO policies, and anon has no table grants, so the
--     public API key cannot read or write tables directly.
--   * Everything goes through the functions below (SECURITY DEFINER).
--   * Admin functions require the admin PIN (bcrypt-hashed in a private schema,
--     with a lockout after 10 wrong attempts in 15 minutes).

create extension if not exists pgcrypto with schema extensions;

-- ---------- Tables ----------
create table if not exists public.players (
  tag        text primary key check (tag ~ '^[a-z0-9]{4,16}$'),
  name       text not null check (char_length(btrim(name)) between 1 and 24),
  created_at timestamptz not null default now()
);

create table if not exists public.scores (
  id         bigint generated always as identity primary key,
  tag        text not null references public.players(tag) on delete cascade,
  game       text not null default 'snuske' check (game ~ '^[a-z0-9_-]{1,32}$'),
  score      integer not null check (score between 0 and 5000),
  created_at timestamptz not null default now()
);
create index if not exists scores_game_tag_score on public.scores (game, tag, score desc);
create index if not exists scores_tag_created on public.scores (tag, created_at desc);

alter table public.players enable row level security;
alter table public.scores  enable row level security;
revoke all on public.players, public.scores from anon, authenticated;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.admin (
  id         int primary key default 1 check (id = 1),
  pin_hash   text not null,
  created_at timestamptz not null default now()
);
create table if not exists private.admin_attempts (
  at timestamptz not null default now()
);

-- ---------- Internal helpers ----------
-- Returns null when the PIN is good, otherwise an error message.
-- Never raises, so the failed-attempt row is kept (a raise would roll it back).
create or replace function private.pin_error(p_pin text)
returns text language plpgsql security definer set search_path = '' as $$
declare h text;
begin
  delete from private.admin_attempts where at < now() - interval '1 day';
  if (select count(*) from private.admin_attempts where at > now() - interval '15 minutes') >= 10 then
    return 'Too many wrong PINs. Wait 15 minutes.';
  end if;
  select pin_hash into h from private.admin where id = 1;
  if h is null then return 'Admin PIN is not set up yet.'; end if;
  if extensions.crypt(coalesce(p_pin, ''), h) <> h then
    insert into private.admin_attempts default values;
    return 'Wrong PIN.';
  end if;
  return null;
end $$;

create or replace function private.new_tag()
returns text language plpgsql security definer set search_path = '' as $$
declare
  alpha constant text := 'abcdefghjkmnpqrstuvwxyz23456789'; -- no 0/o/1/l/i
  t text;
  b bytea;
begin
  loop
    b := extensions.gen_random_bytes(6);
    t := '';
    for i in 0..5 loop
      t := t || substr(alpha, 1 + (get_byte(b, i) % length(alpha)), 1);
    end loop;
    exit when not exists (select 1 from public.players where tag = t);
  end loop;
  return t;
end $$;

-- ---------- Public API (game) ----------
create or replace function public.player(p_tag text, p_game text default 'snuske')
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'name', p.name,
    'best', (select max(s.score) from public.scores s where s.tag = p.tag and s.game = p_game)
  )
  from public.players p where p.tag = lower(p_tag);
$$;

create or replace function public.submit_score(p_tag text, p_score int, p_game text default 'snuske')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_tag text := lower(p_tag);
  v_prev int;
  v_best int;
  v_rank int;
  v_total int;
begin
  if not exists (select 1 from public.players where tag = v_tag) then
    return jsonb_build_object('error', 'Unknown tag');
  end if;
  if p_score is null or p_score < 0 or p_score > 5000 then
    return jsonb_build_object('error', 'Invalid score');
  end if;
  if exists (select 1 from public.scores where tag = v_tag and created_at > now() - interval '3 seconds') then
    return jsonb_build_object('error', 'Too fast');
  end if;

  select max(score) into v_prev from public.scores where tag = v_tag and game = p_game;
  insert into public.scores (tag, game, score) values (v_tag, p_game, p_score);
  v_best := greatest(coalesce(v_prev, 0), p_score);

  select count(*) + 1 into v_rank from (
    select tag from public.scores where game = p_game group by tag having max(score) > v_best
  ) x;
  select count(distinct tag) into v_total from public.scores where game = p_game;

  return jsonb_build_object(
    'best', v_best, 'rank', v_rank, 'total', v_total,
    'new_best', v_prev is null or p_score > v_prev
  );
end $$;

create or replace function public.leaderboard(p_game text default 'snuske', p_limit int default 10, p_tag text default null)
returns table (rank int, name text, best int, me boolean)
language sql stable security definer set search_path = '' as $$
  select (rank() over (order by b.best desc))::int, p.name, b.best, (b.tag = lower(p_tag))
  from (select tag, max(score) as best from public.scores where game = p_game group by tag) b
  join public.players p on p.tag = b.tag
  order by b.best desc, p.name
  limit least(greatest(coalesce(p_limit, 10), 1), 50);
$$;

-- ---------- Admin API (PIN protected) ----------
create or replace function public.admin_status()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('setup', exists (select 1 from private.admin));
$$;

create or replace function public.admin_setup(p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from private.admin) then
    return jsonb_build_object('error', 'PIN is already set.');
  end if;
  if char_length(coalesce(p_pin, '')) < 6 then
    return jsonb_build_object('error', 'Use at least 6 characters.');
  end if;
  insert into private.admin (pin_hash) values (extensions.crypt(p_pin, extensions.gen_salt('bf', 10)));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_create_tag(p_pin text, p_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e text; t text; n text := btrim(coalesce(p_name, ''));
begin
  e := private.pin_error(p_pin);
  if e is not null then return jsonb_build_object('error', e); end if;
  if char_length(n) not between 1 and 24 then
    return jsonb_build_object('error', 'Name must be 1-24 characters.');
  end if;
  t := private.new_tag();
  insert into public.players (tag, name) values (t, n);
  return jsonb_build_object('tag', t, 'name', n);
end $$;

create or replace function public.admin_list_tags(p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e text;
begin
  e := private.pin_error(p_pin);
  if e is not null then return jsonb_build_object('error', e); end if;
  return jsonb_build_object('tags', coalesce((
    select jsonb_agg(jsonb_build_object(
      'tag', p.tag, 'name', p.name, 'created_at', p.created_at,
      'best', (select max(score) from public.scores s where s.tag = p.tag),
      'plays', (select count(*) from public.scores s where s.tag = p.tag)
    ) order by p.created_at desc)
    from public.players p
  ), '[]'::jsonb));
end $$;

create or replace function public.admin_rename_tag(p_pin text, p_tag text, p_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e text; n text := btrim(coalesce(p_name, ''));
begin
  e := private.pin_error(p_pin);
  if e is not null then return jsonb_build_object('error', e); end if;
  if char_length(n) not between 1 and 24 then
    return jsonb_build_object('error', 'Name must be 1-24 characters.');
  end if;
  update public.players set name = n where tag = lower(p_tag);
  return jsonb_build_object('ok', found);
end $$;

create or replace function public.admin_delete_tag(p_pin text, p_tag text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e text;
begin
  e := private.pin_error(p_pin);
  if e is not null then return jsonb_build_object('error', e); end if;
  delete from public.players where tag = lower(p_tag);
  return jsonb_build_object('ok', found);
end $$;

-- ---------- Grants ----------
revoke all on all functions in schema private from public, anon, authenticated;
revoke all on function
  public.player(text, text), public.submit_score(text, int, text), public.leaderboard(text, int, text),
  public.admin_status(), public.admin_setup(text), public.admin_create_tag(text, text),
  public.admin_list_tags(text), public.admin_rename_tag(text, text, text), public.admin_delete_tag(text, text)
  from public;
grant execute on function
  public.player(text, text), public.submit_score(text, int, text), public.leaderboard(text, int, text),
  public.admin_status(), public.admin_setup(text), public.admin_create_tag(text, text),
  public.admin_list_tags(text), public.admin_rename_tag(text, text, text), public.admin_delete_tag(text, text)
  to anon, authenticated;
