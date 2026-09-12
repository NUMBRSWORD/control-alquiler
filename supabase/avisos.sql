-- Avisos de cobro al celular (Web Push). Los usa la función "avisos".
create extension if not exists pg_net;
create extension if not exists pg_cron;

-- Celulares que reciben avisos. Solo la cuenta de la casa los registra y los ve.
create table if not exists public.avisos_suscripciones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now()
);
alter table public.avisos_suscripciones enable row level security;
revoke all on public.avisos_suscripciones from anon;
drop policy if exists "la casa registra sus celulares" on public.avisos_suscripciones;
create policy "la casa registra sus celulares" on public.avisos_suscripciones
  for all to authenticated
  using ((select auth.uid()) = '49c5a2cc-9575-40e7-9773-23d68131e983'::uuid)
  with check ((select auth.uid()) = '49c5a2cc-9575-40e7-9773-23d68131e983'::uuid);

-- Avisos ya mandados, para no repetir el mismo aviso el mismo día.
create table if not exists public.avisos_enviados (
  id bigint generated always as identity primary key,
  cuarto text not null,
  tipo text not null,
  fecha date not null,
  creado timestamptz not null default now(),
  unique (cuarto, tipo, fecha)
);
alter table public.avisos_enviados enable row level security;
revoke all on public.avisos_enviados from anon, authenticated;

-- Llaves de los avisos y secreto de la tarea diaria. Solo el servidor los ve.
create table if not exists public.ajustes_privados (
  clave text primary key,
  valor text not null
);
alter table public.ajustes_privados enable row level security;
revoke all on public.ajustes_privados from anon, authenticated;
insert into public.ajustes_privados (clave, valor)
  values ('cron_avisos', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
  on conflict (clave) do nothing;

-- Tarea diaria: 7:00 a. m. de Lima = 12:00 UTC.
select cron.schedule(
  'avisos-cobro-0700',
  '0 12 * * *',
  $$
  select net.http_post(
    url := 'https://kfptigkimgxhwatvlruj.supabase.co/functions/v1/avisos',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-avisos-secreto', (select valor from public.ajustes_privados where clave = 'cron_avisos')
    ),
    body := '{"accion":"enviar"}'::jsonb
  );
  $$
);
