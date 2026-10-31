// Local fork of https://elysindex.com/
// Serves the site and dApp HTML, and proxies /api so live rounds keep working.
import http from "http";
import https from "https";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ORIGIN = "elysindex.com";
const PORT = Number(process.env.PORT) || 4173;
const TOKEN = "0x836ef9293eaddbfdf2ca524c76e8276a5caf9c38";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

function localFile(urlPath) {
  const pathname = decodeURIComponent(urlPath.split("?")[0]);
  if (pathname === "/" || pathname === "") return path.join(ROOT, "index.html");
  if (pathname === "/app" || pathname === "/app/") return path.join(ROOT, "app", "index.html");

  const rel = pathname.replace(/^\/+/, "");
  const full = path.resolve(ROOT, rel);
  const fromRoot = path.relative(ROOT, full);
  if (fromRoot.startsWith("..") || path.isAbsolute(fromRoot)) return null;
  return full;
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Cache-Control": "no-cache",
  });
  fs.createReadStream(filePath).pipe(res);
}

function proxy(req, res) {
  const headers = {
    "user-agent": req.headers["user-agent"] || "ElysIndex-local",
    accept: req.headers.accept || "*/*",
    "accept-encoding": "identity",
  };
  const upstream = https.request(
    {
      hostname: ORIGIN,
      path: req.url,
      method: req.method,
      headers,
    },
    (up) => {
      const statusPath = (req.url || "").split("?")[0] === "/api/status";
      const out = { ...up.headers };
      delete out["content-encoding"];
      delete out["transfer-encoding"];
      if (!statusPath || (up.statusCode || 500) >= 400) {
        res.writeHead(up.statusCode || 502, out);
        up.pipe(res);
        return;
      }
      const chunks = [];
      up.on("data", (c) => chunks.push(c));
      up.on("end", () => {
        let body = Buffer.concat(chunks);
        try {
          const data = JSON.parse(body.toString("utf8"));
          if (data && typeof data === "object") {
            data.token = TOKEN;
            if (data.contracts && typeof data.contracts === "object") data.contracts.token = TOKEN;
            body = Buffer.from(JSON.stringify(data));
          }
        } catch (_) { /* leave the upstream body as-is */ }
        delete out["content-length"];
        res.writeHead(up.statusCode || 200, out);
        res.end(body);
      });
    }
  );
  upstream.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    }
    res.end("Upstream unavailable");
  });
  upstream.end();
}

const server = http.createServer((req, res) => {
  const pathname = (req.url || "/").split("?")[0];
  const live =
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/logos/") ||
    pathname.startsWith("/assets/");

  const filePath = localFile(req.url || "/");
  if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    sendFile(res, filePath);
    return;
  }

  if (req.method === "GET" || req.method === "HEAD") {
    if (live) {
      proxy(req, res);
      return;
    }
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`ElysIndex local  http://127.0.0.1:${PORT}`);
  console.log(`dApp             http://127.0.0.1:${PORT}/app`);
});
