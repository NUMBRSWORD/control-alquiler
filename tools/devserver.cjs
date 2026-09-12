// Servidor local solo para probar la app en la PC: node tools/devserver.cjs
// Luego abre http://localhost:5173/?demo (datos inventados) o http://localhost:5173/ (datos reales).
const http = require("http");
const fs = require("fs");
const path = require("path");

const RAIZ = path.resolve(__dirname, "..");
const PUERTO = Number(process.env.PORT) || 5173;
const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

http.createServer((req, res) => {
  const ruta = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const archivo = path.join(RAIZ, ruta.endsWith("/") ? ruta + "index.html" : ruta);
  if (!archivo.startsWith(RAIZ)) { res.writeHead(403); return res.end(); }
  fs.readFile(archivo, (err, contenido) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("No encontrado"); }
    res.writeHead(200, { "Content-Type": TIPOS[path.extname(archivo)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(contenido);
  });
}).listen(PUERTO, "127.0.0.1", () => console.log(`Mi Alquiler en http://localhost:${PUERTO}/?demo`));
