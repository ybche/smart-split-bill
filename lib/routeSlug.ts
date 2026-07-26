import type { VercelRequest } from "@vercel/node";

// Vercel's catch-all query param (req.query.slug) has proven unreliable for
// this project's deployment (routes beyond the rewritten "_index" case never
// populated it), so path segments are parsed directly from the request URL
// instead — this works identically in production and in the local dev API
// plugin, since both ultimately expose a real Node http req.url.
export function getSlug(req: VercelRequest, groupName: string): string[] {
  const pathname = (req.url || "").split("?")[0];
  const prefix = `/api/${groupName}`;
  const rest = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : pathname;
  return rest
    .split("/")
    .filter(Boolean)
    .map((s) => decodeURIComponent(s));
}
