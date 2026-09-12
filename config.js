// Conexión a Supabase (la misma base de datos que ya usa la app).
export const SUPABASE_URL = "https://kfptigkimgxhwatvlruj.supabase.co";
export const SUPABASE_KEY = "sb_publishable_VyhOGRhMTR66qiOrl9LuxQ_4Odbm9-s";

// Clave PÚBLICA para los avisos al celular (Web Push). Se completa cuando se
// configuren los avisos en Supabase; mientras esté vacía, el botón no aparece.
export const VAPID_PUBLIC_KEY = "";

// Pedir correo y contraseña para entrar. Se activa cuando tu cuenta exista y
// la base de datos esté protegida en Supabase; si se activa antes, nadie entra.
export const REQUIRE_LOGIN = false;
