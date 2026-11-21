-- =====================================================================================
-- Bodega · tablas y reglas de seguridad (Supabase).
-- Va en el MISMO proyecto de Ruta de Entregas (aptyzcodlubefqrscmvc): tablas separadas con prefijo bodega_,
-- no toca equipo_miembros ni paradas.
-- Pegar COMPLETO en Supabase → SQL Editor → New query → Run. Se puede volver a correr (no borra datos).
-- Antes de correrlo: crea las cuentas en Authentication → Users y cambia los correos del final.
-- =====================================================================================

-- Quiénes usan la bodega. rol: admin (maneja repartidores) | bodega (recibe, despacha, liquida).
create table if not exists public.bodega_miembros (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nombre  text not null,
  rol     text not null default 'bodega' check (rol in ('admin','bodega')),
  creado  timestamptz not null default now()
);

-- Registro de eventos: SOLO se agregan filas. El estado de cada paquete lo calcula la app con todos sus eventos.
-- seq: orden de llegada al servidor (la app baja «lo nuevo» por seq). at: hora real de la lectura en el celular
-- (puede ser anterior si se leyó sin señal). srv_at: hora del servidor.
create table if not exists public.bodega_eventos (
  seq     bigint generated always as identity unique,
  id      uuid primary key,
  at      timestamptz not null,
  tipo    text not null,
  guia    text check (guia is null or guia ~ '^[A-Z0-9-]{6,40}$'),
  d       jsonb not null default '{}'::jsonb check (pg_column_size(d) < 2000),
  por     text check (char_length(por) <= 40),
  dev     text check (char_length(dev) <= 20),
  user_id uuid not null default auth.uid() references auth.users(id),
  srv_at  timestamptz not null default now(),
  -- Una lectura no puede venir del futuro ni de hace más de 15 días (celular con la hora mal o datos viejos).
  constraint bodega_eventos_at_ok check (at <= srv_at + interval '10 minutes' and at >= srv_at - interval '15 days'),
  -- Los eventos de paquete llevan guía; los de catálogo (repartidores, lotes) no.
  constraint bodega_eventos_guia_ok check ((tipo in ('REP','ZONA','LOTE','LOTE_CERRADO')) = (guia is null))
);
-- Tipos válidos (v1.1 agrega ZONA y UBICACION). Se define aparte para poder ampliarlo sin recrear la tabla.
alter table public.bodega_eventos drop constraint if exists bodega_eventos_tipo_check;
alter table public.bodega_eventos drop constraint if exists bodega_eventos_tipo_ok;
alter table public.bodega_eventos add constraint bodega_eventos_tipo_ok check (tipo in
  ('REP','ZONA','LOTE','LOTE_CERRADO','ESPERADO','RECIBIDO','NOVEDAD','UBICACION','ASIGNADO','DEVUELTO','ENTREGADO','FALTANTE','ANULAR'));
alter table public.bodega_eventos drop constraint if exists bodega_eventos_guia_ok;
alter table public.bodega_eventos add constraint bodega_eventos_guia_ok check ((tipo in ('REP','ZONA','LOTE','LOTE_CERRADO')) = (guia is null));
create index if not exists bodega_eventos_srv on public.bodega_eventos (srv_at);
create index if not exists bodega_eventos_guia on public.bodega_eventos (guia);
create index if not exists bodega_eventos_at on public.bodega_eventos (at);   -- histórico por fechas
drop index if exists public.bodega_eventos_tipo;
create index if not exists bodega_eventos_cat on public.bodega_eventos (tipo) where tipo in ('REP','ZONA','LOTE','LOTE_CERRADO');

-- El servidor pone su hora y el usuario real (no se confía en lo que mande el celular).
create or replace function public.bodega_eventos_sellar() returns trigger
language plpgsql set search_path = public as $$
begin
  new.srv_at := now();
  new.user_id := auth.uid();
  return new;
end $$;
drop trigger if exists bodega_eventos_sellar on public.bodega_eventos;
create trigger bodega_eventos_sellar before insert on public.bodega_eventos
  for each row execute function public.bodega_eventos_sellar();

create or replace function public.bodega_es_miembro() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.bodega_miembros where user_id = auth.uid());
$$;
create or replace function public.bodega_es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.bodega_miembros where user_id = auth.uid() and rol = 'admin');
$$;

alter table public.bodega_miembros enable row level security;
alter table public.bodega_eventos enable row level security;

drop policy if exists "bodega: ver miembros" on public.bodega_miembros;
create policy "bodega: ver miembros" on public.bodega_miembros
  for select to authenticated using (public.bodega_es_miembro());

drop policy if exists "bodega: ver eventos" on public.bodega_eventos;
create policy "bodega: ver eventos" on public.bodega_eventos
  for select to authenticated using (public.bodega_es_miembro());

-- Agregar: cualquier miembro; repartidores (REP) y zonas (ZONA) solo un administrador.
drop policy if exists "bodega: agregar eventos" on public.bodega_eventos;
create policy "bodega: agregar eventos" on public.bodega_eventos
  for insert to authenticated with check (public.bodega_es_miembro() and (tipo not in ('REP','ZONA') or public.bodega_es_admin()));
-- Sin reglas de UPDATE ni DELETE: nadie cambia ni borra eventos desde la app (para corregir se agrega un ANULAR).

revoke all on public.bodega_eventos, public.bodega_miembros from anon;
grant select, insert on public.bodega_eventos to authenticated;
grant select on public.bodega_miembros to authenticated;

-- ---------------- Miembros: CAMBIA LOS CORREOS ----------------
insert into public.bodega_miembros (user_id, nombre, rol)
select id, 'Camilo', 'admin' from auth.users where email = 'CORREO_DE_CAMILO@ejemplo.com'
on conflict (user_id) do update set nombre = excluded.nombre, rol = excluded.rol;

-- Cuenta de la bodega (la que se conecta en los celulares del despachador). Repetir para cada cuenta.
insert into public.bodega_miembros (user_id, nombre, rol)
select id, 'Despacho', 'bodega' from auth.users where email = 'CORREO_DE_LA_BODEGA@ejemplo.com'
on conflict (user_id) do update set nombre = excluded.nombre, rol = excluded.rol;

select m.nombre, m.rol, u.email from public.bodega_miembros m join auth.users u on u.id = m.user_id;

-- HISTÓRICO: no se borra nada. Es la prueba de quién recibió, quién despachó a quién y quién liquidó.
-- Tamaño: ~600 paquetes/día ≈ 2 500 eventos/día ≈ 0,8 MB/día ≈ 290 MB/año (con índices, algo más).
-- El plan gratuito (500 MB de base de datos) alcanza para ~1 año y medio. Antes de llegar: pasar a Pro (incluye
-- copias de seguridad diarias) o exportar a Excel los años cerrados (Consultar → Excel por fechas) y guardarlos.
-- Ver el tamaño: select pg_size_pretty(pg_total_relation_size('public.bodega_eventos'));
