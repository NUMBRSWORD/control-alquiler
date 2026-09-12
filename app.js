// Mi Alquiler — control de la casa desde el celular.
// Sin paso de compilación: Preact + htm se cargan desde esm.sh y este archivo
// se lee y se edita tal cual. Los cálculos (deuda, caja, avisos) están en
// lib/calc.js y tienen pruebas en lib/calc.test.js.
import { h, render } from "https://esm.sh/preact@10.24.3";
import { useState, useEffect, useRef } from "https://esm.sh/preact@10.24.3/hooks";
import htm from "https://esm.sh/htm@3.1.1";
import * as C from "./lib/calc.js";
import { demoData } from "./lib/demo.js";
import { SUPABASE_URL, SUPABASE_KEY, VAPID_PUBLIC_KEY, REQUIRE_LOGIN } from "./config.js";

const html = htm.bind(h);
const { money, ymLabel, todayISO, thisYM, fechaLarga } = C;

const KEY_DATA = "casa:data:v1";
const contractKey = (id) => `casa:contrato:${id}`;
const DEMO = new URLSearchParams(location.search).has("demo");

const CARA = { pagado: "😄", parcial: "🙂", pendiente: "😟", libre: "💤", inactivo: "🚫" };
const ESTADO_TXT = { pagado: "Pagó este mes", parcial: "Pagó una parte", pendiente: "Todavía no paga", libre: "Cuarto libre", inactivo: "No se alquila" };
const ICONO_METODO = { Efectivo: "💵", Yape: "📱", Plin: "📲", Transferencia: "🏦", Depósito: "🏧", Otro: "✨" };
const ICONO_CAT = {
  Agua: "💧", Luz: "💡", Gas: "🔥", Tributos: "🏛️", Arbitrios: "📜", Internet: "📶", Mantenimiento: "🛠️",
  Limpieza: "🧹", Reparación: "🔧", Materiales: "🧱", Personal: "👷", Transporte: "🚕", Otro: "📦",
};

const uid = () => Math.random().toString(36).slice(2, 10);
const plural = (n, s = "s") => (n === 1 ? "" : s);
const primerNombre = (s) => {
  const w = String(s || "").trim().split(/\s+/)[0] || "";
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
};
const waLink = (tel, texto) => {
  let n = String(tel || "").replace(/\D/g, "");
  if (n.length === 9) n = "51" + n; // celular peruano sin código de país
  return `https://wa.me/${n}?text=${encodeURIComponent(texto)}`;
};
const textoCobro = (room, monto) =>
  `Hola ${primerNombre(room.tenant)}, te recuerdo el pago del alquiler del cuarto ${room.name}: ${money(monto)}. ¡Gracias! 🙂`;

/* ---------- datos: Supabase (o memoria en modo de prueba) ---------- */
let promesaCliente = null;
const supabase = () =>
  (promesaCliente ??= import("https://esm.sh/@supabase/supabase-js@2.45.4").then((m) => m.createClient(SUPABASE_URL, SUPABASE_KEY)));

const memoriaDemo = new Map([[KEY_DATA, JSON.stringify(demoData())]]);
const storage = DEMO
  ? {
      async get(k) { return memoriaDemo.get(k) ?? null; },
      async set(k, v) { memoriaDemo.set(k, v); },
      async del(k) { memoriaDemo.delete(k); },
    }
  : {
      async get(k) {
        const sb = await supabase();
        const { data, error } = await sb.from("app_data").select("value").eq("id", k).maybeSingle();
        if (error) throw error;
        return data ? data.value : null;
      },
      async set(k, v) {
        const sb = await supabase();
        const { error } = await sb.from("app_data").upsert({ id: k, value: v, updated_at: new Date().toISOString() });
        if (error) throw error;
      },
      async del(k) {
        const sb = await supabase();
        const { error } = await sb.from("app_data").delete().eq("id", k);
        if (error) throw error;
      },
    };

function cuartosBase() {
  const rooms = [];
  for (const f of C.FLOORS) {
    for (let i = 1; i <= f.count; i++) {
      const id = `${f.n}${C.pad(i)}`;
      rooms.push({ id, floor: f.n, name: id, tenant: "", doc: "", phone: "", rent: 0, deposit: 0, start: "", dueDay: 5, active: true, notes: "", ubicacion: "" });
    }
  }
  return rooms;
}

// Completa datos guardados por versiones anteriores sin perder nada.
function normalizar(d = {}) {
  const base = cuartosBase();
  const guardados = new Map((d.rooms || []).map((r) => [r.id, r]));
  const rooms = base.map((r) => ({ ...r, ...(guardados.get(r.id) || {}) }));
  for (const r of d.rooms || []) if (!base.some((b) => b.id === r.id)) rooms.push({ ubicacion: "", ...r });
  return {
    ...d,
    landlord: { name: "", doc: "", address: "", phone: "", email: "", ...(d.landlord || {}) },
    rooms,
    payments: d.payments || {},
    generalExpenses: d.generalExpenses || [],
    dailyExpenses: d.dailyExpenses || [],
  };
}

function descargar(contenido, nombre, tipo) {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  const a = document.createElement("a");
  a.href = url; a.download = nombre; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ---------- instalación y service worker ---------- */
let eventoInstalar = null;
addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  eventoInstalar = e;
  dispatchEvent(new Event("instalable"));
});
if ("serviceWorker" in navigator) {
  addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch((e) => console.warn("Service worker:", e)));
}

const b64aBytes = (s) => {
  const relleno = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob((s + relleno).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function activarAvisos(sesion) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new Error("Este celular no permite avisos. En iPhone, primero instala la app en la pantalla de inicio.");
  }
  const permiso = await Notification.requestPermission();
  if (permiso !== "granted") throw new Error("No diste permiso para los avisos.");
  const reg = await navigator.serviceWorker.ready;
  const sus = (await reg.pushManager.getSubscription()) ||
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64aBytes(VAPID_PUBLIC_KEY) }));
  const j = sus.toJSON();
  const sb = await supabase();
  const { error } = await sb.from("avisos_suscripciones").upsert({
    endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth,
    user_id: sesion?.user?.id ?? null, updated_at: new Date().toISOString(),
  }, { onConflict: "endpoint" });
  if (error) throw error;
}

function exportarICS(data, avisar) {
  const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z";
  const ym = thisYM();
  const eventos = data.rooms.filter((r) => C.ocupadoEn(r, ym) && Number(r.rent) > 0).map((r) => {
    const dia = Math.min(Math.max(1, Number(r.dueDay) || 5), 28);
    const inicio = C.fechaVence(ym, dia).replace(/-/g, "");
    return [
      "BEGIN:VEVENT",
      `UID:cuarto-${r.id}@controlalquiler`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${inicio}`,
      `RRULE:FREQ=MONTHLY;BYMONTHDAY=${dia}`,
      `SUMMARY:Cobrar alquiler — Cuarto ${r.name} (${r.tenant})`,
      `DESCRIPTION:Monto ${money(r.rent)}. Tel: ${r.phone || "—"}`,
      "BEGIN:VALARM", "TRIGGER:-PT15H", "ACTION:DISPLAY", "DESCRIPTION:Mañana vence un alquiler", "END:VALARM",
      "BEGIN:VALARM", "TRIGGER:PT9H", "ACTION:DISPLAY", "DESCRIPTION:Hoy vence un alquiler", "END:VALARM",
      "END:VEVENT",
    ].join("\r\n");
  });
  if (!eventos.length) return avisar("Primero registra inquilinos y montos.");
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Control de Alquiler//ES", "CALSCALE:GREGORIAN", ...eventos, "END:VCALENDAR"].join("\r\n");
  descargar(ics, "cobros-alquiler.ics", "text/calendar");
  avisar("📅 Archivo descargado. Súbelo a Google Calendar.");
}

/* ---------- hojas: pantallas que se abren encima ---------- */
// El botón "atrás" del celular cierra la hoja de arriba en vez de salir de la app.
const pilaHojas = [];
addEventListener("popstate", () => { const cerrar = pilaHojas[pilaHojas.length - 1]; if (cerrar) cerrar(); });

function Hoja({ titulo, sub, onClose, children }) {
  const cerrarRef = useRef(onClose);
  cerrarRef.current = onClose;
  useEffect(() => {
    const cerrar = () => cerrarRef.current();
    pilaHojas.push(cerrar);
    history.pushState({ hoja: pilaHojas.length }, "");
    const tecla = (e) => { if (e.key === "Escape" && pilaHojas[pilaHojas.length - 1] === cerrar) history.back(); };
    addEventListener("keydown", tecla);
    document.body.classList.add("con-hoja");
    return () => {
      const i = pilaHojas.indexOf(cerrar);
      if (i >= 0) pilaHojas.splice(i, 1);
      removeEventListener("keydown", tecla);
      if (!pilaHojas.length) document.body.classList.remove("con-hoja");
    };
  }, []);
  return html`
    <div class="velo" onClick=${(e) => { if (e.target === e.currentTarget) history.back(); }}>
      <div class="hoja" role="dialog" aria-label=${titulo}>
        <div class="hoja-h no-imprimir">
          <button class="volver" onClick=${() => history.back()} aria-label="Volver">‹</button>
          <div><h2>${titulo}</h2>${sub && html`<p>${sub}</p>`}</div>
        </div>
        <div class="hoja-b">${children}</div>
      </div>
    </div>`;
}

function Campo({ label, valor, onInput, tipo = "text", ...resto }) {
  return html`
    <label class="campo">
      <span>${label}</span>
      <input type=${tipo} value=${valor ?? ""} onInput=${(e) => onInput(e.currentTarget.value)} ...${resto} />
    </label>`;
}

function MiniCuadro({ data, room, ym }) {
  const st = C.estadoCuarto(data, room, ym);
  const u = C.ubicacionDe(room.ubicacion);
  return html`
    <span class=${"mini-cuadro " + st} aria-hidden="true">
      <span class="mc-cara">${CARA[st]}</span>${room.name}
      ${u && html`<span class="mc-u">${u.icon}</span>`}
    </span>`;
}

function Cuadro({ data, room, ym, onClick }) {
  const st = C.estadoCuarto(data, room, ym);
  const u = C.ubicacionDe(room.ubicacion);
  const ocupado = C.ocupadoEn(room, ym);
  const deuda = C.deudaAcumulada(data, room, ym);
  const monto = !ocupado ? money(room.rent) : deuda > 0 ? `debe ${money(deuda)}` : money(C.pagadoEn(data, room.id, ym));
  return html`
    <button class=${"cuadro " + st} onClick=${onClick}
      aria-label=${`Cuarto ${room.name}: ${ESTADO_TXT[st]}${ocupado ? ", " + room.tenant : ""}`}>
      <span class="cuadro-n">${room.name}</span>
      <span class="cuadro-u" title=${u ? u.label : "Sin ubicación"}>${u ? u.icon : ""}</span>
      <span class="cuadro-cara">${CARA[st]}</span>
      <span class="cuadro-nombre">${ocupado ? primerNombre(room.tenant) : "Libre"}</span>
      <span class="cuadro-monto">${monto}</span>
    </button>`;
}

/* =====================  INICIO DE SESIÓN  ===================== */
function traducirError(e) {
  const m = String(e?.message || e || "");
  if (/invalid login/i.test(m)) return "Correo o contraseña incorrectos.";
  if (/not confirmed/i.test(m)) return "Primero confirma tu correo: revisa tu bandeja de entrada.";
  if (/at least 6/i.test(m)) return "La contraseña debe tener al menos 6 caracteres.";
  if (/signups? not allowed|disabled/i.test(m)) return "No se pueden crear cuentas nuevas.";
  if (/already registered/i.test(m)) return "Ese correo ya tiene cuenta. Usa “Entrar”.";
  return m || "Algo salió mal. Inténtalo de nuevo.";
}

function Login() {
  const [modo, setModo] = useState("entrar");
  const [email, setEmail] = useState("");
  const [clave, setClave] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const enviar = async (e) => {
    e.preventDefault();
    setOcupado(true); setMensaje("");
    try {
      const sb = await supabase();
      if (modo === "entrar") {
        const { error } = await sb.auth.signInWithPassword({ email, password: clave });
        if (error) throw error;
      } else {
        const { error } = await sb.auth.signUp({ email, password: clave, options: { emailRedirectTo: location.origin + location.pathname } });
        if (error) throw error;
        setMensaje("📧 Te enviamos un correo. Ábrelo para confirmar tu cuenta y luego entra aquí.");
        setModo("entrar");
      }
    } catch (err) {
      setMensaje(traducirError(err));
    } finally {
      setOcupado(false);
    }
  };

  return html`
    <div class="pantalla-centro">
      <form class="card login" onSubmit=${enviar}>
        <div class="grande">🏠</div>
        <h1>Mi Alquiler</h1>
        <p>${modo === "entrar" ? "Entra con tu correo y contraseña." : "Crea tu cuenta (solo la primera vez)."}</p>
        <${Campo} label="Correo" tipo="email" valor=${email} onInput=${setEmail} autocomplete="username" required />
        <${Campo} label="Contraseña" tipo="password" valor=${clave} onInput=${setClave}
          autocomplete=${modo === "entrar" ? "current-password" : "new-password"} required minlength="6" />
        ${mensaje && html`<p class="mensaje" role="alert">${mensaje}</p>`}
        <button class="btn primario ancho" type="submit" disabled=${ocupado}>
          ${ocupado ? "Un momento…" : modo === "entrar" ? "Entrar" : "Crear mi cuenta"}
        </button>
        <button type="button" class="enlace-txt" onClick=${() => { setModo(modo === "entrar" ? "crear" : "entrar"); setMensaje(""); }}>
          ${modo === "entrar" ? "¿Primera vez? Crear mi cuenta" : "Ya tengo cuenta: entrar"}
        </button>
      </form>
    </div>`;
}

/* =====================  APP  ===================== */
function App() {
  const [sesion, setSesion] = useState(DEMO || !REQUIRE_LOGIN ? null : undefined);
  useEffect(() => {
    if (DEMO || !REQUIRE_LOGIN) return;
    let sub;
    supabase().then(async (sb) => {
      const { data } = await sb.auth.getSession();
      setSesion(data.session);
      sub = sb.auth.onAuthStateChange((_evento, s) => setSesion(s)).data.subscription;
    }).catch(() => setSesion(null));
    return () => sub?.unsubscribe();
  }, []);

  if (sesion === undefined) return html`<div class="cargando"><span class="rebote">🏠</span> Cargando…</div>`;
  if (REQUIRE_LOGIN && !DEMO && !sesion) return html`<${Login} />`;
  return html`<${Casa} sesion=${sesion} />`;
}

const PESTANAS = [
  ["inicio", "🏠", "Inicio"],
  ["cuartos", "🚪", "Cuartos"],
  ["gastos", "🧾", "Gastos"],
  ["total", "📊", "Total"],
  ["ajustes", "⚙️", "Ajustes"],
];

function Casa({ sesion }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("inicio");
  const [ym, setYm] = useState(thisYM());
  const [cuartoId, setCuartoId] = useState(null);
  const [lista, setLista] = useState(null);
  const [comprobante, setComprobante] = useState(null);
  const [reporte, setReporte] = useState(null);
  const [toast, setToast] = useState("");
  const tToast = useRef(0);
  const sucio = useRef(false);    // hay cambios sin guardar
  const version = useRef(0);      // sube con cada cambio
  const cola = useRef(Promise.resolve());
  const ultimo = useRef(null);
  ultimo.current = data;

  const avisar = (m) => {
    setToast(m);
    clearTimeout(tToast.current);
    tToast.current = setTimeout(() => setToast(""), 2800);
  };

  const cargar = async () => {
    try {
      const v = await storage.get(KEY_DATA);
      if (sucio.current) return; // hubo cambios mientras cargaba: no pisarlos
      setData(normalizar(v ? JSON.parse(v) : {}));
      setError("");
    } catch (e) {
      console.error(e);
      if (!ultimo.current) setError("No se pudieron cargar tus datos. Revisa tu internet e inténtalo otra vez.");
    }
  };

  // Los guardados van en fila, uno detrás de otro, para que uno viejo nunca pise a uno nuevo.
  const guardarAhora = () => {
    cola.current = cola.current.then(async () => {
      if (!sucio.current || !ultimo.current) return;
      const v = version.current;
      try {
        await storage.set(KEY_DATA, JSON.stringify(ultimo.current));
        if (version.current === v) sucio.current = false;
      } catch (e) {
        console.error(e);
        avisar("⚠️ No se pudo guardar. Revisa tu internet.");
      }
    });
    return cola.current;
  };

  useEffect(() => { cargar(); }, []);
  useEffect(() => {
    if (!sucio.current) return;
    const t = setTimeout(guardarAhora, 400);
    return () => clearTimeout(t);
  }, [data]);
  useEffect(() => {
    // Al salir de la app se guarda enseguida; al volver se trae lo último (por si se cambió en otro celular).
    const alCambiar = () => { if (document.visibilityState === "hidden") guardarAhora(); else if (!sucio.current) cargar(); };
    const alConectar = () => guardarAhora();
    document.addEventListener("visibilitychange", alCambiar);
    addEventListener("online", alConectar);
    return () => { document.removeEventListener("visibilitychange", alCambiar); removeEventListener("online", alConectar); };
  }, []);

  const upd = (fn) => {
    sucio.current = true; version.current++;
    setData((d) => { const c = structuredClone(d); fn(c); return c; });
  };
  const reemplazar = (d) => { sucio.current = true; version.current++; setData(normalizar(d)); };

  if (!data) {
    return error
      ? html`<div class="pantalla-centro"><div class="card login">
          <div class="grande">😵</div><p>${error}</p>
          <button class="btn primario" onClick=${() => { setError(""); cargar(); }}>Reintentar</button>
        </div></div>`
      : html`<div class="cargando"><span class="rebote">🏠</span> Cargando tus datos…</div>`;
  }

  const room = cuartoId ? data.rooms.find((r) => r.id === cuartoId) : null;
  const irAMes = (m) => { setYm(m); setTab("inicio"); scrollTo(0, 0); };
  const cambiarTab = (k) => { setTab(k); scrollTo(0, 0); };

  return html`
    <div class="app">
      <header class="top">
        <div class="marca">
          <span class="logo">🏠</span>
          <div><b>Mi Alquiler</b><small>${data.landlord.address || "Casa de 3 pisos · 18 cuartos"}</small></div>
        </div>
        <div class="mes">
          <button onClick=${() => setYm(C.shiftYM(ym, -1))} aria-label="Mes anterior">‹</button>
          <span>${ymLabel(ym)}</span>
          <button onClick=${() => setYm(C.shiftYM(ym, 1))} aria-label="Mes siguiente">›</button>
        </div>
      </header>
      ${DEMO && html`<div class="franja-demo">🧪 Modo de prueba: los datos son inventados y no se guardan.</div>`}

      <main class="contenido">
        ${tab === "inicio" && html`<${Inicio} data=${data} ym=${ym} abrirLista=${setLista} irA=${cambiarTab} abrirCuarto=${setCuartoId} />`}
        ${tab === "cuartos" && html`<${Cuartos} data=${data} ym=${ym} abrirCuarto=${setCuartoId} />`}
        ${tab === "gastos" && html`<${Gastos} data=${data} ym=${ym} upd=${upd} avisar=${avisar} />`}
        ${tab === "total" && html`<${Total} data=${data} ym=${ym} irAMes=${irAMes} />`}
        ${tab === "ajustes" && html`<${Ajustes} data=${data} upd=${upd} reemplazar=${reemplazar} avisar=${avisar} sesion=${sesion} />`}
      </main>

      <nav class="abajo" aria-label="Secciones">
        ${PESTANAS.map(([k, ico, txt]) => html`
          <button key=${k} class=${tab === k ? "on" : ""} onClick=${() => cambiarTab(k)} aria-current=${tab === k ? "page" : undefined}>
            <span aria-hidden="true">${ico}</span>${txt}
          </button>`)}
      </nav>

      ${lista === "cobrado" && html`<${ListaCobrado} data=${data} ym=${ym} onClose=${() => setLista(null)} abrirCuarto=${setCuartoId} />`}
      ${lista === "deuda" && html`<${ListaDeuda} data=${data} ym=${ym} onClose=${() => setLista(null)} abrirCuarto=${setCuartoId} />`}
      ${room && html`<${HojaCuarto} key=${room.id} data=${data} room=${room} ym=${ym} upd=${upd} avisar=${avisar}
        onClose=${() => setCuartoId(null)}
        onComprobante=${() => setComprobante({ roomId: room.id, ym })}
        onReporte=${() => setReporte({ roomId: room.id })} />`}
      ${comprobante && html`<${HojaComprobante} data=${data} room=${data.rooms.find((r) => r.id === comprobante.roomId)}
        ym=${comprobante.ym} onClose=${() => setComprobante(null)} avisar=${avisar} />`}
      ${reporte && html`<${HojaReporte} data=${data} room=${data.rooms.find((r) => r.id === reporte.roomId)}
        ym=${ym} onClose=${() => setReporte(null)} avisar=${avisar} />`}
      ${toast && html`<div class="toast" role="status">${toast}</div>`}
    </div>`;
}

/* =====================  INICIO  ===================== */
function Inicio({ data, ym, abrirLista, irA, abrirCuarto }) {
  const r = C.resumenMes(data, ym);
  const hoy = todayISO();
  const pagaron = C.listaCobrados(data, ym).length;
  const deben = C.listaPorCobrar(data, ym, hoy).length;
  const pct = r.esperado > 0 ? Math.min(100, Math.round((r.cobrado / r.esperado) * 100)) : 0;
  const avisos = ym === thisYM() ? C.avisosDelDia(data, hoy) : [];

  return html`
    <section class="saludo">
      <h1>¡Hola! 👋</h1>
      <p>Así va <b>${ymLabel(ym)}</b></p>
      <div class="barra" role="progressbar" aria-valuenow=${pct} aria-valuemin="0" aria-valuemax="100"><div style=${{ width: pct + "%" }}></div></div>
      <small>${pct}% cobrado de ${money(r.esperado)} · ${r.ocupados} cuartos ocupados, ${r.libres} libre${plural(r.libres)}</small>
    </section>

    <div class="tiles">
      <button class="tile verde" onClick=${() => abrirLista("cobrado")}>
        <span class="tile-ico">💰</span><span class="tile-t">Cobrado</span><b>${money(r.cobrado)}</b>
        <small>${pagaron} cuarto${plural(pagaron)} ${pagaron === 1 ? "pagó" : "pagaron"} · toca para ver</small>
      </button>
      <button class="tile rojo" onClick=${() => abrirLista("deuda")}>
        <span class="tile-ico">😟</span><span class="tile-t">Deuda</span><b>${money(r.deudaTotal)}</b>
        <small>${deben} cuarto${plural(deben)} por cobrar · de este mes ${money(r.porCobrar)}</small>
      </button>
      <button class="tile morado" onClick=${() => irA("gastos")}>
        <span class="tile-ico">🧾</span><span class="tile-t">Gastos</span><b>${money(r.gastos)}</b>
        <small>todo lo que gastaste este mes</small>
      </button>
    </div>

    <section class="caja">
      <span class="caja-ico" aria-hidden="true">🐷</span>
      <div>
        <small>Queda en caja de ${ymLabel(ym)}</small>
        <b class=${r.caja < 0 ? "neg" : ""}>${money(r.caja)}</b>
        <small>Solo este mes: cobrado menos gastos</small>
      </div>
    </section>
    <button class="enlace" onClick=${() => irA("total")}>📊 Ver el total de todos los meses →</button>

    ${avisos.length > 0 && html`
      <section class="card">
        <h2>🔔 Para hoy</h2>
        <ul class="filas">
          ${avisos.map((a) => {
            const t = C.textoAviso(a);
            return html`<li key=${a.room.id}>
              <button class="fila" onClick=${() => abrirCuarto(a.room.id)}>
                <${MiniCuadro} data=${data} room=${a.room} ym=${ym} />
                <span class="fila-main"><b>${t.title}</b><small>${t.body}</small></span>
              </button>
            </li>`;
          })}
        </ul>
      </section>`}
  `;
}

function ListaCobrado({ data, ym, onClose, abrirCuarto }) {
  const lista = C.listaCobrados(data, ym);
  const total = lista.reduce((s, x) => s + x.pagado, 0);
  return html`
    <${Hoja} titulo="💰 Cobrado" sub=${ymLabel(ym)} onClose=${onClose}>
      <div class="total-hoja verde"><span>Total cobrado</span><b>${money(total)}</b></div>
      ${lista.length === 0
        ? html`<p class="vacio">Todavía nadie pagó en ${ymLabel(ym)}.</p>`
        : html`<div class="lista-cuartos">
            ${lista.map((x) => html`
              <button class="item" key=${x.room.id} onClick=${() => abrirCuarto(x.room.id)}>
                <${MiniCuadro} data=${data} room=${x.room} ym=${ym} />
                <span class="item-main">
                  <b>${x.room.tenant || "Sin inquilino"}</b>
                  ${x.pagos.map((p) => html`<small key=${p.id}>${ICONO_METODO[p.method] || "💵"} ${p.date} · ${p.method} · ${money(p.amount)}</small>`)}
                </span>
                <b class="monto verde">${money(x.pagado)}</b>
              </button>`)}
          </div>`}
    <//>`;
}

function ListaDeuda({ data, ym, onClose, abrirCuarto }) {
  const lista = C.listaPorCobrar(data, ym, todayISO());
  const total = lista.reduce((s, x) => s + x.deuda, 0);
  return html`
    <${Hoja} titulo="😟 Por cobrar" sub=${ymLabel(ym)} onClose=${onClose}>
      <div class="total-hoja rojo"><span>Deuda total hasta ${ymLabel(ym)}</span><b>${money(total)}</b></div>
      ${lista.length === 0
        ? html`<p class="vacio">🎉 ¡Nadie debe! Todos están al día.</p>`
        : html`<div class="lista-cuartos">
            ${lista.map((x) => html`
              <div class="item" key=${x.room.id}>
                <button class="item-abrir" onClick=${() => abrirCuarto(x.room.id)}>
                  <${MiniCuadro} data=${data} room=${x.room} ym=${ym} />
                  <span class="item-main">
                    <b>${x.room.tenant}</b>
                    <small>${x.falta > 0 ? `Este mes falta ${money(x.falta)}` : "Este mes ya pagó"}</small>
                    ${x.deuda > x.falta && html`<small>Meses anteriores: ${money(x.deuda - x.falta)}</small>`}
                    ${x.falta > 0
                      ? html`<small class=${x.vencido ? "vencido" : ""}>${x.vencido ? "⏰ Venció el " : "📅 Vence el "}${fechaLarga(x.vence)}</small>`
                      : html`<small class="vencido">⏰ Debe de meses anteriores</small>`}
                  </span>
                  <b class="monto rojo">${money(x.deuda)}</b>
                </button>
                ${x.room.phone && html`<a class="wa" href=${waLink(x.room.phone, textoCobro(x.room, x.deuda))} target="_blank" rel="noopener" aria-label=${`Recordar por WhatsApp a ${x.room.tenant}`}>💬</a>`}
              </div>`)}
          </div>`}
    <//>`;
}

/* =====================  CUARTOS  ===================== */
const FILTROS_ESTADO = [["todos", "🏠 Todos"], ["pagado", "😄 Pagó"], ["parcial", "🙂 Una parte"], ["pendiente", "😟 Debe"], ["libre", "💤 Libre"]];

function Cuartos({ data, ym, abrirCuarto }) {
  const [ubic, setUbic] = useState("todas");
  const [estado, setEstado] = useState("todos");
  const [q, setQ] = useState("");
  const filtrosUbic = [["todas", "🏠 Todas"], ...C.UBICACIONES.map((u) => [u.id, `${u.icon} ${u.label}`]), ["sin", "❔ Sin marcar"]];

  const pasa = (r) => {
    if (ubic === "sin" && r.ubicacion) return false;
    if (ubic !== "todas" && ubic !== "sin" && r.ubicacion !== ubic) return false;
    if (estado !== "todos" && C.estadoCuarto(data, r, ym) !== estado) return false;
    if (q && !`${r.name} ${r.tenant} ${r.doc}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  };
  const pisos = [...C.FLOORS].reverse();
  const hayAlguno = data.rooms.some(pasa);

  return html`
    <section class="card">
      <label class="buscar">🔍<input value=${q} onInput=${(e) => setQ(e.currentTarget.value)} placeholder="Buscar cuarto, nombre o DNI" aria-label="Buscar" /></label>
      <p class="etq">¿Dónde está?</p>
      <div class="chips desliza">
        ${filtrosUbic.map(([k, t]) => html`<button key=${k} class=${"chip" + (ubic === k ? " on" : "")} onClick=${() => setUbic(k)}>${t}</button>`)}
      </div>
      <p class="etq">¿Cómo va?</p>
      <div class="chips desliza">
        ${FILTROS_ESTADO.map(([k, t]) => html`<button key=${k} class=${"chip" + (estado === k ? " on" : "")} onClick=${() => setEstado(k)}>${t}</button>`)}
      </div>
    </section>
    ${!hayAlguno && html`<p class="vacio">No hay cuartos con ese filtro.</p>`}
    ${pisos.map((f) => {
      const lista = data.rooms.filter((r) => r.floor === f.n && pasa(r));
      if (!lista.length) return null;
      return html`
        <section class="card piso" key=${f.n}>
          <h2>🏢 Piso ${f.n} <small>${lista.length} cuarto${plural(lista.length)}</small></h2>
          <div class="cuadros">
            ${lista.map((r) => html`<${Cuadro} key=${r.id} data=${data} room=${r} ym=${ym} onClick=${() => abrirCuarto(r.id)} />`)}
          </div>
        </section>`;
    })}
  `;
}

/* =====================  DETALLE DE UN CUARTO  ===================== */
function HojaCuarto({ data, room, ym, upd, avisar, onClose, onComprobante, onReporte }) {
  const fechaDefecto = () => (ym === thisYM() ? todayISO() : `${ym}-01`);
  const [edit, setEdit] = useState(() => ({ ...room }));
  const [inicioTocado, setInicioTocado] = useState(false);
  const [monto, setMonto] = useState("");
  const [metodo, setMetodo] = useState("Efectivo");
  const [fecha, setFecha] = useState(fechaDefecto);
  const [nota, setNota] = useState("");
  const [contrato, setContrato] = useState(null);
  const [subiendo, setSubiendo] = useState(false);
  const archivo = useRef(null);

  useEffect(() => { setFecha(fechaDefecto()); }, [ym]);
  useEffect(() => {
    let vivo = true;
    storage.get(contractKey(room.id))
      .then((v) => { if (vivo) setContrato(v ? JSON.parse(v) : null); })
      .catch(() => { if (vivo) setContrato(null); });
    return () => { vivo = false; };
  }, [room.id]);

  const pagos = C.pagosDe(data, room.id, ym);
  const pagado = C.pagadoEn(data, room.id, ym);
  const falta = C.faltaMes(data, room, ym);
  const deuda = C.deudaAcumulada(data, room, ym);
  const st = C.estadoCuarto(data, room, ym);
  const u = C.ubicacionDe(room.ubicacion);
  const hayCambios = JSON.stringify(edit) !== JSON.stringify(room);

  const set = (k) => (v) => setEdit((e) => ({ ...e, [k]: v }));
  const cambiarInquilino = (v) => setEdit((e) => {
    const n = { ...e, tenant: v };
    // Cuarto libre que recibe inquilino: su mes de inicio es este mes, así no
    // le cobra los meses en que el cuarto estuvo vacío.
    if (!inicioTocado && !C.tieneInquilino(room)) n.start = v.trim() ? thisYM() : room.start;
    return n;
  });
  const cambioDeInquilino = C.tieneInquilino(room) && String(edit.tenant || "").trim() &&
    String(edit.tenant).trim().toLowerCase() !== room.tenant.trim().toLowerCase() && edit.start === room.start;

  const guardar = () => {
    const guardado = { ...edit, rent: Number(edit.rent) || 0, deposit: Number(edit.deposit) || 0 };
    upd((d) => { const i = d.rooms.findIndex((r) => r.id === room.id); if (i >= 0) d.rooms[i] = guardado; });
    setEdit(guardado); setInicioTocado(false);
    avisar("✅ Datos del cuarto guardados.");
  };

  const registrar = () => {
    const a = Number(monto);
    if (!a || a <= 0) return avisar("Escribe cuánto te pagaron.");
    upd((d) => {
      d.payments[room.id] ??= {};
      (d.payments[room.id][ym] ??= []).push({ id: uid(), date: fecha, amount: a, method: metodo, note: nota });
    });
    setMonto(""); setNota("");
    avisar(`💰 Pago de ${money(a)} anotado en ${ymLabel(ym)}.`);
  };
  const borrarPago = (p) => {
    if (!confirm(`¿Borrar el pago de ${money(p.amount)} del ${p.date}?`)) return;
    upd((d) => { d.payments[room.id][ym] = (d.payments[room.id][ym] || []).filter((x) => x.id !== p.id); });
  };

  const recordatorioCalendar = () => {
    const dia = Math.min(Math.max(1, Number(room.dueDay) || 5), 28);
    const [y, m] = ym.split("-").map(Number);
    const d1 = `${y}${C.pad(m)}${C.pad(dia)}`;
    const sig = new Date(y, m - 1, dia + 1);
    const d2 = `${sig.getFullYear()}${C.pad(sig.getMonth() + 1)}${C.pad(sig.getDate())}`;
    const url = "https://calendar.google.com/calendar/render?action=TEMPLATE" +
      `&text=${encodeURIComponent(`Cobrar alquiler — Cuarto ${room.name} (${room.tenant || "sin inquilino"})`)}` +
      `&dates=${d1}/${d2}` +
      `&details=${encodeURIComponent(`Monto: ${money(room.rent)}\nTeléfono: ${room.phone || "—"}`)}` +
      `&recur=${encodeURIComponent("RRULE:FREQ=MONTHLY;BYMONTHDAY=" + dia)}`;
    window.open(url, "_blank");
  };

  const subirContrato = (e) => {
    const f = e.currentTarget.files?.[0];
    e.currentTarget.value = "";
    if (!f) return;
    if (f.type !== "application/pdf") return avisar("El contrato debe ser un PDF.");
    if (f.size > 3.4 * 1024 * 1024) return avisar("El PDF pesa más de 3.4 MB. Comprímelo e inténtalo otra vez.");
    setSubiendo(true);
    const lector = new FileReader();
    lector.onload = async () => {
      const rec = { name: f.name, dataUrl: lector.result, uploaded: todayISO() };
      try { await storage.set(contractKey(room.id), JSON.stringify(rec)); setContrato(rec); avisar("📄 Contrato guardado."); }
      catch { avisar("No se pudo guardar el contrato. Prueba con un PDF más liviano."); }
      setSubiendo(false);
    };
    lector.onerror = () => { setSubiendo(false); avisar("No se pudo leer el archivo."); };
    lector.readAsDataURL(f);
  };
  const quitarContrato = async () => {
    if (!confirm("¿Quitar el contrato de este cuarto?")) return;
    try { await storage.del(contractKey(room.id)); } catch { /* ya no estaba */ }
    setContrato(null); avisar("Contrato quitado.");
  };
  const abrirContrato = () => {
    const w = window.open("", "_blank");
    if (!w) return avisar("Tu celular bloqueó la ventana. Usa Descargar.");
    w.document.write(`<iframe src="${contrato.dataUrl}" style="border:0;width:100%;height:100%;position:fixed;inset:0"></iframe>`);
  };

  return html`
    <${Hoja} titulo=${`Cuarto ${room.name}`} sub=${`Piso ${room.floor} · ${ymLabel(ym)}${u ? ` · ${u.icon} ${u.label}` : ""}`} onClose=${onClose}>
      <div class=${"estado-grande " + st}>
        <span class="cara" aria-hidden="true">${CARA[st]}</span>
        <div><b>${ESTADO_TXT[st]}</b><small>${C.tieneInquilino(room) ? room.tenant : "Sin inquilino"}</small></div>
      </div>

      <section class="bloque">
        <h3>💰 Cobro de ${ymLabel(ym)}</h3>
        <div class="mini3">
          <span><small>Alquiler</small><b>${money(room.rent)}</b></span>
          <span><small>Pagó</small><b class="verde">${money(pagado)}</b></span>
          <span><small>Falta</small><b class=${falta ? "rojo" : ""}>${money(falta)}</b></span>
        </div>
        ${deuda > falta && html`<div class="alerta">😟 Con meses anteriores, la deuda total hasta ${ymLabel(ym)} es <b>${money(deuda)}</b>.</div>`}
        <div class="form-pago">
          <input class="monto-input" type="number" inputmode="decimal" placeholder="¿Cuánto pagó? S/" aria-label="Monto pagado"
            value=${monto} onInput=${(e) => setMonto(e.currentTarget.value)} />
          <div class="chips">
            ${C.METODOS.map((m) => html`<button type="button" key=${m} class=${"chip" + (metodo === m ? " on" : "")} onClick=${() => setMetodo(m)}>${ICONO_METODO[m]} ${m}</button>`)}
          </div>
          <div class="fila2">
            <label class="campo"><span>Fecha</span><input type="date" value=${fecha} onInput=${(e) => setFecha(e.currentTarget.value)} /></label>
            <label class="campo"><span>Referencia (opcional)</span><input value=${nota} onInput=${(e) => setNota(e.currentTarget.value)} /></label>
          </div>
          <button class="btn primario ancho" onClick=${registrar}>➕ Anotar pago</button>
          <small class="gris">Se anota como pago de <b>${ymLabel(ym)}</b>. Para otro mes, cámbialo arriba con ‹ ›.</small>
        </div>
        ${pagos.length > 0 && html`
          <ul class="pagos">
            ${pagos.map((p) => html`
              <li key=${p.id}>
                <span aria-hidden="true">${ICONO_METODO[p.method] || "💵"}</span>
                <span class="gris">${p.date}</span>
                <span class="pnota">${p.method}${p.note ? " · " + p.note : ""}</span>
                <b class="verde">${money(p.amount)}</b>
                <button class="x" onClick=${() => borrarPago(p)} aria-label="Borrar pago">🗑️</button>
              </li>`)}
          </ul>`}
        <div class="acciones">
          <button class="btn" onClick=${onComprobante}>🧾 Comprobante</button>
          <button class="btn" onClick=${onReporte}>📄 Reporte</button>
          ${room.phone && deuda > 0 && html`<a class="btn" href=${waLink(room.phone, textoCobro(room, deuda))} target="_blank" rel="noopener">💬 Recordar por WhatsApp</a>`}
          <button class="btn" onClick=${recordatorioCalendar}>📅 Recordatorio</button>
        </div>
      </section>

      <section class="bloque">
        <h3>👤 Inquilino</h3>
        <div class="form">
          <${Campo} label="Nombre completo" valor=${edit.tenant} onInput=${cambiarInquilino} />
          <${Campo} label="DNI / CE" valor=${edit.doc} onInput=${set("doc")} />
          <${Campo} label="Teléfono (WhatsApp)" tipo="tel" valor=${edit.phone} onInput=${set("phone")} />
          <${Campo} label="Alquiler mensual (S/)" tipo="number" valor=${edit.rent} onInput=${set("rent")} />
          <${Campo} label="Garantía recibida (S/)" tipo="number" valor=${edit.deposit} onInput=${set("deposit")} />
          <${Campo} label="Mes de inicio" tipo="month" valor=${edit.start} onInput=${(v) => { setInicioTocado(true); set("start")(v); }} />
          <${Campo} label="Día de pago (1 al 31)" tipo="number" valor=${edit.dueDay} onInput=${set("dueDay")} min="1" max="31" />
        </div>
        ${cambioDeInquilino && html`<p class="pista">¿Es un inquilino nuevo? Cambia el <b>Mes de inicio</b> al mes en que entró, así no le salen deudas del anterior.</p>`}
        <div class="campo">
          <span>¿Dónde está el cuarto?</span>
          <div class="chips">
            ${C.UBICACIONES.map((x) => html`
              <button type="button" key=${x.id} class=${"chip grande" + (edit.ubicacion === x.id ? " on" : "")}
                onClick=${() => set("ubicacion")(edit.ubicacion === x.id ? "" : x.id)}>${x.icon} ${x.label}</button>`)}
          </div>
        </div>
        <label class="check"><input type="checkbox" checked=${edit.active !== false} onChange=${(e) => set("active")(e.currentTarget.checked)} /> Cuarto en alquiler</label>
        <${Campo} label="Notas" valor=${edit.notes} onInput=${set("notes")} />
        <button class=${"btn primario ancho" + (hayCambios ? " brilla" : "")} onClick=${guardar}>💾 Guardar cambios</button>
      </section>

      <section class="bloque">
        <h3>📄 Contrato</h3>
        ${contrato
          ? html`
            <div class="archivo">📄<div><b>${contrato.name}</b><small>Subido el ${fechaLarga(contrato.uploaded)}</small></div></div>
            <div class="pdf"><iframe title="Contrato" src=${contrato.dataUrl}></iframe></div>
            <div class="acciones">
              <button class="btn" onClick=${abrirContrato}>🔎 Abrir</button>
              <a class="btn" href=${contrato.dataUrl} download=${contrato.name}>⬇️ Descargar</a>
              <button class="btn peligro" onClick=${quitarContrato}>🗑️ Quitar</button>
            </div>`
          : html`
            <div class="soltar">
              <span class="grande" aria-hidden="true">📤</span>
              <p>Sube el contrato en PDF para tenerlo a la mano.</p>
              <button class="btn primario" disabled=${subiendo} onClick=${() => archivo.current?.click()}>${subiendo ? "Guardando…" : "Elegir PDF"}</button>
              <small class="gris">Hasta 3.4 MB</small>
            </div>`}
        <input ref=${archivo} type="file" accept="application/pdf" hidden onChange=${subirContrato} />
      </section>
    <//>`;
}

/* =====================  COMPROBANTE Y REPORTE  ===================== */
function HojaComprobante({ data, room, ym, onClose, avisar }) {
  const l = data.landlord;
  const pagos = C.pagosDe(data, room.id, ym);
  const pagado = C.pagadoEn(data, room.id, ym);
  const falta = C.faltaMes(data, room, ym);
  const deuda = C.deudaAcumulada(data, room, ym);
  const estado = falta === 0 && pagado > 0 ? "CANCELADO" : pagado > 0 ? "PAGO PARCIAL" : "PENDIENTE";
  const nro = `${room.name}-${ym.replace("-", "")}`;
  const medios = [...new Set(pagos.map((p) => p.method))].join(", ") || "—";
  const texto = [
    `COMPROBANTE DE PAGO DE ALQUILER N° ${nro}`,
    `Emitido: ${fechaLarga(todayISO())}`,
    "",
    `ARRENDADOR: ${l.name || "—"}${l.doc ? ` (DNI/RUC ${l.doc})` : ""}`,
    `Inmueble: ${l.address || "—"}`,
    `Contacto: ${l.phone || "—"}`,
    "",
    `ARRENDATARIO: ${room.tenant || "—"}${room.doc ? ` (DNI ${room.doc})` : ""}`,
    `Cuarto ${room.name} — Piso ${room.floor}`,
    "",
    `PERIODO: ${ymLabel(ym).toUpperCase()}`,
    `Alquiler mensual: ${money(room.rent)}`,
    `Total pagado: ${money(pagado)}`,
    `Saldo del mes: ${money(falta)}`,
    `Deuda acumulada: ${money(deuda)}`,
    `Medio de pago: ${medios}`,
    `ESTADO: ${estado}`,
    "",
    "DETALLE:",
    ...(pagos.length ? pagos.map((p) => `· ${p.date} — ${money(p.amount)} — ${p.method}${p.note ? ` (${p.note})` : ""}`) : ["· Sin pagos registrados"]),
  ].join("\n");
  const copiar = async () => {
    try { await navigator.clipboard.writeText(texto); avisar("📋 Comprobante copiado."); }
    catch { avisar("No se pudo copiar. Usa Imprimir o WhatsApp."); }
  };
  const sello = estado === "CANCELADO" ? "ok" : estado === "PAGO PARCIAL" ? "mid" : "bad";

  return html`
    <${Hoja} titulo="🧾 Comprobante de pago" sub=${`Cuarto ${room.name} · ${ymLabel(ym)}`} onClose=${onClose}>
      <div class="acciones no-imprimir">
        <button class="btn primario" onClick=${() => window.print()}>🖨️ Imprimir o guardar PDF</button>
        ${room.phone && html`<a class="btn" href=${waLink(room.phone, texto)} target="_blank" rel="noopener">💬 Enviar por WhatsApp</a>`}
        <button class="btn" onClick=${copiar}>📋 Copiar texto</button>
      </div>
      <article class="doc imprimible">
        <header class="doc-h">
          <div>
            <div class="doc-kicker">Comprobante de pago de alquiler</div>
            <h1>${l.name || "Nombre del arrendador"}</h1>
            <p>${l.address || "Dirección del inmueble"}</p>
            <p>${l.doc ? `DNI/RUC ${l.doc}` : ""}${l.phone ? ` · ${l.phone}` : ""}</p>
          </div>
          <div class="doc-nro"><small>N°</small><b>${nro}</b><span>${fechaLarga(todayISO())}</span></div>
        </header>
        <div class="doc-dos">
          <div>
            <h4>Recibí de</h4>
            <p class="big">${room.tenant || "—"}</p>
            <p>${room.doc ? `DNI ${room.doc}` : ""}</p>
            <p>${room.phone || ""}</p>
          </div>
          <div>
            <h4>Por concepto de</h4>
            <p class="big">Cuarto ${room.name} · Piso ${room.floor}</p>
            <p>Alquiler del mes de ${ymLabel(ym)}</p>
            <p>Medio de pago: ${medios}</p>
          </div>
        </div>
        <table class="doc-t">
          <thead><tr><th>Fecha</th><th>Medio</th><th>Referencia</th><th class="r">Monto</th></tr></thead>
          <tbody>
            ${pagos.length
              ? pagos.map((p) => html`<tr key=${p.id}><td>${p.date}</td><td>${p.method}</td><td>${p.note || "—"}</td><td class="r">${money(p.amount)}</td></tr>`)
              : html`<tr><td colspan="4">Sin pagos registrados en este mes.</td></tr>`}
          </tbody>
        </table>
        <div class="doc-sum">
          <div><span>Alquiler mensual</span><b>${money(room.rent)}</b></div>
          <div><span>Total pagado</span><b>${money(pagado)}</b></div>
          <div><span>Saldo del mes</span><b>${money(falta)}</b></div>
          <div class="tot"><span>Deuda acumulada</span><b>${money(deuda)}</b></div>
        </div>
        <div class=${"sello " + sello}>${estado}</div>
        <footer class="doc-f">
          <div><span></span>Firma del arrendador</div>
          <div><span></span>Firma del arrendatario</div>
        </footer>
      </article>
    <//>`;
}

function HojaReporte({ data, room, ym, onClose, avisar }) {
  const l = data.landlord;
  const hist = data.payments[room.id] || {};
  const meses = C.ymRange(room.start && room.start < ym ? room.start : ym, ym).reverse();
  const totalPagado = Object.values(hist).flat().reduce((s, p) => s + Number(p.amount || 0), 0);
  const deuda = C.deudaAcumulada(data, room, ym);
  const filaMes = (m) => {
    const ps = hist[m] || [];
    const pagado = ps.reduce((s, p) => s + Number(p.amount || 0), 0);
    return { ps, pagado, falta: Math.max(0, Number(room.rent || 0) - pagado), medios: [...new Set(ps.map((p) => p.method))].join(", ") };
  };
  const texto = [
    `REPORTE DE CUARTO ${room.name} — Piso ${room.floor}`,
    `Inquilino: ${room.tenant || "—"}`,
    `Alquiler mensual: ${money(room.rent)}`,
    `Desde: ${ymLabel(room.start || ym)}`,
    "",
    ...meses.map((m) => { const f = filaMes(m); return `${ymLabel(m)}: pagó ${money(f.pagado)} — debe ${money(f.falta)}${f.medios ? ` (${f.medios})` : ""}`; }),
    "",
    `Total pagado histórico: ${money(totalPagado)}`,
    `Deuda acumulada: ${money(deuda)}`,
    ...(l.name ? ["", `${l.name} · ${l.phone || ""}`] : []),
  ].join("\n");
  const copiar = async () => {
    try { await navigator.clipboard.writeText(texto); avisar("📋 Reporte copiado."); }
    catch { avisar("No se pudo copiar. Usa Imprimir."); }
  };

  return html`
    <${Hoja} titulo=${`📄 Reporte del cuarto ${room.name}`} sub=${room.tenant || "Sin inquilino"} onClose=${onClose}>
      <div class="acciones no-imprimir">
        <button class="btn primario" onClick=${() => window.print()}>🖨️ Imprimir o guardar PDF</button>
        ${room.phone && html`<a class="btn" href=${waLink(room.phone, texto)} target="_blank" rel="noopener">💬 Enviar por WhatsApp</a>`}
        <button class="btn" onClick=${copiar}>📋 Copiar texto</button>
      </div>
      <article class="doc imprimible">
        <header class="doc-h">
          <div>
            <div class="doc-kicker">Estado de cuenta por cuarto</div>
            <h1>Cuarto ${room.name} · Piso ${room.floor}</h1>
            <p>${room.tenant || "Sin inquilino"}${room.doc ? ` · DNI ${room.doc}` : ""}</p>
          </div>
          <div class="doc-nro"><small>Corte</small><b>${ymLabel(ym)}</b><span>${fechaLarga(todayISO())}</span></div>
        </header>
        <table class="doc-t">
          <thead><tr><th>Mes</th><th>Alquiler</th><th>Pagado</th><th>Medio</th><th class="r">Saldo</th></tr></thead>
          <tbody>
            ${meses.map((m) => {
              const f = filaMes(m);
              return html`<tr key=${m}>
                <td>${ymLabel(m)}</td><td>${money(room.rent)}</td><td>${money(f.pagado)}</td>
                <td>${f.medios || "—"}</td><td class=${"r" + (f.falta ? " bad" : "")}>${money(f.falta)}</td>
              </tr>`;
            })}
          </tbody>
        </table>
        <div class="doc-sum">
          <div><span>Total pagado histórico</span><b>${money(totalPagado)}</b></div>
          <div class="tot"><span>Deuda acumulada</span><b>${money(deuda)}</b></div>
        </div>
      </article>
    <//>`;
}

/* =====================  GASTOS  ===================== */
function Gastos({ data, ym, upd, avisar }) {
  const fechaDefecto = () => (ym === thisYM() ? todayISO() : `${ym}-01`);
  const [tipo, setTipo] = useState("diario");
  const [cat, setCat] = useState("Limpieza");
  const [monto, setMonto] = useState("");
  const [fecha, setFecha] = useState(fechaDefecto);
  const [detalle, setDetalle] = useState("");
  useEffect(() => { setFecha(fechaDefecto()); }, [ym]);

  const r = C.resumenMes(data, ym);
  const lista = C.listaGastos(data, ym);
  const cats = tipo === "fijo" ? C.CAT_GENERAL : C.CAT_DIARIO;
  const cambiarTipo = (t) => { setTipo(t); setCat(t === "fijo" ? "Agua" : "Limpieza"); };

  const agregar = () => {
    const a = Number(monto);
    if (!a || a <= 0) return avisar("Escribe cuánto gastaste.");
    if (tipo === "fijo") upd((d) => { d.generalExpenses.push({ id: uid(), ym, date: fecha, category: cat, amount: a, note: detalle }); });
    else upd((d) => { d.dailyExpenses.push({ id: uid(), date: fecha, category: cat, amount: a, description: detalle }); });
    setMonto(""); setDetalle("");
    const mesGasto = tipo === "fijo" ? ym : C.ymOf(fecha);
    const ico = ICONO_CAT[cat] || "📦";
    avisar(mesGasto === ym ? `${ico} Gasto de ${money(a)} anotado.` : `${ico} Anotado en ${ymLabel(mesGasto)} (por la fecha).`);
  };
  const borrar = (g) => {
    if (!confirm(`¿Borrar el gasto de ${g.category} por ${money(g.amount)}?`)) return;
    upd((d) => {
      if (g.tipo === "fijo") d.generalExpenses = d.generalExpenses.filter((x) => x.id !== g.id);
      else d.dailyExpenses = d.dailyExpenses.filter((x) => x.id !== g.id);
    });
  };

  return html`
    <div class="tres">
      <div class="mini morado"><small>📅 Fijos del mes</small><b>${money(r.gastosFijos)}</b></div>
      <div class="mini naranja"><small>🛒 Del día a día</small><b>${money(r.gastosDiarios)}</b></div>
      <div class="mini rojo"><small>🧾 Total gastado</small><b>${money(r.gastos)}</b></div>
    </div>

    <section class="card">
      <h2>➕ Anotar un gasto</h2>
      <div class="form-gasto">
        <div class="segmento">
          <button class=${tipo === "diario" ? "on" : ""} onClick=${() => cambiarTipo("diario")}>🛒 Del día a día</button>
          <button class=${tipo === "fijo" ? "on" : ""} onClick=${() => cambiarTipo("fijo")}>📅 Fijo del mes</button>
        </div>
        <div class="cats">
          ${cats.map((c) => html`<button key=${c} class=${"cat" + (cat === c ? " on" : "")} onClick=${() => setCat(c)}><span aria-hidden="true">${ICONO_CAT[c] || "📦"}</span>${c}</button>`)}
        </div>
        <input class="monto-input" type="number" inputmode="decimal" placeholder="¿Cuánto? S/" aria-label="Monto del gasto"
          value=${monto} onInput=${(e) => setMonto(e.currentTarget.value)} />
        <div class="fila2">
          <label class="campo"><span>Fecha</span><input type="date" value=${fecha} onInput=${(e) => setFecha(e.currentTarget.value)} /></label>
          <label class="campo"><span>${tipo === "fijo" ? "Detalle (recibo, medidor…)" : "¿En qué se gastó?"}</span>
            <input value=${detalle} onInput=${(e) => setDetalle(e.currentTarget.value)} /></label>
        </div>
        <button class="btn primario ancho" onClick=${agregar}>➕ Anotar gasto</button>
      </div>
    </section>

    <section class="card">
      <h2>🧾 Todo lo que gastaste en ${ymLabel(ym)}</h2>
      ${lista.length === 0
        ? html`<p class="vacio">Todavía no anotas gastos este mes.</p>`
        : html`<div class="lista-cuartos">
            ${lista.map((g) => html`
              <div class="gasto" key=${g.id}>
                <span class="g-ico" aria-hidden="true">${ICONO_CAT[g.category] || "📦"}</span>
                <span class="g-main">
                  <b>${g.category}<span class="etiqueta">${g.tipo === "fijo" ? "fijo" : "del día"}</span></b>
                  <small>${g.date || ""}${g.detalle ? " · " + g.detalle : ""}</small>
                </span>
                <b class="rojo">${money(g.amount)}</b>
                <button class="x" onClick=${() => borrar(g)} aria-label="Borrar gasto">🗑️</button>
              </div>`)}
          </div>`}
    </section>
  `;
}

/* =====================  TOTAL DE TODOS LOS MESES  ===================== */
function Total({ data, ym, irAMes }) {
  const t = C.totalHistorico(data, ym);
  return html`
    <section class="card">
      <h2>📊 Total de todos los meses</h2>
      <p class="gris">Desde ${ymLabel(t.meses[0].ym)} hasta ${ymLabel(ym)}</p>
      <div class="tres">
        <div class="mini verde"><small>💰 Cobrado</small><b>${money(t.cobrado)}</b></div>
        <div class="mini morado"><small>🧾 Gastos</small><b>${money(t.gastos)}</b></div>
        <div class="mini naranja"><small>🐷 Caja total</small><b class=${t.caja < 0 ? "neg" : ""}>${money(t.caja)}</b></div>
      </div>
    </section>
    <section class="card">
      <h2>🗓️ Mes por mes</h2>
      <p class="gris">Toca un mes para verlo en Inicio.</p>
      <div class="meses">
        ${t.meses.slice().reverse().map((m) => html`
          <button class="mes-fila" key=${m.ym} onClick=${() => irAMes(m.ym)}>
            <span class="mes-n">${ymLabel(m.ym)}</span>
            <span><small>Cobrado</small><b class="verde">${money(m.cobrado)}</b></span>
            <span><small>Gastos</small><b>${money(m.gastos)}</b></span>
            <span><small>Caja del mes</small><b class=${m.caja < 0 ? "neg" : ""}>${money(m.caja)}</b></span>
          </button>`)}
      </div>
    </section>
  `;
}

/* =====================  AJUSTES  ===================== */
function Ajustes({ data, upd, reemplazar, avisar, sesion }) {
  const l = data.landlord;
  const set = (k) => (v) => upd((d) => { d.landlord[k] = v; });
  const archivo = useRef(null);
  const [instalable, setInstalable] = useState(!!eventoInstalar);
  const [estadoAvisos, setEstadoAvisos] = useState("");
  useEffect(() => {
    const f = () => setInstalable(true);
    addEventListener("instalable", f);
    return () => removeEventListener("instalable", f);
  }, []);
  const esIPhone = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const instalada = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const puedeAvisos = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

  const instalar = async () => {
    if (!eventoInstalar) return;
    eventoInstalar.prompt();
    await eventoInstalar.userChoice;
    eventoInstalar = null;
    setInstalable(false);
  };
  const activar = async () => {
    setEstadoAvisos("Activando…");
    try { await activarAvisos(sesion); setEstadoAvisos("✅ Listo: te llegarán los avisos de cobro a este celular."); }
    catch (e) { console.error(e); setEstadoAvisos("⚠️ " + (e.message || "No se pudieron activar los avisos.")); }
  };
  const respaldo = () => {
    descargar(JSON.stringify(data, null, 2), `respaldo-alquiler-${todayISO()}.json`, "application/json");
    avisar("⬇️ Respaldo descargado.");
  };
  const restaurar = (e) => {
    const f = e.currentTarget.files?.[0];
    e.currentTarget.value = "";
    if (!f) return;
    const lector = new FileReader();
    lector.onload = () => {
      try {
        const d = JSON.parse(lector.result);
        if (!Array.isArray(d.rooms)) throw new Error("sin cuartos");
        if (!confirm("¿Reemplazar TODOS tus datos con este respaldo?")) return;
        reemplazar(d);
        avisar("✅ Respaldo restaurado.");
      } catch { avisar("Ese archivo no es un respaldo válido."); }
    };
    lector.readAsText(f);
  };
  const salir = async () => {
    if (!confirm("¿Cerrar sesión en este celular?")) return;
    (await supabase()).auth.signOut();
  };

  return html`
    <section class="card">
      <h2>🔔 Avisos de cobro</h2>
      <p class="gris">Te avisa un día antes y el día que le toca pagar a cada inquilino, y todos los días mientras alguien deba.</p>
      ${!VAPID_PUBLIC_KEY
        ? html`<p class="pista">Los avisos al celular se activan cuando termine de configurar tu cuenta. Mientras tanto puedes usar Google Calendar (más abajo).</p>`
        : !puedeAvisos
          ? html`<p class="pista">${esIPhone ? "En iPhone, primero instala la app en la pantalla de inicio y ábrela desde ahí." : "Este navegador no permite avisos. Usa Chrome."}</p>`
          : html`<button class="btn primario" onClick=${activar}>🔔 Activar avisos en este celular</button>`}
      ${estadoAvisos && html`<p class="mensaje">${estadoAvisos}</p>`}
    </section>

    <section class="card">
      <h2>📲 Instalar la app</h2>
      ${instalada
        ? html`<p class="gris">✅ Ya estás usando la app instalada.</p>`
        : instalable
          ? html`<button class="btn primario" onClick=${instalar}>📲 Instalar en este celular</button>`
          : esIPhone
            ? html`<p class="gris">En iPhone: toca el botón <b>Compartir</b> ⬆️ de Safari y luego <b>“Añadir a pantalla de inicio”</b>.</p>`
            : html`<p class="gris">En Android: abre el menú ⋮ de Chrome y toca <b>“Instalar aplicación”</b> o <b>“Agregar a pantalla principal”</b>.</p>`}
    </section>

    <section class="card">
      <h2>🙋 Tus datos <small class="gris">salen en cada comprobante</small></h2>
      <div class="form">
        <${Campo} label="Nombre o razón social" valor=${l.name} onInput=${set("name")} />
        <${Campo} label="DNI o RUC" valor=${l.doc} onInput=${set("doc")} />
        <${Campo} label="Dirección del inmueble" valor=${l.address} onInput=${set("address")} />
        <${Campo} label="Teléfono" tipo="tel" valor=${l.phone} onInput=${set("phone")} />
        <${Campo} label="Correo" tipo="email" valor=${l.email} onInput=${set("email")} />
      </div>
    </section>

    <section class="card">
      <h2>📅 Google Calendar</h2>
      <p class="gris">Descarga los días de pago de todos los cuartos ocupados. En Google Calendar entra a <b>Configuración → Importar y exportar</b> y sube el archivo. Te avisará un día antes y el mismo día.</p>
      <button class="btn" onClick=${() => exportarICS(data, avisar)}>📅 Descargar días de pago (.ics)</button>
    </section>

    <section class="card">
      <h2>💾 Respaldo</h2>
      <p class="gris">Guarda una copia de cuartos, pagos y gastos en tu celular o PC. Los contratos en PDF no entran: descárgalos desde cada cuarto.</p>
      <div class="acciones">
        <button class="btn" onClick=${respaldo}>⬇️ Descargar respaldo</button>
        <button class="btn" onClick=${() => archivo.current?.click()}>⬆️ Restaurar respaldo</button>
      </div>
      <input ref=${archivo} type="file" accept="application/json" hidden onChange=${restaurar} />
    </section>

    ${sesion && html`
      <section class="card">
        <h2>👤 Cuenta</h2>
        <p class="gris">Entraste como <b>${sesion.user?.email}</b>.</p>
        <button class="btn peligro" onClick=${salir}>🚪 Cerrar sesión</button>
      </section>`}
  `;
}

const raiz = document.getElementById("root");
raiz.textContent = "";
render(html`<${App} />`, raiz);
