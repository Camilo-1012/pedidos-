-- =====================================================================================
-- v2.41: datos de entrega del listado importado (dirección, teléfono, nombre, barrio, apto) → Ruta del repartidor.
-- Decisión de Camilo (23 nov 2026): al importar el Excel, al repartidor le llega todo para no escribir nada.
-- Ley 1581 (minimización): van en una tabla APARTE del histórico (bodega_eventos sigue sin datos del cliente),
-- solo los ve la bodega y el repartidor al que se le asigna ese paquete, y se BORRAN SOLOS A LOS 30 DÍAS.
-- Correr UNA vez en Supabase → SQL Editor → New query → pegar COMPLETO → Run (se puede volver a correr).
-- =====================================================================================
create table if not exists public.bodega_datos_entrega (
  guia      text primary key check (guia ~ '^[A-Z0-9-]{6,40}$'),
  direccion text check (char_length(direccion) <= 200),
  telefono  text check (char_length(telefono) <= 40),
  nombre    text check (char_length(nombre) <= 80),
  barrio    text check (char_length(barrio) <= 80),
  unidad    text check (char_length(unidad) <= 120),
  creado    timestamptz not null default now(),
  por       uuid default auth.uid()
);
create index if not exists bodega_datos_entrega_creado on public.bodega_datos_entrega (creado);
alter table public.bodega_datos_entrega enable row level security;

-- La bodega (miembros activos) los sube y los lee; nadie los borra desde la app (se borran solos).
drop policy if exists "bodega: ver datos" on public.bodega_datos_entrega;
create policy "bodega: ver datos" on public.bodega_datos_entrega for select to authenticated using (public.bodega_es_miembro());
drop policy if exists "bodega: subir datos" on public.bodega_datos_entrega;
create policy "bodega: subir datos" on public.bodega_datos_entrega for insert to authenticated with check (public.bodega_es_miembro());
drop policy if exists "bodega: cambiar datos" on public.bodega_datos_entrega;
create policy "bodega: cambiar datos" on public.bodega_datos_entrega for update to authenticated using (public.bodega_es_miembro()) with check (public.bodega_es_miembro());
revoke all on public.bodega_datos_entrega from anon;
grant select, insert, update on public.bodega_datos_entrega to authenticated;

-- Borrado automático: cada vez que se suben datos, se eliminan los de más de 30 días (no necesita tareas programadas).
create or replace function public.bodega_datos_purgar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.bodega_datos_entrega where creado < now() - interval '30 days';
  return null;
end $$;
drop trigger if exists bodega_datos_purgar on public.bodega_datos_entrega;
create trigger bodega_datos_purgar after insert on public.bodega_datos_entrega
  for each statement execute function public.bodega_datos_purgar();

-- El repartidor: solo los datos de los paquetes que HOY están en ruta con él (no lee la tabla).
create or replace function public.bodega_mis_datos()
returns table(guia text, direccion text, telefono text, nombre text, barrio text, unidad text)
language sql stable security definer set search_path = public as $$
  select d.guia, d.direccion, d.telefono, d.nombre, d.barrio, d.unidad
  from public.bodega_datos_entrega d
  join public.bodega_estado_guias() x on x.guia = d.guia
  where x.tipo = 'ASIGNADO' and x.rid = public.bodega_mi_rid() and d.creado > now() - interval '30 days';
$$;
grant execute on function public.bodega_mis_datos() to authenticated;

-- Comprobación: cuántos datos hay y el más viejo.
select count(*) as datos, min(creado) as mas_viejo from public.bodega_datos_entrega;
