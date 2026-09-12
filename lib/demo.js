// Datos inventados para mostrar la app sin tocar los datos reales.
// Se usan al abrir la app con ?demo al final de la dirección.
import { FLOORS, thisYM, shiftYM } from "./calc.js";

export function demoData() {
  const m0 = thisYM();
  const m1 = shiftYM(m0, -1);
  const nombres = {
    "102": "Rosa Díaz", "103": "Pedro Ruiz", "104": "Rosa Díaz", "202": "Mario Soto",
    "203": "Lucía Vega", "204": "Juan Pérez", "205": "Ana Torres", "206": "Luis Ramos",
    "207": "Luis Ramos", "301": "Carmen Flores", "302": "Sofía Cruz", "305": "Diego Rojas",
    "307": "Jorge Castro",
  };
  const rentas = {
    "101": 250, "102": 250, "103": 180, "104": 200, "201": 250, "202": 300, "203": 200,
    "204": 200, "205": 200, "206": 250, "207": 250, "301": 200, "302": 280, "303": 0,
    "304": 200, "305": 200, "306": 300, "307": 300,
  };
  const ubicacion = {
    "101": "ventana", "102": "escalera", "103": "medio", "104": "fondo",
    "201": "ventana", "202": "ventana", "203": "escalera", "204": "medio", "205": "medio", "206": "fondo", "207": "fondo",
    "301": "ventana", "302": "ventana", "303": "escalera", "304": "medio", "305": "medio", "306": "fondo",
  };
  const diasPago = [5, 12, 15, 27, 30];

  const rooms = [];
  for (const f of FLOORS) {
    for (let i = 1; i <= f.count; i++) {
      const id = `${f.n}0${i}`;
      const tenant = nombres[id] || "";
      rooms.push({
        id, floor: f.n, name: id, tenant,
        doc: tenant ? "00000000" : "", phone: tenant ? "999000000" : "",
        rent: rentas[id], deposit: 0,
        start: tenant ? (id === "102" || id === "104" ? m0 : m1) : "",
        dueDay: tenant ? diasPago[i % diasPago.length] : "",
        active: true, notes: "", ubicacion: ubicacion[id] || "",
      });
    }
  }

  const pago = (id, ym, amount, method = "Efectivo") => ({ id, date: `${ym}-10`, amount, method, note: "" });
  const payments = {};
  const pagar = (room, ym, monto, metodo) => {
    payments[room] ??= {};
    (payments[room][ym] ??= []).push(pago(`${room}-${ym}`, ym, monto, metodo));
  };
  // Mes anterior: casi todos pagaron; Pedro (103) no pagó y Jorge (307) dio una parte.
  for (const r of rooms) {
    if (r.tenant && r.start === m1 && !["103", "307"].includes(r.id)) pagar(r.id, m1, r.rent, r.id === "203" ? "Yape" : "Efectivo");
  }
  pagar("307", m1, 140);
  // Este mes: algunos ya pagaron.
  pagar("102", m0, 250); pagar("104", m0, 200, "Yape"); pagar("205", m0, 200, "Plin");
  pagar("206", m0, 250); pagar("207", m0, 200); pagar("301", m0, 200); pagar("202", m0, 200, "Transferencia");

  return {
    landlord: { name: "Casa de prueba", doc: "", address: "Casa de 3 pisos · 18 cuartos", phone: "", email: "" },
    rooms,
    payments,
    generalExpenses: [
      { id: "g1", ym: m1, date: `${m1}-08`, category: "Luz", amount: 80, note: "Recibo" },
      { id: "g2", ym: m1, date: `${m1}-09`, category: "Agua", amount: 45, note: "" },
      { id: "g3", ym: m0, date: `${m0}-08`, category: "Luz", amount: 85, note: "Recibo" },
    ],
    dailyExpenses: [
      { id: "d1", date: `${m0}-04`, category: "Limpieza", amount: 265, description: "Limpieza general" },
      { id: "d2", date: `${m0}-06`, category: "Personal", amount: 100, description: "Ayudante" },
      { id: "d3", date: `${m1}-15`, category: "Reparación", amount: 60, description: "Caño del 2do piso" },
    ],
  };
}
