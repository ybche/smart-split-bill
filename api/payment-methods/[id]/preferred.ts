import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";
import { requireAdmin } from "../../../lib/auth";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Metode tidak diizinkan" });

  const id = req.query.id as string;

  const { data: existing, error: fetchError } = await supabaseAdmin
    .from("payment_methods")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (fetchError) return res.status(500).json({ error: fetchError.message });
  if (!existing) return res.status(404).json({ error: "Metode pembayaran tidak ditemukan." });

  await supabaseAdmin.from("payment_methods").update({ preferred: false }).neq("id", id);
  const { error } = await supabaseAdmin.from("payment_methods").update({ preferred: true }).eq("id", id);
  if (error) return res.status(500).json({ error: error.message });

  res.json({ success: true });
}
