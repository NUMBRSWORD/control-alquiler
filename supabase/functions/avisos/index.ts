// Función "avisos": manda al celular los avisos de cobro de Mi Alquiler.
//   {accion:"llave"}  → devuelve la llave pública para suscribirse (la crea la primera vez).
//   {accion:"probar"} → con la sesión de la casa, manda un aviso de prueba a sus celulares.
//   {accion:"enviar"} → lo llama la tarea diaria (pg_cron, 7:00 de Lima) con el secreto
//                       x-avisos-secreto; revisa quién paga mañana, hoy o debe, y avisa.
// Las llaves VAPID y el secreto de la tarea viven en la tabla ajustes_privados, que
// solo ve el servidor: nadie tiene que copiarlas ni pegarlas.
// Las reglas de cuándo avisar son las mismas de la app (lib/calc.js publicado).
// Se despliega con "Verify JWT" apagado; cada acción revisa su propio permiso.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { avisosDelDia, textoAviso, money } from "https://numbrsword.github.io/control-alquiler/lib/calc.js";

const CASA = "49c5a2cc-9575-40e7-9773-23d68131e983"; // cuenta de la casa
const APP_URL = "https://numbrsword.github.io/control-alquiler/";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-avisos-secreto",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const responder = (cuerpo: unknown, estado = 200) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: { ...cors, "Content-Type": "application/json" } });

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Fecha de hoy en Lima (el servidor corre en UTC).
const hoyLima = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

async function ajuste(clave: string): Promise<string | null> {
  const { data } = await admin.from("ajustes_privados").select("valor").eq("clave", clave).maybeSingle();
  return data?.valor ?? null;
}

// Llaves VAPID: se crean una sola vez y se guardan en ajustes_privados.
async function llaves() {
  let publica = await ajuste("vapid_publica");
  let privada = await ajuste("vapid_privada");
  if (!publica || !privada) {
    const nuevas = webpush.generateVAPIDKeys();
    await admin.from("ajustes_privados").upsert(
      [{ clave: "vapid_publica", valor: nuevas.publicKey }, { clave: "vapid_privada", valor: nuevas.privateKey }],
      { onConflict: "clave", ignoreDuplicates: true },
    );
    publica = await ajuste("vapid_publica");
    privada = await ajuste("vapid_privada");
  }
  return { publica: publica!, privada: privada! };
}

type Aviso = { title: string; body: string; tag: string };

// Manda un aviso a todos los celulares registrados; borra los que ya no existen.
async function mandar(aviso: Aviso) {
  const { publica, privada } = await llaves();
  webpush.setVapidDetails(APP_URL, publica, privada);
  const { data: celulares } = await admin.from("avisos_suscripciones").select("id, endpoint, p256dh, auth");
  let entregados = 0;
  for (const c of celulares ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: c.endpoint, keys: { p256dh: c.p256dh, auth: c.auth } },
        JSON.stringify({ ...aviso, url: APP_URL }),
      );
      entregados++;
    } catch (e) {
      const estado = Number((e as { statusCode?: number }).statusCode);
      if (estado === 404 || estado === 410) await admin.from("avisos_suscripciones").delete().eq("id", c.id);
      else console.error("No se pudo mandar un aviso:", e);
    }
  }
  return entregados;
}

// Evita repetir el mismo aviso el mismo día (por si la tarea corre dos veces).
async function yaAvisado(cuarto: string, tipo: string, fecha: string) {
  const { data } = await admin.from("avisos_enviados").select("id")
    .eq("cuarto", cuarto).eq("tipo", tipo).eq("fecha", fecha).maybeSingle();
  return !!data;
}

async function enviarAvisosDeHoy() {
  const hoy = hoyLima();
  const { data: fila, error } = await admin.from("app_data").select("value").eq("id", "casa:data:v1").maybeSingle();
  if (error) throw error;
  if (!fila) return { fecha: hoy, avisos: 0, enviados: 0 };
  const avisos = avisosDelDia(JSON.parse(fila.value), hoy);

  // Un aviso por cada pago de mañana o de hoy, y uno solo que junta a todos los que deben.
  const lotes: { cuarto: string; tipo: string; aviso: Aviso }[] = [];
  for (const a of avisos.filter((x) => x.tipo !== "debe")) {
    lotes.push({ cuarto: a.room.id, tipo: a.tipo, aviso: { ...textoAviso(a), tag: `cobro-${a.room.id}-${hoy}` } });
  }
  const deudores = avisos.filter((x) => x.tipo === "debe");
  if (deudores.length === 1) {
    const a = deudores[0];
    lotes.push({ cuarto: a.room.id, tipo: "debe", aviso: { ...textoAviso(a), tag: `deuda-${a.room.id}-${hoy}` } });
  } else if (deudores.length > 1) {
    const total = deudores.reduce((s, a) => s + a.monto, 0);
    lotes.push({
      cuarto: "*",
      tipo: "deudas",
      aviso: {
        title: `😟 ${deudores.length} cuartos con deuda`,
        body: `Cuartos ${deudores.map((a) => a.room.name).join(", ")}. Total ${money(total)}.`,
        tag: `deudas-${hoy}`,
      },
    });
  }

  let enviados = 0;
  for (const l of lotes) {
    if (await yaAvisado(l.cuarto, l.tipo, hoy)) continue;
    const n = await mandar(l.aviso);
    if (n > 0) {
      await admin.from("avisos_enviados").insert({ cuarto: l.cuarto, tipo: l.tipo, fecha: hoy });
      enviados += n;
    }
  }
  return { fecha: hoy, avisos: lotes.length, enviados };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  let cuerpo: { accion?: string } = {};
  if (req.method === "POST") {
    try { cuerpo = await req.json(); } catch { /* sin cuerpo */ }
  }
  const accion = req.method === "GET" ? "llave" : cuerpo.accion;
  try {
    if (accion === "llave") return responder({ llave: (await llaves()).publica });

    if (accion === "probar") {
      const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
      const { data } = await admin.auth.getUser(token);
      if (data.user?.id !== CASA) return responder({ error: "sesion" }, 401);
      const entregados = await mandar({ title: "Mi Alquiler 🏠", body: "✅ Listo: aquí te llegarán los avisos de cobro.", tag: "prueba" });
      return responder({ entregados });
    }

    if (accion === "enviar") {
      const secreto = await ajuste("cron_avisos");
      if (!secreto || req.headers.get("x-avisos-secreto") !== secreto) return responder({ error: "no autorizado" }, 403);
      return responder(await enviarAvisosDeHoy());
    }

    return responder({ error: "accion" }, 400);
  } catch (e) {
    console.error(e);
    return responder({ error: "fallo" }, 500);
  }
});
