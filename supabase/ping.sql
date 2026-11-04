-- Ruta de Entregas · consulta mínima para mantener activo el proyecto gratis de Supabase.
-- La llama GitHub cada 3 días (.github/workflows/supabase-activo.yml). Solo devuelve la hora del servidor:
-- no lee ni expone datos. Pegar en SQL Editor → Run (se puede correr varias veces).
create or replace function public.ping() returns timestamptz
language sql stable set search_path = public as $$ select now() $$;
revoke all on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated;
select public.ping() as hora_servidor;
