// Static server for local-network testing of Kwizzy (phone, tablet, other machines).
// Binds 0.0.0.0 so anything on the same Wi-Fi can reach it. Throwaway: delete when done.
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8777);
const HOST = "0.0.0.0";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",          // the ambient tracks (media/music); Chrome refuses a wrong type
  ".wav": "audio/wav",           // and the interface clips (media/sfx)
};

function localAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] || []) {
      if (ni.family === "IPv4" && !ni.internal) out.push({ name, address: ni.address });
    }
  }
  return out;
}

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split("?")[0].split("#")[0]);
  if (rel === "/") rel = "/index.html";

  const file = path.join(ROOT, path.normalize(rel).replace(/^([/\\])+/, ""));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403, { "Content-Type": "text/plain" }).end("forbidden");
    return;
  }

  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Content-Length": st.size,
      "Cache-Control": "no-store",
    });
    if (req.method === "HEAD") { res.end(); return; }
    fs.createReadStream(file).pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  console.log("Kwizzy served from " + ROOT);
  console.log("");
  console.log("  local     http://127.0.0.1:" + PORT + "/");
  for (const a of localAddresses()) {
    console.log("  network   http://" + a.address + ":" + PORT + "/   (" + a.name + ")");
  }
  console.log("");
  console.log("Open a 'network' URL from your phone on the same Wi-Fi.");
  console.log("Stop with Ctrl+C.");
});
