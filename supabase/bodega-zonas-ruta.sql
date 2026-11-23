-- =====================================================================================
-- v2.36: la zona que le tocó al repartidor le aparece en su Ruta.
-- Correr UNA vez en Supabase → SQL Editor → New query → pegar COMPLETO → Run. Solo cambia esta función
-- (no toca permisos ni datos). Ya está incluida en bodega.sql para instalaciones nuevas.
-- =====================================================================================
-- Lo que la Ruta del repartidor muestra como «asignado por la bodega»: solo guía, empresa, hora, la calle/carrera
-- que anotó la bodega y la zona (v2.36: la del paquete y las del repartidor, guardadas en la asignación). Nada del
-- cliente. Si la cuenta no está vinculada, no devuelve nada.
drop function if exists public.bodega_mis_asignados();
create function public.bodega_mis_asignados()
returns table(guia text, emp text, asignado timestamptz, cl int, kr int, rid text, zona text, zonas jsonb)
language sql stable security definer set search_path = public as $$
  with mi as (select rid from public.bodega_vinculos where user_id = auth.uid())
  select x.guia,
    (select r.d->>'emp' from public.bodega_eventos r where r.guia = x.guia and r.tipo in ('RECIBIDO','ESPERADO') and r.d ? 'emp' order by r.at desc limit 1),
    x.at,
    (select (u.d->>'cl')::int from public.bodega_eventos u where u.guia = x.guia and u.tipo = 'UBICACION' and u.d ? 'cl' order by u.at desc limit 1),
    (select (u.d->>'kr')::int from public.bodega_eventos u where u.guia = x.guia and u.tipo = 'UBICACION' and u.d ? 'kr' order by u.at desc limit 1),
    x.rid,
    (select a.d->>'zona' from public.bodega_eventos a where a.guia = x.guia and a.tipo = 'ASIGNADO' and a.at = x.at limit 1),
    (select a.d->'zonas' from public.bodega_eventos a where a.guia = x.guia and a.tipo = 'ASIGNADO' and a.at = x.at limit 1)
  from public.bodega_estado_guias() x join mi on x.rid = mi.rid
  where x.tipo = 'ASIGNADO'
  order by x.at;
$$;
grant execute on function public.bodega_mis_asignados() to authenticated;
