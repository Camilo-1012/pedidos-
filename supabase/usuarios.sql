-- =====================================================================================
-- Personas del equipo creadas DESDE LA APP (v2.35).
-- Un administrador (equipo_miembros.admin = true) crea, edita, desactiva y cambia la contraseña de las personas
-- desde ☰ → Personas, sin entrar a Supabase. Quien crea las cuentas es la función equipo-usuarios
-- (supabase/functions/equipo-usuarios/index.ts), que corre en Supabase con la llave de servicio: esa llave
-- NUNCA va en la app ni en el repositorio.
--
-- Correr DESPUÉS de equipo.sql y bodega.sql. Pegar COMPLETO en Supabase → SQL Editor → New query → Run.
-- Se puede volver a correr (no borra datos).
-- =====================================================================================

-- Rol en la app y si la persona está activa. Desactivar no borra: su historial y sus entregas siguen siendo prueba.
alter table public.equipo_miembros add column if not exists rol text not null default 'repartidor';
alter table public.equipo_miembros add column if not exists activo boolean not null default true;
alter table public.equipo_miembros drop constraint if exists equipo_miembros_rol_ok;
alter table public.equipo_miembros add constraint equipo_miembros_rol_ok check (rol in ('repartidor','despachador'));
alter table public.equipo_miembros drop constraint if exists equipo_miembros_nombre_ok;
alter table public.equipo_miembros add constraint equipo_miembros_nombre_ok check (char_length(nombre) between 1 and 40);
-- Los administradores y quienes ya están en la bodega quedan como despachadores (como venían trabajando).
update public.equipo_miembros m set rol = 'despachador'
 where rol <> 'despachador' and (m.admin or exists (select 1 from public.bodega_miembros b where b.user_id = m.user_id));

-- Una persona desactivada deja de ser miembro (Ruta y Bodega), aunque tuviera una sesión abierta.
create or replace function public.es_miembro() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.equipo_miembros where user_id = auth.uid() and activo);
$$;
create or replace function public.es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.equipo_miembros where user_id = auth.uid() and admin and activo);
$$;
create or replace function public.bodega_es_miembro() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.bodega_miembros b where b.user_id = auth.uid())
     and not exists (select 1 from public.equipo_miembros m where m.user_id = auth.uid() and not m.activo);
$$;
create or replace function public.bodega_es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.bodega_miembros b where b.user_id = auth.uid() and b.rol = 'admin')
     and not exists (select 1 from public.equipo_miembros m where m.user_id = auth.uid() and not m.activo);
$$;
-- El repartidor desactivado tampoco recibe ni reporta paquetes de la bodega.
create or replace function public.bodega_mi_rid() returns text
language sql stable security definer set search_path = public as $$
  select v.rid from public.bodega_vinculos v
   where v.user_id = auth.uid()
     and not exists (select 1 from public.equipo_miembros m where m.user_id = auth.uid() and not m.activo);
$$;

-- Eventos de la bodega: el servidor sigue poniendo el usuario real. Solo cuando inserta la función equipo-usuarios
-- (llave de servicio, sin usuario) se respeta el user_id que ella manda (el del administrador que creó la persona).
create or replace function public.bodega_eventos_sellar() returns trigger
language plpgsql set search_path = public as $$
begin
  new.srv_at := now();
  new.user_id := coalesce(auth.uid(), new.user_id);
  return new;
end $$;

-- Registro de cambios de personas: quién creó, editó, desactivó o cambió la contraseña de quién.
create table if not exists public.equipo_auditoria (
  id      bigint generated always as identity primary key,
  at      timestamptz not null default now(),
  por     uuid references auth.users(id) on delete set null,
  sobre   uuid references auth.users(id) on delete set null,
  accion  text not null check (accion in ('crear','editar','activar','desactivar','clave')),
  detalle jsonb not null default '{}'::jsonb check (pg_column_size(detalle) < 2000)
);
create index if not exists equipo_auditoria_at on public.equipo_auditoria (at);
alter table public.equipo_auditoria enable row level security;
drop policy if exists "admin ve auditoria" on public.equipo_auditoria;
create policy "admin ve auditoria" on public.equipo_auditoria for select to authenticated using (public.es_admin());
-- Solo la función (llave de servicio) escribe aquí; desde la app nadie inserta, cambia ni borra.
revoke all on public.equipo_auditoria from anon, authenticated;
grant select on public.equipo_auditoria to authenticated;

-- Comprobación: personas, rol, si son administradoras y si están activas.
select m.nombre, m.rol, m.admin, m.activo, u.email
  from public.equipo_miembros m join auth.users u on u.id = m.user_id order by m.nombre;
