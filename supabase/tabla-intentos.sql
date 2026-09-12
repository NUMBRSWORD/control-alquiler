-- Registro de intentos de entrar con el código de la casa (lo usa la función
-- "entrar" para frenar a quien pruebe códigos). Nadie de afuera puede leerla
-- ni escribirla: solo la función, con la llave de servicio.
create table if not exists public.intentos_entrar (
  id bigint generated always as identity primary key,
  ip text not null,
  exito boolean not null default false,
  creado timestamptz not null default now()
);
create index if not exists intentos_entrar_ip_creado on public.intentos_entrar (ip, creado);
alter table public.intentos_entrar enable row level security;
revoke all on public.intentos_entrar from anon, authenticated;
