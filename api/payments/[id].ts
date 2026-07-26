import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../lib/supabaseAdmin";
import { requireAdmin } from "../../lib/auth";
import { logActivity } from "../../lib/activity";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== "DELETE") return res.status(405).json({ error: "Metode tidak diizinkan" });

  const id = req.query.id as string;

  const { data: existing, error: fetchError } = await supabaseAdmin
    .from("payment_submissions")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (fetchError) return res.status(500).json({ error: fetchError.message });
  if (!existing) return res.status(404).json({ error: "Data pengajuan pembayaran tidak ditemukan." });

  // payment_allocations cascade-delete via FK on payment_submissions.id
  const { error } = await supabaseAdmin.from("payment_submissions").delete().eq("id", id);
  if (error) return res.status(500).json({ error: error.message });

  await logActivity(admin.id, "payment", id, "deleted", "admin", {
    participantId: existing.participant_id,
    categoryId: existing.category_id,
    amount: existing.submitted_amount,
  });

  res.json({ success: true });
}
