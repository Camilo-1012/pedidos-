# Crear personas desde la app (v2.35) — pasos en Supabase (una sola vez)

Con esto, cualquier **administrador** (Camilo, Luis…) crea, edita, desactiva y cambia la contraseña de las personas
desde la app (☰ → **Personas**), sin entrar a Supabase. La persona entra en su celular con
**«Ya tengo usuario del equipo»**.

Orden: primero estos dos pasos, después se publica la app.

## 1. Script SQL
Supabase → **SQL Editor** → **New query** → pegar COMPLETO `supabase/usuarios.sql` → **Run**.
Al final sale la lista de personas con rol, administrador y activo.
(Se puede volver a correr; no borra nada.)

## 2. Función `equipo-usuarios`
1. Supabase → **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Nombre: `equipo-usuarios` (exacto).
3. Borra el ejemplo y pega COMPLETO `supabase/functions/equipo-usuarios/index.ts`.
4. **Deploy function**.
5. En la función → **Details / Settings**: deja **Verify JWT** activado (así solo responde a sesiones del equipo).

No hay que poner ninguna llave: Supabase le entrega a la función su llave de servicio sola.
Esa llave **nunca** va en la app ni en GitHub.

## Para hacer a alguien administrador
Desde la app: ☰ → Personas → **Editar** → marcar **Administrador**.
Un administrador no puede quitarse a sí mismo ni desactivarse; siempre queda al menos uno.

## Si se cambia la función
Volver a pegarla en el editor de Supabase y **Deploy** (el repositorio y Supabase no se sincronizan solos).

## Límites
- Crear o cambiar personas necesita internet (lo demás de la app sigue sin señal).
- La primera llamada del día tarda 1–2 s (la función arranca).
- Plan gratuito: 500 000 llamadas al mes; esto usa unas pocas.
- Usuario corto (`luis`) = cuenta `luis@ruta.local` (no es un correo real; no llegan correos).
