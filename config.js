// Conexión a Supabase (la misma base de datos que ya usa la app).
export const SUPABASE_URL = "https://kfptigkimgxhwatvlruj.supabase.co";
export const SUPABASE_KEY = "sb_publishable_VyhOGRhMTR66qiOrl9LuxQ_4Odbm9-s";

// Los avisos al celular los manda la función "avisos" de Supabase
// (supabase/functions/avisos); ella misma entrega su llave pública.

// Entrada con código de números (fácil para toda la familia). El código lo
// revisa la función "entrar" de Supabase (supabase/functions/entrar); la cuenta
// y su clave viven solo allá, nunca en la app.
export const PIN_LARGO = 4;

// Pedir el código para entrar.
export const REQUIRE_LOGIN = true;
