import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../lib/supabaseAdmin";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Metode tidak diizinkan" });

  const { count, error } = await supabaseAdmin.from("admins").select("id", { count: "exact", head: true });
  if (error) return res.status(500).json({ error: error.message });

  res.json({ setupRequired: (count ?? 0) === 0 });
}
