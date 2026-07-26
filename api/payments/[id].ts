import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../lib/supabaseAdmin";
import { requireAdmin } from "../../lib/auth";
import { logActivity } from "../../lib/activity";
import { toCamelCase } from "../../lib/caseConvert";
import { withSignedProofUrl } from "../../lib/storage";
import { recalculatePaymentAllocations } from "../../lib/paymentAllocations";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const id = req.query.id as string;

  if (req.method === "PATCH") {
    const { submittedAmount, notes, referenceNumber } = req.body ?? {};

    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("payment_submissions")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (fetchError) return res.status(500).json({ error: fetchError.message });
    if (!existing) return res.status(404).json({ error: "Data pengajuan pembayaran tidak ditemukan." });

    const updates: Record<string, any> = {};
    if (submittedAmount !== undefined) updates.submitted_amount = submittedAmount;
    if (notes !== undefined) updates.notes = notes;
    if (referenceNumber !== undefined) updates.reference_number = referenceNumber;
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: "Tidak ada perubahan yang dikirim." });

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("payment_submissions")
      .update(updates)
      .eq("id", id)
      .select()
      .single();
    if (updateError) return res.status(500).json({ error: updateError.message });

    // If this submission had already been approved, its payment_allocations
    // rows (used for per-transaction remaining-balance math) were prorated
    // against the old submitted_amount and must be recomputed.
    if (existing.status === "Paid" && submittedAmount !== undefined) {
      await recalculatePaymentAllocations(id, existing.participant_id, existing.selected_obligations || [], submittedAmount);
    }

    await logActivity(admin.id, "payment", id, "edited", "admin", { changes: updates });
    return res.json(toCamelCase(await withSignedProofUrl(updated)));
  }

  if (req.method !== "DELETE") return res.status(405).json({ error: "Metode tidak diizinkan" });

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
