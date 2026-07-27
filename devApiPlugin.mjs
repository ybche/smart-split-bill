// Dev-only Vite plugin that serves /api/*.ts (Vercel serverless function files)
// directly during `vite dev`, so local testing doesn't require `vercel login`.
// Production deployments run these same files through Vercel's real runtime —
// this plugin only exists for local development.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_DIR = path.join(__dirname, "api");

// Groups consolidated behind a single api/<group>/route.ts file (see
// vercel.json's rewrites and lib/routeSlug.ts). Every request under one of
// these is routed straight to that file, with everything after the group
// name passed through as the "slug" query param — mirroring how Vercel's
// rewrites pass it in production, since a real bracket-based catch-all file
// only ever matched a single path segment deep on that platform. (A leading
// underscore, e.g. "_handler.ts", was tried first but Vercel silently
// excludes underscore-prefixed files from deployed functions entirely.)
const HANDLER_GROUPS = [
  "categories",
  "transactions",
  "participants",
  "payments",
  "payment-methods",
  "admins",
  "auth",
  "db",
  "public",
];

function resolveApiFile(segments) {
  if (segments.length >= 1 && HANDLER_GROUPS.includes(segments[0])) {
    const handlerFile = path.join(API_DIR, segments[0], "route.ts");
    if (fs.existsSync(handlerFile)) {
      return { file: handlerFile, params: { slug: segments.slice(1) } };
    }
  }

  // Flat, non-dynamic files (activities.ts, scan-receipt.ts, ...).
  if (segments.length === 1) {
    const exactFile = path.join(API_DIR, `${segments[0]}.ts`);
    if (fs.existsSync(exactFile)) return { file: exactFile, params: {} };
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

        const resolved = resolveApiFile(segments);
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
