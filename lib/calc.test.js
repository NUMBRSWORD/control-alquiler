import { test } from "node:test";
import assert from "node:assert/strict";
import * as C from "./calc.js";

const cuarto = (id, tenant, rent, start, extra = {}) =>
  ({ id, name: id, floor: Number(id[0]), tenant, rent, start, dueDay: 5, active: true, ...extra });

// Parecido a la casa real: Yeraldin entró en septiembre, Posemeda debe agosto,
// Primo Yeremi solo dio 140 en agosto, Chunga pagó agosto.
const casa = () => ({
  rooms: [
    cuarto("102", "Yeraldin", 250, "2026-09", { dueDay: 12 }),
    cuarto("103", "Posemeda", 180, "2026-08", { dueDay: 27 }),
    cuarto("203", "Chunga", 200, "2026-08", { dueDay: 15 }),
    cuarto("307", "Primo Yeremi", 300, "2026-08", { dueDay: 30 }),
    cuarto("101", "", 250, ""),
  ],
  payments: {
    "102": { "2026-09": [{ id: "a", amount: 250, date: "2026-09-11", method: "Efectivo" }] },
    "203": { "2026-08": [{ id: "b", amount: 200, date: "2026-08-15", method: "Yape" }] },
    "307": { "2026-08": [{ id: "c", amount: 140, date: "2026-08-30", method: "Efectivo" }] },
  },
  generalExpenses: [{ id: "g1", ym: "2026-09", date: "2026-09-05", category: "Luz", amount: 80, note: "" }],
  dailyExpenses: [
    { id: "d1", date: "2026-09-11", category: "Limpieza", amount: 265, description: "" },
    { id: "d2", date: "2026-08-20", category: "Personal", amount: 100, description: "" },
  ],
});
const porId = (data, id) => data.rooms.find((r) => r.id === id);

test("las fechas usan la hora local, no UTC", () => {
  assert.equal(C.todayISO(new Date(2026, 8, 11, 21, 30)), "2026-09-11");
  assert.equal(C.thisYM(new Date(2026, 8, 30, 22, 0)), "2026-09");
  assert.equal(C.sumarDias("2026-09-30", 1), "2026-10-01");
  assert.equal(C.shiftYM("2026-01", -1), "2025-12");
});

test("fechaVence ajusta días que no existen y usa 5 por defecto", () => {
  assert.equal(C.fechaVence("2026-02", 31), "2026-02-28");
  assert.equal(C.fechaVence("2026-09", ""), "2026-09-05");
  assert.equal(C.fechaVence("2026-09", "12"), "2026-09-12");
});

test("un inquilino nuevo no debe los meses antes de su mes de inicio", () => {
  const d = casa();
  const yer = porId(d, "102");
  assert.equal(C.estadoCuarto(d, yer, "2026-08"), "libre");
  assert.equal(C.deudaAcumulada(d, yer, "2026-08"), 0);
  assert.equal(C.faltaMes(d, yer, "2026-08"), 0);
  assert.equal(C.estadoCuarto(d, yer, "2026-09"), "pagado");
  assert.equal(C.deudaAcumulada(d, yer, "2026-09"), 0);
});

test("la deuda se acumula mes a mes desde el mes de inicio", () => {
  const d = casa();
  assert.equal(C.estadoCuarto(d, porId(d, "103"), "2026-08"), "pendiente");
  assert.equal(C.deudaAcumulada(d, porId(d, "103"), "2026-08"), 180);
  assert.equal(C.deudaAcumulada(d, porId(d, "103"), "2026-09"), 360);
  assert.equal(C.estadoCuarto(d, porId(d, "307"), "2026-08"), "parcial");
  assert.equal(C.deudaAcumulada(d, porId(d, "307"), "2026-08"), 160);
  assert.equal(C.deudaAcumulada(d, porId(d, "307"), "2026-09"), 460);
  assert.equal(C.estadoCuarto(d, porId(d, "203"), "2026-08"), "pagado");
  assert.equal(C.deudaAcumulada(d, porId(d, "203"), "2026-09"), 200);
});

test("un cuarto sin inquilino está libre y no debe", () => {
  const d = casa();
  const libre = porId(d, "101");
  assert.equal(C.estadoCuarto(d, libre, "2026-09"), "libre");
  assert.equal(C.deudaAcumulada(d, libre, "2026-09"), 0);
});

test("resumen de septiembre: cobrado, deuda, gastos y caja del mes", () => {
  const r = C.resumenMes(casa(), "2026-09");
  assert.deepEqual(r, {
    esperado: 930, cobrado: 250, porCobrar: 680, deudaTotal: 1020,
    gastosFijos: 80, gastosDiarios: 265, gastos: 345, caja: -95,
    ocupados: 4, libres: 1, libreTotal: 250,
  });
});

test("resumen de agosto: Yeraldin todavía no cuenta", () => {
  const r = C.resumenMes(casa(), "2026-08");
  assert.equal(r.esperado, 680);
  assert.equal(r.cobrado, 340);
  assert.equal(r.gastos, 100);
  assert.equal(r.caja, 240);
  assert.equal(r.libres, 2);
  assert.equal(r.libreTotal, 500);
});

test("listas de cobrados, por cobrar y gastos", () => {
  const d = casa();
  assert.deepEqual(C.listaCobrados(d, "2026-09").map((x) => x.room.id), ["102"]);
  assert.deepEqual(C.listaCobrados(d, "2026-08").map((x) => x.room.id), ["203", "307"]);

  const deben = C.listaPorCobrar(d, "2026-09", "2026-09-16");
  assert.deepEqual(deben.map((x) => [x.room.id, x.deuda, x.vencido]), [
    ["307", 460, false],
    ["103", 360, false],
    ["203", 200, true],
  ]);

  const gastos = C.listaGastos(d, "2026-09");
  assert.deepEqual(gastos.map((g) => [g.id, g.tipo]), [["d1", "diario"], ["g1", "fijo"]]);
});

test("total de todos los meses, con la caja de cada mes por separado", () => {
  const t = C.totalHistorico(casa(), "2026-09");
  assert.deepEqual(t.meses.map((m) => [m.ym, m.caja, m.acumulado]), [["2026-08", 240, 240], ["2026-09", -95, 145]]);
  assert.equal(t.cobrado, 590);
  assert.equal(t.gastos, 445);
  assert.equal(t.caja, 145);
});

test("avisos: un día antes, el mismo día y todos los días mientras deba", () => {
  const d = casa();
  const tipos = (hoy) => Object.fromEntries(C.avisosDelDia(d, hoy).map((a) => [a.room.id, [a.tipo, a.monto]]));
  assert.deepEqual(tipos("2026-09-14"), { "103": ["debe", 360], "203": ["manana", 200], "307": ["debe", 460] });
  assert.deepEqual(tipos("2026-09-15")["203"], ["hoy", 200]);
  assert.deepEqual(tipos("2026-09-16")["203"], ["debe", 200]);
  assert.equal(tipos("2026-09-16")["102"], undefined);
  assert.match(C.textoAviso(C.avisosDelDia(d, "2026-09-15").find((a) => a.room.id === "203")).title, /Hoy paga el 203/);
});
