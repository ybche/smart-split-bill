import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";
import { requireAdmin } from "../../../lib/auth";
import { logActivity } from "../../../lib/activity";
import { toCamelCase } from "../../../lib/caseConvert";
import { withSignedProofUrl, deleteProofImage } from "../../../lib/storage";
import { recalculatePaymentAllocations } from "../../../lib/paymentAllocations";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Metode tidak diizinkan" });

  const id = req.query.id as string;
  const { action, rejectionReason } = req.body ?? {};

  const { data: sub, error: fetchError } = await supabaseAdmin
    .from("payment_submissions")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (fetchError) return res.status(500).json({ error: fetchError.message });
  if (!sub) return res.status(404).json({ error: "Data pengajuan pembayaran tidak ditemukan." });

  if (action === "approve") {
    // Once approved, the transfer proof image no longer needs to be kept
    // around — reclaim the storage space and clear the reference.
    if (sub.proof_url) await deleteProofImage(sub.proof_url);

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("payment_submissions")
      .update({
        status: "Paid",
        verification_date: new Date().toISOString(),
        ...(sub.proof_url ? { proof_url: null } : {}),
      })
      .eq("id", id)
      .select()
      .single();
    if (updateError) return res.status(500).json({ error: updateError.message });

    await recalculatePaymentAllocations(id, sub.participant_id, sub.selected_obligations || [], sub.submitted_amount);

    await logActivity(admin.id, "payment", id, "approved", "admin", { amount: sub.submitted_amount });
    return res.json(toCamelCase(await withSignedProofUrl(updated)));
  }

  if (action === "reject") {
    const reason = rejectionReason || "Incomplete proof of payment or invalid transfer amount.";

    // Reverses the ledger effect if this submission had previously been
    // approved (admin can re-open and reject an already-Paid submission),
    // so the participant's obligation becomes outstanding again.
    await supabaseAdmin.from("payment_allocations").delete().eq("payment_submission_id", id);

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("payment_submissions")
      .update({ status: "Rejected", rejection_reason: reason, verification_date: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (updateError) return res.status(500).json({ error: updateError.message });

    await logActivity(admin.id, "payment", id, "rejected", "admin", { reason });
    return res.json(toCamelCase(await withSignedProofUrl(updated)));
  }

  res.status(400).json({ error: "Aksi tidak valid. Harus 'approve' atau 'reject'." });
}
