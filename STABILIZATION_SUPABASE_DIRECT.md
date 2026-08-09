# IDG Training Pro - estabilizacion Supabase directo

Fecha: 2026-08-09

## Ramas

- Frontend: `stable-supabase-direct` (`afcbf83`)
- Backend/esquema secundario: `backend-secondary-render` (`6af8bcb`)

## Respaldo local

- `C:\Users\IVAN DOMINGUEZ\IDG TRAINING\_backup_before_supabase_direct_2026-08-09`
- Excluye `.git`, `node_modules`, `.next`, logs y zips.

## Cambios principales

- Login principal movido a Supabase Auth con Google ID token.
- Render deja de ser requisito para entrar a la app principal.
- `lib/cloud-sync.ts` ahora intenta Supabase REST directo para perfil, plan, gym, running, ciclismo, peso, sueno, metas e intelligence.
- Render queda como fallback si Supabase directo no esta configurado y como servicio secundario para Strava.
- Running/ciclismo ya no guardan actividades via `/activities/upsert` de Render; guardan directo en Supabase por bloques pequenos.
- Gym guarda sesiones, ejercicios y series como registros independientes.
- Plan semanal usa `planned_sessions` en lugar de depender de un array largo en `weekly_plan.data`.

## Clasificacion de llamadas

Directas Next.js -> Supabase:

- `/profile`
- `/gym/sessions`
- `/gym/templates`
- `/activities?sport=running`
- `/activities?sport=cycling`
- `/plan`
- `/weight`
- `/sleep`
- `/goals`
- `/intelligence`

Siguen requiriendo backend/Render:

- `/auth/strava`
- `/auth/strava/callback`
- `/strava/sync`
- `/strava/disconnect`
- `/access` para permisos legacy/founder mientras se migra a Supabase

Funciones locales en Vercel, no Render:

- `/api/activity-analysis`
- `/api/gym-analysis`
- `/api/idg-intelligence`
- `/api/profile-analysis`
- `/api/sleep-image-analysis`
- `/api/weight-analysis`
- `/api/weight-image-analysis`

Desactivables temporalmente si Render cae:

- Conexion/sincronizacion/desconexion Strava
- Validacion legacy de acceso premium/founder

## Tablas finales Supabase

Existentes con `owner_id`:

- `user_profiles`
- `gym_sessions`
- `gym_templates`
- `activities`
- `weight_records`
- `sleep_records`
- `goals`
- `weekly_plan`
- `intelligence_entries`

Nuevas:

- `planned_sessions`
- `gym_exercises`
- `gym_sets`

Migracion:

- `backend/migrations/supabase_direct_main.sql`

## Variables de entorno

Frontend/Vercel:

- `NEXT_PUBLIC_GOOGLE_CLIENT_ID`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_API_URL` solo para Render/Strava secundario
- `NEXT_PUBLIC_MAPTILER_KEY` opcional
- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL`

Backend/Render secundario:

- `DATABASE_URL`
- `JWT_SECRET`
- `GOOGLE_CLIENT_ID`
- `STRAVA_CLIENT_ID`
- `STRAVA_CLIENT_SECRET`
- `STRAVA_REDIRECT_URI`
- `STRAVA_WEBHOOK_VERIFY_TOKEN`

## Pruebas ejecutadas

- `npm.cmd run build`: OK.
- Servidor local Next en `http://127.0.0.1:3000`.
- HTTP 200 verificado en:
  - `/dashboard`
  - `/modules/gym`
  - `/modules/running`
  - `/modules/cycling`
  - `/modules/plan`
  - `/profile`

Pendiente antes de produccion:

- Ejecutar `backend/migrations/supabase_direct_main.sql` en Supabase.
- Configurar Google provider en Supabase Auth.
- Cargar variables nuevas en Vercel.
- Publicar branch `stable-supabase-direct`.
- Probar login y sincronizacion real en PC, iPhone e iPad.

