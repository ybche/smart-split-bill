import type { VercelRequest } from "@vercel/node";

// Vercel's bracket-based catch-all file convention (e.g. api/categories/[...slug].ts)
// turned out to only route a single path segment deep in this project's
// deployment (anything nested 2+ segments returned a platform-level 404
// before ever reaching the function) — confirmed live. Routes are now
// consolidated behind a plain, non-dynamic api/<group>/_handler.ts file per
// group, and vercel.json rewrites every "/api/<group>/..." request to it,
// passing the real sub-path through as the "slug" query param (Vercel
// auto-appends any dynamic rewrite segment not referenced in the
// destination). This reads that value back out, tolerating either an array
// (local dev) or a single "/"-joined string (production) shape.
export function getSlug(req: VercelRequest): string[] {
  const raw = req.query.slug;
  if (!raw) return [];
  const parts = Array.isArray(raw) ? raw : [raw];
  return parts
    .flatMap((p) => p.split("/"))
    .filter(Boolean)
    .map((s) => decodeURIComponent(s));
}
