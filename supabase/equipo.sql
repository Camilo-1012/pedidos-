-- =====================================================================================
-- Ruta de Entregas · Equipo y sincronización (Supabase)
-- Pegar COMPLETO en Supabase → SQL Editor → New query → Run.
-- Antes de correrlo, cambia los dos correos y el nombre de la otra persona (al final).
-- Se puede volver a correr sin problema (no borra datos).
-- =====================================================================================

-- Quiénes son del equipo. Solo los que estén aquí pueden ver o subir paradas.
create table if not exists public.equipo_miembros (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nombre  text not null,
  admin   boolean not null default false,
  creado  timestamptz not null default now()
);

-- Paradas sincronizadas. «owner» = a quién le toca entregarla. Las borradas se marcan (deleted)
-- para que el otro celular se entere; no se eliminan de inmediato.
create table if not exists public.paradas (
  id         text primary key,
  owner      uuid not null references auth.users(id) on delete cascade,
  data       jsonb not null,
  deleted    boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
create index if not exists paradas_owner_upd on public.paradas (owner, updated_at);
create index if not exists paradas_upd on public.paradas (updated_at);

-- Funciones de permiso (security definer: leen la tabla de miembros sin depender de sus propias reglas).
create or replace function public.es_miembro() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.equipo_miembros where user_id = auth.uid());
$$;
create or replace function public.es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.equipo_miembros where user_id = auth.uid() and admin);
$$;

-- La hora de cada cambio la pone el servidor (evita problemas con relojes de celulares desajustados).
create or replace function public.paradas_tocar() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists paradas_tocar on public.paradas;
create trigger paradas_tocar before insert or update on public.paradas
  for each row execute function public.paradas_tocar();

-- Reglas de seguridad (RLS): sin ellas, la clave pública daría acceso a todo.
alter table public.equipo_miembros enable row level security;
alter table public.paradas enable row level security;

drop policy if exists "miembros ven el equipo" on public.equipo_miembros;
create policy "miembros ven el equipo" on public.equipo_miembros
  for select to authenticated using (public.es_miembro());

drop policy if exists "ver paradas" on public.paradas;
create policy "ver paradas" on public.paradas
  for select to authenticated using (public.es_miembro() and (owner = auth.uid() or public.es_admin()));

drop policy if exists "crear paradas" on public.paradas;
create policy "crear paradas" on public.paradas
  for insert to authenticated with check (public.es_miembro() and (owner = auth.uid() or public.es_admin()));

drop policy if exists "cambiar paradas" on public.paradas;
create policy "cambiar paradas" on public.paradas
  for update to authenticated
  using      (public.es_miembro() and (owner = auth.uid() or public.es_admin()))
  with check (public.es_miembro() and (owner = auth.uid() or public.es_admin()));
-- No hay regla de DELETE: nadie borra filas desde la app (se marcan con deleted = true).

revoke all on public.paradas, public.equipo_miembros from anon;
grant select, insert, update on public.paradas to authenticated;
grant select on public.equipo_miembros to authenticated;

-- ---------------- Miembros del equipo: CAMBIA LOS CORREOS Y EL NOMBRE ----------------
insert into public.equipo_miembros (user_id, nombre, admin)
select id, 'Camilo', true from auth.users where email = 'CORREO_DE_CAMILO@ejemplo.com'
on conflict (user_id) do update set nombre = excluded.nombre, admin = excluded.admin;

insert into public.equipo_miembros (user_id, nombre, admin)
select id, 'NOMBRE_DE_LA_OTRA_PERSONA', false from auth.users where email = 'CORREO_DE_LA_OTRA_PERSONA@ejemplo.com'
on conflict (user_id) do update set nombre = excluded.nombre, admin = excluded.admin;

-- Comprobación: deben salir las dos personas.
select m.nombre, m.admin, u.email from public.equipo_miembros m join auth.users u on u.id = m.user_id;

-- (Opcional, más adelante) Limpieza de paradas borradas hace más de 30 días:
-- delete from public.paradas where deleted and updated_at < now() - interval '30 days';
