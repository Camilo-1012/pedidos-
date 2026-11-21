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
  ('REP','ZONA','LOTE','LOTE_CERRADO','ESPERADO','RECIBIDO','NOVEDAD','UBICACION','ASIGNADO','DEVUELTO','ENTREGADO','NO_ENTREGADO','FALTANTE','ANULAR'));
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

-- =====================================================================================
-- CONEXIÓN CON RUTA (v2.31): el despachador asigna y al repartidor le aparece en su Ruta; el repartidor reporta
-- «Entregado» y «No estaba». Cada repartidor usa su propia cuenta de Ruta (equipo_miembros, ver equipo.sql).
-- =====================================================================================

-- Repartidor de la bodega (rid, el de los eventos REP) ↔ cuenta de Ruta. Solo el administrador de la bodega lo cambia.
create table if not exists public.bodega_vinculos (
  rid     text primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  nombre  text,
  creado  timestamptz not null default now()
);
alter table public.bodega_vinculos enable row level security;
drop policy if exists "bodega: ver vinculos" on public.bodega_vinculos;
create policy "bodega: ver vinculos" on public.bodega_vinculos
  for select to authenticated using (public.bodega_es_miembro() or user_id = auth.uid());
drop policy if exists "bodega: admin vincula" on public.bodega_vinculos;
create policy "bodega: admin vincula" on public.bodega_vinculos
  for all to authenticated using (public.bodega_es_admin()) with check (public.bodega_es_admin());
revoke all on public.bodega_vinculos from anon;
grant select, insert, update, delete on public.bodega_vinculos to authenticated;

-- Para que el administrador elija a quién vincular: las cuentas del equipo de Ruta (solo nombre e id).
create or replace function public.bodega_cuentas_ruta() returns table(user_id uuid, nombre text)
language sql stable security definer set search_path = public as $$
  select m.user_id, m.nombre from public.equipo_miembros m where public.bodega_es_admin() order by m.nombre;
$$;
-- Repartidor (rid) de la cuenta que llama, o null si no está vinculada.
create or replace function public.bodega_mi_rid() returns text
language sql stable security definer set search_path = public as $$
  select rid from public.bodega_vinculos where user_id = auth.uid();
$$;

-- Último movimiento que cambia el estado de cada guía (sin los deshechos con ANULAR), de los últimos 20 días.
create or replace function public.bodega_estado_guias() returns table(guia text, tipo text, rid text, at timestamptz)
language sql stable security definer set search_path = public as $$
  select distinct on (e.guia) e.guia, e.tipo, e.d->>'rid', e.at
  from public.bodega_eventos e
  where e.guia is not null and e.at > now() - interval '20 days'
    and e.tipo in ('RECIBIDO','ASIGNADO','DEVUELTO','ENTREGADO','FALTANTE')
    and not exists (select 1 from public.bodega_eventos a where a.tipo = 'ANULAR' and a.d->>'ref' = e.id::text)
  order by e.guia, e.at desc, e.id desc;
$$;
revoke execute on function public.bodega_estado_guias() from public, anon, authenticated;   -- uso interno

-- ¿La guía está hoy en ruta con ese repartidor?
create or replace function public.bodega_asignada_a(g text, r text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.bodega_estado_guias() x where x.guia = g and x.tipo = 'ASIGNADO' and x.rid = r);
$$;

-- Lo que la Ruta del repartidor muestra como «asignado por la bodega»: solo guía, empresa, hora y la calle/carrera
-- que anotó la bodega (sin datos del cliente). Si la cuenta no está vinculada, no devuelve nada.
create or replace function public.bodega_mis_asignados()
returns table(guia text, emp text, asignado timestamptz, cl int, kr int, rid text)
language sql stable security definer set search_path = public as $$
  with mi as (select rid from public.bodega_vinculos where user_id = auth.uid())
  select x.guia,
    (select r.d->>'emp' from public.bodega_eventos r where r.guia = x.guia and r.tipo in ('RECIBIDO','ESPERADO') and r.d ? 'emp' order by r.at desc limit 1),
    x.at,
    (select (u.d->>'cl')::int from public.bodega_eventos u where u.guia = x.guia and u.tipo = 'UBICACION' and u.d ? 'cl' order by u.at desc limit 1),
    (select (u.d->>'kr')::int from public.bodega_eventos u where u.guia = x.guia and u.tipo = 'UBICACION' and u.d ? 'kr' order by u.at desc limit 1),
    x.rid
  from public.bodega_estado_guias() x join mi on x.rid = mi.rid
  where x.tipo = 'ASIGNADO'
  order by x.at;
$$;
grant execute on function public.bodega_mis_asignados(), public.bodega_mi_rid(), public.bodega_cuentas_ruta() to authenticated;
create index if not exists bodega_eventos_ref on public.bodega_eventos ((d->>'ref')) where tipo = 'ANULAR';

-- ¿El evento «ref» es un reporte (ENTREGADO / NO_ENTREGADO) hecho por quien llama? (el repartidor no lee la tabla)
create or replace function public.bodega_es_mi_reporte(ref text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.bodega_eventos x where x.id::text = ref and x.user_id = auth.uid() and x.tipo in ('ENTREGADO','NO_ENTREGADO'));
$$;

-- El repartidor solo puede: reportar ENTREGADO o NO_ENTREGADO de guías que hoy están en ruta con él, a su nombre,
-- y deshacer (ANULAR) sus propios reportes. No puede leer la tabla de eventos (solo bodega_mis_asignados()).
drop policy if exists "bodega: repartidor reporta" on public.bodega_eventos;
create policy "bodega: repartidor reporta" on public.bodega_eventos
  for insert to authenticated with check (
    (tipo in ('ENTREGADO','NO_ENTREGADO') and d->>'rid' = public.bodega_mi_rid() and public.bodega_asignada_a(guia, d->>'rid'))
    or (tipo = 'ANULAR' and public.bodega_mi_rid() is not null and public.bodega_es_mi_reporte(d->>'ref'))
  );

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
