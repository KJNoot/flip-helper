// Tiny static server for app/ (ES modules don't load from file://). Usage: node tools/serve.mjs [port]
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
const ROOT = new URL("../app/", import.meta.url).pathname;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".ico": "image/x-icon" };
export function serve(port = 0) {
  const srv = createServer(async (req, res) => {
    try {
      let p = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
      if (p.endsWith("/")) p += "index.html";
      const f = join(ROOT, p); if (!f.startsWith(ROOT)) throw 0;
      await stat(f);
      res.writeHead(200, { "Content-Type": TYPES[extname(f)] || "application/octet-stream", "Cache-Control": "no-cache" });
      res.end(await readFile(f));
    } catch (e) { res.writeHead(404); res.end("not found"); }
  });
  return new Promise(r => srv.listen(port, "127.0.0.1", () => r(srv)));
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const s = await serve(+process.argv[2] || 8080);
  console.log(`Flip Helper at http://127.0.0.1:${s.address().port}/`);
}
