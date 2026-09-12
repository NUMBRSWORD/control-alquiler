// Conexión a Supabase (la misma base de datos que ya usa la app).
export const SUPABASE_URL = "https://kfptigkimgxhwatvlruj.supabase.co";
export const SUPABASE_KEY = "sb_publishable_VyhOGRhMTR66qiOrl9LuxQ_4Odbm9-s";

// Clave PÚBLICA para los avisos al celular (Web Push). Se completa cuando se
// configuren los avisos en Supabase; mientras esté vacía, el botón no aparece.
export const VAPID_PUBLIC_KEY = "";

// Entrada con código de números (fácil para toda la familia). La app entra a la
// cuenta única de la casa en Supabase; su clave es PREFIJO_CLAVE + el código que
// escribe la persona. El código no se guarda en ningún archivo.
export const CUENTA_CASA = "casa@mialquiler.example";
export const PREFIJO_CLAVE = "alquiler-";
export const PIN_LARGO = 4;

// Pedir el código para entrar. Se activa cuando la cuenta de la casa exista en
// Supabase; si se activa antes, nadie podría entrar.
export const REQUIRE_LOGIN = true;
