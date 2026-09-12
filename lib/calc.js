// Cálculos de la casa: todo lo que suma, resta y decide el estado de un cuarto.
// Sin dependencias, para que lo usen igual la app (navegador) y las pruebas
// (node --test). Los datos tienen la misma forma que ya guarda la app en
// Supabase (fila "casa:data:v1"), así que no hay que migrar nada.

export const FLOORS = [
  { n: 1, count: 4 },
  { n: 2, count: 7 },
  { n: 3, count: 7 },
];

export const UBICACIONES = [
  { id: "ventana", label: "Ventana a la calle", icon: "🪟" },
  { id: "escalera", label: "Da a la escalera", icon: "🪜" },
  { id: "medio", label: "Al medio", icon: "⭐" },
  { id: "fondo", label: "Al fondo", icon: "🌳" },
];
export const ubicacionDe = (id) => UBICACIONES.find((u) => u.id === id) || null;

export const METODOS = ["Efectivo", "Yape", "Plin", "Transferencia", "Depósito", "Otro"];
export const CAT_GENERAL = ["Agua", "Luz", "Gas", "Tributos", "Arbitrios", "Internet", "Mantenimiento", "Otro"];
export const CAT_DIARIO = ["Limpieza", "Reparación", "Materiales", "Personal", "Transporte", "Otro"];

export const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/* ---------- fechas (siempre en hora local, nunca UTC) ---------- */
export const pad = (n) => String(n).padStart(2, "0");
export const todayISO = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const thisYM = (d = new Date()) => todayISO(d).slice(0, 7);
export const ymOf = (iso) => (iso || "").slice(0, 7);

export const shiftYM = (ym, delta) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};

export const ymRange = (from, to) => {
  const out = [];
  let cur = from;
  for (let guard = 0; cur <= to && guard < 400; guard++) { out.push(cur); cur = shiftYM(cur, 1); }
  return out;
};

export const ymLabel = (ym) => {
  const [y, m] = ym.split("-");
  return `${MESES[Number(m) - 1]} ${y}`;
};

export const fechaLarga = (iso) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${Number(d)} de ${MESES[Number(m) - 1]} de ${y}`;
};

export const sumarDias = (iso, dias) => {
  const [y, m, d] = iso.split("-").map(Number);
  return todayISO(new Date(y, m - 1, d + dias));
};

const diasDelMes = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m, 0).getDate();
};

// Día en que vence el alquiler de un cuarto en un mes dado. Si el día no existe
// en ese mes (p. ej. 31 en febrero), vence el último día del mes.
export const fechaVence = (ym, dueDay) => {
  const dia = Math.min(Math.max(1, Number(dueDay) || 5), diasDelMes(ym));
  return `${ym}-${pad(dia)}`;
};

export const money = (n) =>
  "S/ " + (Number(n) || 0).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const round2 = (n) => Math.round(n * 100) / 100;
const suma = (lista, f) => round2(lista.reduce((s, x) => s + (Number(f(x)) || 0), 0));

/* ---------- cuartos ---------- */
export const tieneInquilino = (r) => !!(r.tenant && String(r.tenant).trim());

// Un cuarto cuenta como ocupado en un mes si está en alquiler, tiene inquilino
// y ese mes no es anterior a su "Mes de inicio".
export const ocupadoEn = (r, ym) =>
  r.active !== false && tieneInquilino(r) && !(r.start && r.start > ym);

export const pagosDe = (data, roomId, ym) => data.payments?.[roomId]?.[ym] || [];
export const pagadoEn = (data, roomId, ym) => suma(pagosDe(data, roomId, ym), (p) => p.amount);

export function estadoCuarto(data, r, ym) {
  if (r.active === false) return "inactivo";
  if (!ocupadoEn(r, ym)) return "libre";
  const pagado = pagadoEn(data, r.id, ym);
  const rent = Number(r.rent || 0);
  if (rent > 0 && pagado >= rent) return "pagado";
  if (pagado > 0) return "parcial";
  return "pendiente";
}

export const faltaMes = (data, r, ym) =>
  ocupadoEn(r, ym) ? Math.max(0, round2(Number(r.rent || 0) - pagadoEn(data, r.id, ym))) : 0;

// Deuda acumulada desde el "Mes de inicio" hasta el mes indicado (incluido).
export function deudaAcumulada(data, r, hasta) {
  if (!ocupadoEn(r, hasta)) return 0;
  const desde = r.start && r.start <= hasta ? r.start : hasta;
  let deuda = 0;
  for (const m of ymRange(desde, hasta)) deuda += Number(r.rent || 0) - pagadoEn(data, r.id, m);
  return Math.max(0, round2(deuda));
}

/* ---------- resumen del mes ---------- */
export function resumenMes(data, ym) {
  const enAlquiler = data.rooms.filter((r) => r.active !== false);
  const ocupados = enAlquiler.filter((r) => ocupadoEn(r, ym));
  const libres = enAlquiler.filter((r) => !ocupadoEn(r, ym));
  const gastosFijos = suma((data.generalExpenses || []).filter((g) => g.ym === ym), (g) => g.amount);
  const gastosDiarios = suma((data.dailyExpenses || []).filter((g) => ymOf(g.date) === ym), (g) => g.amount);
  const cobrado = suma(data.rooms, (r) => pagadoEn(data, r.id, ym));
  const gastos = round2(gastosFijos + gastosDiarios);
  return {
    esperado: suma(ocupados, (r) => r.rent),
    cobrado,
    porCobrar: suma(ocupados, (r) => faltaMes(data, r, ym)),
    deudaTotal: suma(ocupados, (r) => deudaAcumulada(data, r, ym)),
    gastosFijos,
    gastosDiarios,
    gastos,
    caja: round2(cobrado - gastos),
    ocupados: ocupados.length,
    libres: libres.length,
    libreTotal: suma(libres, (r) => r.rent),
  };
}

// Cuartos que pagaron algo en el mes (pantalla "Cobrado").
export function listaCobrados(data, ym) {
  return data.rooms
    .map((r) => ({ room: r, pagos: pagosDe(data, r.id, ym), pagado: pagadoEn(data, r.id, ym), estado: estadoCuarto(data, r, ym) }))
    .filter((x) => x.pagado > 0);
}

// Cuartos que deben algo (pantalla "Deuda"). "vencido" = ya pasó su día de pago.
export function listaPorCobrar(data, ym, hoy = todayISO()) {
  return data.rooms
    .filter((r) => ocupadoEn(r, ym))
    .map((r) => {
      const vence = fechaVence(ym, r.dueDay);
      return {
        room: r,
        falta: faltaMes(data, r, ym),
        deuda: deudaAcumulada(data, r, ym),
        vence,
        vencido: hoy > vence,
      };
    })
    .filter((x) => x.falta > 0 || x.deuda > 0)
    .sort((a, b) => b.deuda - a.deuda || a.vence.localeCompare(b.vence));
}

// Todos los gastos del mes, fijos y diarios, del más reciente al más antiguo.
export function listaGastos(data, ym) {
  const fijos = (data.generalExpenses || []).filter((g) => g.ym === ym)
    .map((g) => ({ ...g, tipo: "fijo", detalle: g.note || "" }));
  const diarios = (data.dailyExpenses || []).filter((g) => ymOf(g.date) === ym)
    .map((g) => ({ ...g, tipo: "diario", detalle: g.description || "" }));
  return [...fijos, ...diarios].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}

/* ---------- total de todos los meses ---------- */
export function primerMes(data, hasta) {
  const meses = [];
  for (const r of data.rooms) if (tieneInquilino(r) && r.start) meses.push(r.start);
  for (const porMes of Object.values(data.payments || {}))
    for (const [m, pagos] of Object.entries(porMes)) if (pagos.length) meses.push(m);
  for (const g of data.generalExpenses || []) if (g.ym) meses.push(g.ym);
  for (const g of data.dailyExpenses || []) if (g.date) meses.push(ymOf(g.date));
  const validos = meses.filter((m) => /^\d{4}-\d{2}$/.test(m) && m <= hasta).sort();
  return validos[0] || hasta;
}

export function totalHistorico(data, hasta) {
  let acumulado = 0;
  const meses = ymRange(primerMes(data, hasta), hasta).map((ym) => {
    const r = resumenMes(data, ym);
    acumulado = round2(acumulado + r.caja);
    return { ym, cobrado: r.cobrado, gastos: r.gastos, caja: r.caja, acumulado };
  });
  return {
    meses,
    cobrado: suma(meses, (m) => m.cobrado),
    gastos: suma(meses, (m) => m.gastos),
    caja: suma(meses, (m) => m.caja),
  };
}

/* ---------- avisos de cobro ---------- */
// Qué avisar hoy: un día antes del vencimiento, el mismo día, y todos los días
// mientras haya deuda vencida (meses anteriores sin pagar, o el mes actual
// después de su día de pago).
export function avisosDelDia(data, hoy = todayISO()) {
  const ym = ymOf(hoy);
  const manana = sumarDias(hoy, 1);
  const avisos = [];
  for (const r of data.rooms) {
    if (!ocupadoEn(r, ym)) continue;
    const vence = fechaVence(ym, r.dueDay);
    const falta = faltaMes(data, r, ym);
    const deudaAnterior = deudaAcumulada(data, r, shiftYM(ym, -1));
    const deudaVencida = round2(deudaAnterior + (hoy > vence ? falta : 0));
    if (deudaVencida > 0) avisos.push({ tipo: "debe", room: r, monto: round2(deudaVencida + (hoy > vence ? 0 : falta)), vence });
    else if (falta > 0 && vence === hoy) avisos.push({ tipo: "hoy", room: r, monto: falta, vence });
    else if (falta > 0 && vence === manana) avisos.push({ tipo: "manana", room: r, monto: falta, vence });
  }
  return avisos;
}

export function textoAviso(a) {
  const quien = `${a.room.name} · ${a.room.tenant}`;
  if (a.tipo === "manana") return { title: `Mañana paga el ${a.room.name} 📅`, body: `${quien}: ${money(a.monto)} vence mañana.` };
  if (a.tipo === "hoy") return { title: `Hoy paga el ${a.room.name} 💰`, body: `${quien}: ${money(a.monto)} vence hoy.` };
  return { title: `El ${a.room.name} tiene deuda 😟`, body: `${quien} debe ${money(a.monto)}.` };
}
