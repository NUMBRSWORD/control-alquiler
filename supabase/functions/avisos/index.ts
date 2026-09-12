// Función "avisos": manda al celular los avisos de cobro de Mi Alquiler.
//   {accion:"llave"}  → devuelve la llave pública para suscribirse (la crea la primera vez).
//   {accion:"probar"} → con la sesión de la casa, manda un aviso de prueba a sus celulares.
//   {accion:"enviar"} → lo llama la tarea diaria (pg_cron, 7:00 de Lima) con el secreto
//                       x-avisos-secreto; revisa quién paga mañana, hoy o debe, y avisa.
// Las llaves VAPID y el secreto de la tarea viven en la tabla ajustes_privados, que
// solo ve el servidor: nadie tiene que copiarlas ni pegarlas.
// Se despliega con "Verify JWT" apagado; cada acción revisa su propio permiso.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const CASA = "49c5a2cc-9575-40e7-9773-23d68131e983"; // cuenta de la casa
const APP_URL = "https://numbrsword.github.io/control-alquiler/";

/* ---- Reglas de cobro: copia de lib/calc.js ----
   Supabase no deja importar desde la página publicada, así que van aquí.
   Si cambian las reglas en lib/calc.js, hay que copiarlas aquí también. */
// deno-lint-ignore no-explicit-any
type Dato = any;
const pad = (n: number) => String(n).padStart(2, "0");
const ymOf = (iso: string) => (iso || "").slice(0, 7);
const shiftYM = (ym: string, delta: number) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return d.getFullYear() + "-" + pad(d.getMonth() + 1);
};
const ymRange = (desde: string, hasta: string) => {
  const meses: string[] = [];
  let m = desde;
  for (let i = 0; m <= hasta && i < 400; i++) { meses.push(m); m = shiftYM(m, 1); }
  return meses;
};
const diasDelMes = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m, 0).getDate();
};
const fechaVence = (ym: string, dia: unknown) =>
  ym + "-" + pad(Math.min(Math.max(1, Number(dia) || 5), diasDelMes(ym)));
const sumarDias = (iso: string, dias: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  const f = new Date(y, m - 1, d + dias);
  return f.getFullYear() + "-" + pad(f.getMonth() + 1) + "-" + pad(f.getDate());
};
const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) =>
  "S/ " + (Number(n) || 0).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const tieneInquilino = (r: Dato) => !!(r.tenant && String(r.tenant).trim());
const ocupadoEn = (r: Dato, ym: string) => r.active !== false && tieneInquilino(r) && !(r.start && r.start > ym);
const pagadoEn = (data: Dato, id: string, ym: string) =>
  round2((data.payments?.[id]?.[ym] || []).reduce((s: number, p: Dato) => s + (Number(p.amount) || 0), 0));
const faltaMes = (data: Dato, r: Dato, ym: string) =>
  ocupadoEn(r, ym) ? Math.max(0, round2(Number(r.rent || 0) - pagadoEn(data, r.id, ym))) : 0;

function deudaAcumulada(data: Dato, r: Dato, hasta: string) {
  if (!ocupadoEn(r, hasta)) return 0;
  const desde = r.start && r.start <= hasta ? r.start : hasta;
  let deuda = 0;
  for (const m of ymRange(desde, hasta)) deuda += Number(r.rent || 0) - pagadoEn(data, r.id, m);
  return Math.max(0, round2(deuda));
}

// Un día antes del pago, el mismo día, y todos los días mientras haya deuda vencida.
function avisosDelDia(data: Dato, hoy: string) {
  const ym = ymOf(hoy);
  const manana = sumarDias(hoy, 1);
  const avisos: Dato[] = [];
  for (const r of data.rooms || []) {
    if (!ocupadoEn(r, ym)) continue;
    const vence = fechaVence(ym, r.dueDay);
    const falta = faltaMes(data, r, ym);
    const deudaAnterior = deudaAcumulada(data, r, shiftYM(ym, -1));
    const deudaVencida = round2(deudaAnterior + (hoy > vence ? falta : 0));
    if (deudaVencida > 0) avisos.push({ tipo: "debe", room: r, monto: round2(deudaVencida + (hoy > vence ? 0 : falta)) });
    else if (falta > 0 && vence === hoy) avisos.push({ tipo: "hoy", room: r, monto: falta });
    else if (falta > 0 && vence === manana) avisos.push({ tipo: "manana", room: r, monto: falta });
  }
  return avisos;
}

function textoAviso(a: Dato) {
  const quien = a.room.name + " · " + a.room.tenant;
  if (a.tipo === "manana") return { title: "Mañana paga el " + a.room.name + " 📅", body: quien + ": " + money(a.monto) + " vence mañana." };
  if (a.tipo === "hoy") return { title: "Hoy paga el " + a.room.name + " 💰", body: quien + ": " + money(a.monto) + " vence hoy." };
  return { title: "El " + a.room.name + " tiene deuda 😟", body: quien + " debe " + money(a.monto) + "." };
}

/* ---- Servidor ---- */
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
    lotes.push({ cuarto: a.room.id, tipo: a.tipo, aviso: { ...textoAviso(a), tag: "cobro-" + a.room.id + "-" + hoy } });
  }
  const deudores = avisos.filter((x) => x.tipo === "debe");
  if (deudores.length === 1) {
    const a = deudores[0];
    lotes.push({ cuarto: a.room.id, tipo: "debe", aviso: { ...textoAviso(a), tag: "deuda-" + a.room.id + "-" + hoy } });
  } else if (deudores.length > 1) {
    const total = deudores.reduce((s: number, a: Dato) => s + a.monto, 0);
    lotes.push({
      cuarto: "*",
      tipo: "deudas",
      aviso: {
        title: "😟 " + deudores.length + " cuartos con deuda",
        body: "Cuartos " + deudores.map((a: Dato) => a.room.name).join(", ") + ". Total " + money(total) + ".",
        tag: "deudas-" + hoy,
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
      const token = (req.headers.get("authorization") ?? "").replace(/^Bearer /i, "");
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
