import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RequestHandler } from "../shared/start-servers";

// -----------------------------------------------------------------------------
// Sirve el frontend (web/public) desde el mismo microservicio de parqueadero.
// Así el navegador y la API comparten dominio: sin CORS y un solo despliegue.
// -----------------------------------------------------------------------------

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/public");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".map": "application/json",
};

export const serveStatic: RequestHandler = (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ service: "parking-service", status: "ok" }));
    return;
  }

  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));

  // Evita que se lean archivos por fuera de la carpeta pública (path traversal).
  if (!filePath.startsWith(PUBLIC_DIR) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Recurso no encontrado");
    return;
  }

  res.writeHead(200, {
    "Content-Type": MIME_TYPES[path.extname(filePath)] ?? "application/octet-stream",
    "Cache-Control": "no-cache",
  });
  createReadStream(filePath).pipe(res);
};
