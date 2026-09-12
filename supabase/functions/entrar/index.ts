// Función "entrar": revisa el código de la casa y, si es correcto, devuelve la
// sesión de la cuenta de la casa. La clave de esa cuenta es el secreto
// CLAVE_PREFIJO + el código, así que no aparece en la app ni en este archivo.
// Frena a quien pruebe códigos: pocos intentos fallidos por IP y en total.
//
// Se despliega en Supabase con "Verify JWT" apagado: la app entra sin sesión
// y aquí mismo se revisa el código.
import { createClient } from "npm:@supabase/supabase-js@2";

const CUENTA = "hanshidalgo98@gmail.com";
const MAX_FALLOS_POR_IP = 5; // cada 15 minutos
const MAX_FALLOS_TOTAL = 30; // cada hora, sumando todas las IP

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const responder = (cuerpo: unknown, estado = 200) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return responder({ error: "metodo" }, 405);

  const prefijo = Deno.env.get("CLAVE_PREFIJO");
  if (!prefijo) return responder({ error: "falta CLAVE_PREFIJO" }, 500);

  let codigo = "";
  try { codigo = String((await req.json()).codigo ?? ""); } catch { /* cuerpo vacío o mal formado */ }
  if (!/^\d{4,8}$/.test(codigo)) return responder({ error: "codigo" }, 400);

  const url = Deno.env.get("SUPABASE_URL")!;
  const llaveServicio = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const opciones = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url, llaveServicio, opciones); // solo para la tabla de intentos
  const acceso = createClient(url, llaveServicio, opciones); // solo para iniciar la sesión

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "desconocida";
  const hace15min = new Date(Date.now() - 15 * 60_000).toISOString();
  const haceUnaHora = new Date(Date.now() - 60 * 60_000).toISOString();
  const [porIp, total] = await Promise.all([
    admin.from("intentos_entrar").select("id", { count: "exact", head: true }).eq("ip", ip).eq("exito", false).gte("creado", hace15min),
    admin.from("intentos_entrar").select("id", { count: "exact", head: true }).eq("exito", false).gte("creado", haceUnaHora),
  ]);
  if ((porIp.count ?? 0) >= MAX_FALLOS_POR_IP || (total.count ?? 0) >= MAX_FALLOS_TOTAL) {
    return responder({ error: "espera" }, 429);
  }

  const { data, error } = await acceso.auth.signInWithPassword({ email: CUENTA, password: prefijo + codigo });
  await admin.from("intentos_entrar").insert({ ip, exito: !error });
  if (error || !data.session) return responder({ error: "incorrecto" }, 401);

  return responder({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
});
