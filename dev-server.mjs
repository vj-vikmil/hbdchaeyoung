import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const root = process.cwd();
const port = Number(process.env.PORT || 5173);

const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".svg": "image/svg+xml; charset=utf-8",
};

createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";

  const filePath = normalize(join(root, pathname));
  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  const publicPath = normalize(join(root, "public", pathname));
  const resolvedPath =
    existsSync(filePath) && statSync(filePath).isFile()
      ? filePath
      : existsSync(publicPath) && statSync(publicPath).isFile()
        ? publicPath
        : join(root, "index.html");
  res.writeHead(200, {
    "Content-Type": types[extname(resolvedPath)] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  createReadStream(resolvedPath).pipe(res);
}).listen(port, "127.0.0.1", () => {
  console.log(`Constellation app running at http://127.0.0.1:${port}/`);
});
