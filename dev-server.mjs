import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { extname, join, normalize } from "node:path";

const root = process.cwd();
const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || "0.0.0.0";

const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ico": "image/x-icon",
};

const NO_CACHE = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  "Pragma": "no-cache",
  "Expires": "0",
  "Surrogate-Control": "no-store",
};

function lanUrls() {
  const urls = [];
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family === "IPv4" && !iface.internal) {
        urls.push(`http://${iface.address}:${port}/`);
      }
    }
  }
  return urls;
}

function resolveFile(pathname) {
  const filePath = normalize(join(root, pathname));
  if (!filePath.startsWith(root)) return null;

  const publicPath = normalize(join(root, "public", pathname));
  if (existsSync(filePath) && statSync(filePath).isFile()) return filePath;
  if (existsSync(publicPath) && statSync(publicPath).isFile()) return publicPath;
  if (pathname === "/" || pathname === "/index.html") return join(root, "index.html");
  return join(root, "index.html");
}

const server = createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";

  const resolvedPath = resolveFile(pathname);
  if (!resolvedPath) {
    res.writeHead(403, NO_CACHE);
    res.end("Forbidden");
    return;
  }

  const ext = extname(resolvedPath);
  let body;

  if (ext === ".html") {
    const ts = Date.now().toString(36);
    body = readFileSync(resolvedPath, "utf-8")
      .replace("<!--BUILD-->", `<meta name="build" content="${ts}" />`)
      .replace(
        /(src|href)="(\/[^"?#]+\.(js|css|json|mp3|mp4|png|jpe?g|webp|svg|ico))"/gi,
        `$1="$2?v=${ts}"`,
      );
  }

  res.writeHead(200, {
    "Content-Type": types[ext] || "application/octet-stream",
    ...NO_CACHE,
  });

  if (body) {
    res.end(body);
  } else {
    createReadStream(resolvedPath).pipe(res);
  }
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${port} busy — kill old process or set PORT=`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(port, host, () => {
  console.log(`http://127.0.0.1:${port}/  (no-cache, cache-busted)`);
  for (const u of lanUrls()) console.log(`${u}  ← phone on same Wi‑Fi`);
});
