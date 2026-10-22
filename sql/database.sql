-- =========================================================
-- Noctis VTC — Schéma Supabase (PostgreSQL)
-- À exécuter dans : Supabase Studio → SQL Editor → New query
-- ⚠️ Ce schéma remplace l'ancien schéma MySQL.
-- Il s'appuie sur auth.users (Supabase Auth) et non sur une
-- table users maison.
-- =========================================================

-- ---------------------------------------------------------
-- Table profiles (miroir public de auth.users)
-- ---------------------------------------------------------
-- Preserve a legacy profiles table with a non-UUID id instead of
-- reusing it for Supabase Auth profiles.
do $$
declare
    profile_id_type text;
    archive_name text;
begin
    select data_type
      into profile_id_type
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'profiles'
       and column_name = 'id';

    if profile_id_type is not null and profile_id_type <> 'uuid' then
        archive_name := 'profiles_legacy_' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISS');
        execute format('alter table public.profiles rename to %I', archive_name);
        raise notice 'Legacy profiles table preserved as public.%', archive_name;
    end if;
end;
$$;

create table if not exists public.profiles (
    id         uuid primary key references auth.users(id) on delete cascade,
    nom        varchar(100),
    prenom     varchar(100),
    telephone  varchar(30),
    created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.profiles no force row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
    on public.profiles for select
    using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
    on public.profiles for update
    using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
    on public.profiles for insert
    with check (auth.uid() = id);

grant select, update on public.profiles to authenticated;

-- ---------------------------------------------------------
-- Trigger : crée automatiquement une ligne profiles
-- à l'inscription (les métadonnées viennent de signUp).
-- ---------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.profiles (id, nom, prenom, telephone)
    values (
        new.id,
        left(nullif(btrim(new.raw_user_meta_data->>'nom'), ''), 100),
        left(nullif(btrim(new.raw_user_meta_data->>'prenom'), ''), 100),
        left(nullif(btrim(new.raw_user_meta_data->>'telephone'), ''), 30)
    )
    on conflict (id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------------------------------------------------------
-- Table reservations
-- ---------------------------------------------------------
create table if not exists public.reservations (
    id           bigserial primary key,
    user_id      uuid references auth.users(id) on delete set null,
    reference    varchar(20) not null unique,
    nom          varchar(100) not null,
    prenom       varchar(100) not null,
    email        varchar(190) not null,
    telephone    varchar(30)  not null,
    depart       varchar(255) not null,
    arrivee      varchar(255) not null,
    depart_lat   numeric(9,6),
    depart_lng   numeric(9,6),
    arrivee_lat  numeric(9,6),
    arrivee_lng  numeric(9,6),
    date_trajet  date not null,
    heure_trajet time not null,
    vehicule     text not null default 'berline'
                 check (vehicule in ('berline','van','premium')),
    passagers    smallint not null default 1
                 check (passagers between 1 and 6),
    distance_km  numeric(6,1) not null,
    duree_min    integer not null,
    prix_total   numeric(8,2) not null,
    note         text,
    statut       text not null default 'attente'
                 check (statut in ('attente','confirmee','terminee','annulee')),
    created_at   timestamptz not null default now()
);

-- Keep old integer user references while introducing the UUID used by Auth.
do $$
declare
    user_id_type text;
begin
    select data_type
      into user_id_type
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'reservations'
       and column_name = 'user_id';

    if user_id_type is not null and user_id_type <> 'uuid' then
        alter table public.reservations rename column user_id to legacy_user_id;
        alter table public.reservations
            add column user_id uuid references auth.users(id) on delete set null;
        raise notice 'Legacy reservation user ids preserved in reservations.legacy_user_id.';
    end if;
end;
$$;

drop index if exists public.idx_reservations_user_id;
create index if not exists idx_reservations_user_id on public.reservations(user_id);

alter table public.reservations enable row level security;

-- Insertion publique (formulaire de réservation accessible sans compte)
drop policy if exists "reservations_insert_public" on public.reservations;
create policy "reservations_insert_public"
    on public.reservations for insert
    with check (
        (
            ((select auth.uid()) is null and user_id is null)
            or user_id = (select auth.uid())
        )
        and email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
        and length(btrim(nom)) > 0
        and length(btrim(prenom)) > 0
        and length(btrim(telephone)) > 0
    );

grant insert, select on public.reservations to anon, authenticated;

-- Lecture : uniquement ses propres réservations
drop policy if exists "reservations_select_own" on public.reservations;
create policy "reservations_select_own"
    on public.reservations for select
    using (auth.uid() = user_id);

-- ---------------------------------------------------------
-- Table avis
-- ---------------------------------------------------------
create table if not exists public.avis (
    id          bigserial primary key,
    user_id     uuid references auth.users(id) on delete set null,
    nom         varchar(100) not null,
    note        smallint not null check (note between 1 and 5),
    commentaire text not null,
    created_at  timestamptz not null default now()
);

-- Keep old integer user references while introducing the UUID used by Auth.
do $$
declare
    user_id_type text;
begin
    select data_type
      into user_id_type
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'avis'
       and column_name = 'user_id';

    if user_id_type is not null and user_id_type <> 'uuid' then
        alter table public.avis rename column user_id to legacy_user_id;
        alter table public.avis
            add column user_id uuid references auth.users(id) on delete set null;
        raise notice 'Legacy review user ids preserved in avis.legacy_user_id.';
    end if;
end;
$$;

create index if not exists idx_avis_created_at on public.avis(created_at desc);

alter table public.avis enable row level security;

-- Lecture publique (affichage des avis sur le site)
drop policy if exists "avis_select_public" on public.avis;
create policy "avis_select_public"
    on public.avis for select
    using (true);

-- Écriture publique (formulaire d'avis accessible sans compte)
drop policy if exists "avis_insert_public" on public.avis;
create policy "avis_insert_public"
    on public.avis for insert
    with check (
        note between 1 and 5
        and length(trim(nom)) > 0
        and length(trim(commentaire)) > 0
    );

grant select, insert on public.avis to anon, authenticated;

-- ---------------------------------------------------------
-- Données de démonstration (avis)
-- ---------------------------------------------------------
-- insert into public.avis (nom, note, commentaire, created_at) values
-- ('Camille D.', 5, 'Chauffeur ponctuel et voiture impeccable.', now() - interval '3 days'),
-- ('Yanis B.',   4, 'Très bonne expérience pour un trajet vers Orly.', now() - interval '7 days'),
-- ('Sarah M.',   5, 'Service premium au rendez-vous.', now() - interval '12 days'),
-- ('Thomas L.',  3, 'Correct dans l''ensemble, léger retard.', now() - interval '20 days');