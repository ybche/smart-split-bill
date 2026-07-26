import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomBytes } from "crypto";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";
import { requireAdmin } from "../../../../../lib/auth";
import { logActivity } from "../../../../../lib/activity";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Metode tidak diizinkan" });

  const categoryId = req.query.id as string;
  const participantId = req.query.participantId as string;

  const { count, error: countError } = await supabaseAdmin
    .from("category_participants")
    .select("id", { count: "exact", head: true })
    .eq("participant_id", participantId);
  if (countError) return res.status(500).json({ error: countError.message });
  if (!count) return res.status(404).json({ error: "Data hubungan peserta-kategori tidak ditemukan." });

  const newToken = randomBytes(16).toString("hex");
  // Regenerates across ALL categories this participant belongs to, matching the
  // original "one personal token per participant" behavior — not scoped to categoryId.
  const { error } = await supabaseAdmin
    .from("category_participants")
    .update({ personal_token: newToken, token_state: "Active" })
    .eq("participant_id", participantId);
  if (error) return res.status(500).json({ error: error.message });

  await logActivity(admin.id, "token", participantId, "regenerated", "admin", { categoryId });
  res.json({ success: true, personalToken: newToken });
}
