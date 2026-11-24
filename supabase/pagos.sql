-- =====================================================================================
-- v2.44: pagos a repartidores por quincena (PAGO) y tarifa por entregado (TARIFA).
-- Correr UNA vez en Supabase → SQL Editor → New query → pegar COMPLETO → Run (se puede volver a correr).
-- No toca datos. Ya está incluido en bodega.sql para instalaciones nuevas.
-- =====================================================================================
alter table public.bodega_eventos drop constraint if exists bodega_eventos_tipo_ok;
alter table public.bodega_eventos add constraint bodega_eventos_tipo_ok check (tipo in
  ('REP','REP_ZONAS','ZONA','LOTE','LOTE_CERRADO','ESPERADO','RECIBIDO','NOVEDAD','UBICACION','ASIGNADO','DEVUELTO','ENTREGADO','NO_ENTREGADO','FALTANTE','ANULAR','PAGO','TARIFA'));
alter table public.bodega_eventos drop constraint if exists bodega_eventos_guia_ok;
alter table public.bodega_eventos add constraint bodega_eventos_guia_ok check ((tipo in ('REP','REP_ZONAS','ZONA','LOTE','LOTE_CERRADO','PAGO','TARIFA')) = (guia is null));
-- Cualquier despachador registra pagos; la tarifa (como repartidores y zonas) solo el administrador.
drop policy if exists "bodega: agregar eventos" on public.bodega_eventos;
create policy "bodega: agregar eventos" on public.bodega_eventos
  for insert to authenticated with check (public.bodega_es_miembro() and (tipo not in ('REP','ZONA','TARIFA') or public.bodega_es_admin()));
drop index if exists public.bodega_eventos_cat2;
create index if not exists bodega_eventos_cat3 on public.bodega_eventos (tipo) where tipo in ('REP','REP_ZONAS','ZONA','LOTE','LOTE_CERRADO','PAGO','TARIFA');
