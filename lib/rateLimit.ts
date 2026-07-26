import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "./supabaseAdmin.js";

function getClientIp(req: VercelRequest): string {
  const forwarded = req.headers["x-forwarded-for"];
  const ip = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0];
  return (ip || req.socket?.remoteAddress || "unknown").trim();
}

// Sliding-window rate limit backed by Postgres (serverless functions have no
// shared in-memory state across invocations, so this can't be a plain object).
// Returns true and sends a 429 response if the caller is over the limit.
export async function isRateLimited(
  req: VercelRequest,
  res: VercelResponse,
  action: string,
  { windowSeconds, maxRequests }: { windowSeconds: number; maxRequests: number }
): Promise<boolean> {
  const ip = getClientIp(req);
  const windowStart = new Date(Date.now() - windowSeconds * 1000).toISOString();

  const { count, error: countError } = await supabaseAdmin
    .from("rate_limit_events")
    .select("id", { count: "exact", head: true })
    .eq("ip", ip)
    .eq("action", action)
    .gte("created_at", windowStart);

  if (countError) {
    console.error("rate limit check failed:", countError.message);
  } else if ((count ?? 0) >= maxRequests) {
    res.status(429).json({ error: "Terlalu banyak permintaan. Silakan coba lagi nanti." });
    return true;
  }

  const { error: insertError } = await supabaseAdmin
    .from("rate_limit_events")
    .insert({ ip, action });
  if (insertError) {
    console.error("rate limit record failed:", insertError.message);
  }

  return false;
}
