import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";
import { requireAdmin } from "../../../lib/auth";
import { logActivity } from "../../../lib/activity";
import { toCamelCase } from "../../../lib/caseConvert";
import { withSignedProofUrl } from "../../../lib/storage";

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
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("payment_submissions")
      .update({ status: "Paid", verification_date: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (updateError) return res.status(500).json({ error: updateError.message });

    await supabaseAdmin.from("payment_allocations").delete().eq("payment_submission_id", id);

    const obligationIds: string[] = sub.selected_obligations || [];
    if (obligationIds.length > 0) {
      const { data: allocations } = await supabaseAdmin
        .from("allocations")
        .select("transaction_id, rounded_amount")
        .eq("participant_id", sub.participant_id)
        .in("transaction_id", obligationIds);

      const obligationByTx = new Map<string, number>();
      (allocations ?? []).forEach((a: any) => {
        obligationByTx.set(a.transaction_id, (obligationByTx.get(a.transaction_id) || 0) + a.rounded_amount);
      });

      const totalObligationToCover = obligationIds.reduce((sum, txId) => sum + (obligationByTx.get(txId) || 0), 0);

      if (totalObligationToCover > 0) {
        let runningAllocated = 0;
        const rows = obligationIds.map((txId, idx) => {
          const pObligation = obligationByTx.get(txId) || 0;
          let allocatedShare: number;
          if (idx === obligationIds.length - 1) {
            allocatedShare = sub.submitted_amount - runningAllocated;
          } else {
            allocatedShare = Math.round((sub.submitted_amount * pObligation) / totalObligationToCover);
            runningAllocated += allocatedShare;
          }
          return { payment_submission_id: id, transaction_id: txId, amount: allocatedShare };
        });
        const { error: allocError } = await supabaseAdmin.from("payment_allocations").insert(rows);
        if (allocError) return res.status(500).json({ error: allocError.message });
      }
    }

    await logActivity(admin.id, "payment", id, "approved", "admin", { amount: sub.submitted_amount });
    return res.json(toCamelCase(await withSignedProofUrl(updated)));
  }

  if (action === "reject") {
    const reason = rejectionReason || "Incomplete proof of payment or invalid transfer amount.";
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
