import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import { requireAdmin } from "../lib/auth.js";
import { toCamelCase } from "../lib/caseConvert.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== "GET") return res.status(405).json({ error: "Metode tidak diizinkan" });

  const { data, error } = await supabaseAdmin.from("activities").select("*").order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  res.json(toCamelCase(data));
}
