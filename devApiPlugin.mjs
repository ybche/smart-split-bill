// Dev-only Vite plugin that serves /api/*.ts (Vercel serverless function files)
// directly during `vite dev`, so local testing doesn't require `vercel login`.
// Production deployments run these same files through Vercel's real runtime —
// this plugin only exists for local development.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_DIR = path.join(__dirname, "api");

function resolveApiFile(baseDir, segments, params) {
  if (segments.length === 0) {
    const indexFile = path.join(baseDir, "index.ts");
    if (fs.existsSync(indexFile)) return { file: indexFile, params };
    return null;
  }

  const [seg, ...rest] = segments;
  let entries;
  try {
    entries = fs.readdirSync(baseDir, { withFileTypes: true });
  } catch {
    return null;
  }

  if (rest.length === 0) {
    const exactFile = path.join(baseDir, `${seg}.ts`);
    if (fs.existsSync(exactFile)) return { file: exactFile, params };
  }

  const exactDir = entries.find((e) => e.isDirectory() && e.name === seg);
  if (exactDir) {
    const result = resolveApiFile(path.join(baseDir, seg), rest, params);
    if (result) return result;
  }

  if (rest.length === 0) {
    const dynFile = entries.find((e) => e.isFile() && /^\[.+\]\.ts$/.test(e.name));
    if (dynFile) {
      const paramName = dynFile.name.match(/^\[(.+)\]\.ts$/)[1];
      return { file: path.join(baseDir, dynFile.name), params: { ...params, [paramName]: seg } };
    }
  }

  const dynDir = entries.find((e) => e.isDirectory() && /^\[.+\]$/.test(e.name));
  if (dynDir) {
    const paramName = dynDir.name.match(/^\[(.+)\]$/)[1];
    const result = resolveApiFile(path.join(baseDir, dynDir.name), rest, { ...params, [paramName]: seg });
    if (result) return result;
  }

  return null;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers["content-type"] || "";
    if (!contentType.includes("application/json")) return resolve(undefined);
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

/** @returns {import('vite').Plugin} */
export default function devApiPlugin() {
  return {
    name: "dev-api-plugin",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith("/api/")) return next();

        const urlObj = new URL(req.url, "http://localhost");
        const segments = urlObj.pathname.replace(/^\/api\//, "").split("/").filter(Boolean);

        const resolved = resolveApiFile(API_DIR, segments, {});
        if (!resolved) {
          res.statusCode = 404;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: `No API route found for ${urlObj.pathname}` }));
          return;
        }

        try {
          req.query = { ...Object.fromEntries(urlObj.searchParams), ...resolved.params };
          req.body = await readJsonBody(req);

          res.status = (code) => {
            res.statusCode = code;
            return res;
          };
          res.json = (body) => {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(body));
          };

          const mod = await server.ssrLoadModule(resolved.file);
          await mod.default(req, res);
        } catch (err) {
          console.error(`[dev-api] Error handling ${req.url}:`, err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: err?.message || "Internal error" }));
          }
        }
      });
    },
  };
}
