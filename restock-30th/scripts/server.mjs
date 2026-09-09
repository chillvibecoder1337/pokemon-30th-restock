import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHECK = join(ROOT, "scripts", "check.mjs");
const PORT = Number(process.env.PORT || 4173);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".ico": "image/x-icon",
};

function runCheck() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CHECK], {
        cwd: ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let err = "";
    child.stderr.on("data", (chunk) => {
      err += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(err.trim() || `check exited ${code}`));
    });
  });
}

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);

  if (req.method === "POST" && url.pathname === "/api/check") {
    try {
      await runCheck();
      const status = await readFile(join(ROOT, "data", "status.json"), "utf8");
      send(res, 200, status, "application/json; charset=utf-8");
    } catch (err) {
      send(
        res,
        500,
        JSON.stringify({ error: err.message }),
        "application/json; charset=utf-8",
      );
    }
    return;
  }

  let filePath = url.pathname === "/" ? "/index.html" : url.pathname;
  filePath = join(ROOT, filePath.replace(/^\/+/, "").replace(/\.\./g, ""));
  if (!filePath.startsWith(ROOT)) {
    send(res, 403, "Forbidden");
    return;
  }

  try {
    const data = await readFile(filePath);
    send(res, 200, data, TYPES[extname(filePath)] || "application/octet-stream");
  } catch {
    send(res, 404, "Not found");
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Restock dashboard http://127.0.0.1:${PORT}/`);
});
