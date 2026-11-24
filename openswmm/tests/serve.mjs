// Static server for local checks and the Pages browser test: serves the website root on
// http://127.0.0.1:8765 (PORT overrides). python -m http.server intermittently stalled module loads.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = new URL("../../", import.meta.url).pathname;
const port = Number(process.env.PORT || 8765);
const types = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".inp": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".zip": "application/zip",
};
createServer(async (req, res) => {
  let file;
  try {
    file = join(root, normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)));
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  try {
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
    const body = await readFile(file);
    res
      .writeHead(200, {
        "content-type": types[extname(file)] || "application/octet-stream",
        "cache-control": "no-cache",
      })
      .end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(port, "127.0.0.1", () => console.log("Serving " + root + " at http://127.0.0.1:" + port + "/"));
