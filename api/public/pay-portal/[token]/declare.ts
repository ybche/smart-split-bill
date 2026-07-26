import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { logActivity } from "../../../../lib/activity";
import { uploadBase64Image, UploadValidationError, withSignedProofUrl } from "../../../../lib/storage";
import { toCamelCase } from "../../../../lib/caseConvert";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Metode tidak diizinkan" });

  const token = req.query.token as string;
  const {
    selectedObligations,
    selectedTransactionIds,
    submittedAmount,
    methodId,
    paymentMethodId,
    notes,
    referenceNumber,
    base64Proof,
    proofBase64,
    mimeType,
  } = req.body ?? {};

  // personal_token is shared across all of a participant's category_participants
  // rows (one token per participant, not per row), so more than one row can match.
  const { data: cpRows, error: cpError } = await supabaseAdmin
    .from("category_participants")
    .select("*")
    .eq("personal_token", token)
    .limit(1);
  if (cpError) return res.status(500).json({ error: cpError.message });
  const cp = cpRows?.[0];
  if (!cp || cp.token_state !== "Active") {
    return res.status(403).json({ error: "Token tidak valid atau tautan tidak aktif." });
  }

  const finalMethodId = methodId || paymentMethodId;
  const finalProof = base64Proof || proofBase64;

  // Enforce the (previously unenforced) requireProof setting.
  const { data: adminSettings } = await supabaseAdmin.from("admins").select("require_proof").order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (adminSettings?.require_proof && !finalProof) {
    return res.status(400).json({ error: "Bukti transfer wajib dilampirkan." });
  }

  let obligations: string[] = selectedObligations || selectedTransactionIds;
  if (!obligations || obligations.length === 0) {
    const { data: categoryTransactions } = await supabaseAdmin.from("transactions").select("id").eq("category_id", cp.category_id);
    const candidateIds = (categoryTransactions ?? []).map((t: any) => t.id);
    if (candidateIds.length > 0) {
      const { data: allocs } = await supabaseAdmin
        .from("allocations")
        .select("transaction_id")
        .eq("participant_id", cp.participant_id)
        .in("transaction_id", candidateIds);
      obligations = Array.from(new Set((allocs ?? []).map((a: any) => a.transaction_id)));
    } else {
      obligations = [];
    }
  }

  if (!obligations || obligations.length === 0 || !submittedAmount || !finalMethodId) {
    return res.status(400).json({ error: "Silakan pilih tagihan, masukkan jumlah yang dibayarkan, dan pilih metode pembayaran." });
  }

  const { data: method, error: methodError } = await supabaseAdmin
    .from("payment_methods")
    .select("*")
    .eq("id", finalMethodId)
    .maybeSingle();
  if (methodError) return res.status(500).json({ error: methodError.message });
  if (!method) return res.status(404).json({ error: "Metode pembayaran yang dipilih sudah tidak tersedia." });

  let proofUrl = "";
  if (finalProof) {
    try {
      proofUrl = await uploadBase64Image("payment-proofs", finalProof, mimeType || "image/png", "proof");
    } catch (err: any) {
      if (err instanceof UploadValidationError) {
        return res.status(400).json({ error: err.message });
      }
      console.error("Payment proof write error:", err);
    }
  }

  const { data: obligationTxs } = await supabaseAdmin.from("transactions").select("id, category_id").in("id", obligations);
  const categoryToObligations: Record<string, string[]> = {};
  (obligationTxs ?? []).forEach((t: any) => {
    if (!categoryToObligations[t.category_id]) categoryToObligations[t.category_id] = [];
    categoryToObligations[t.category_id].push(t.id);
  });

  const { data: myAllocations } = await supabaseAdmin.from("allocations").select("*").eq("participant_id", cp.participant_id).in("transaction_id", obligations);
  const { data: mySubmissions } = await supabaseAdmin.from("payment_submissions").select("*").eq("participant_id", cp.participant_id);
  const { data: myPaymentAllocations } = await supabaseAdmin.from("payment_allocations").select("*");

  const categoryToRemaining: Record<string, number> = {};
  let totalRemainingOfSelected = 0;

  Object.entries(categoryToObligations).forEach(([catId, txIds]) => {
    let remainingForCat = 0;
    txIds.forEach((txId) => {
      const allocations = (myAllocations ?? []).filter((al: any) => al.transaction_id === txId);
      const obligationAmount = allocations.reduce((sum: number, al: any) => sum + al.rounded_amount, 0);

      const paymentsForTx = (mySubmissions ?? []).filter((ps: any) => (ps.selected_obligations || []).includes(txId));
      const verifiedPaid = paymentsForTx
        .filter((p: any) => p.status === "Paid")
        .reduce((sum: number, p: any) => {
          const pAlloc = (myPaymentAllocations ?? []).find((pa: any) => pa.payment_submission_id === p.id && pa.transaction_id === txId);
          return sum + (pAlloc ? pAlloc.amount : p.submitted_amount);
        }, 0);

      remainingForCat += Math.max(0, obligationAmount - verifiedPaid);
    });
    categoryToRemaining[catId] = remainingForCat;
    totalRemainingOfSelected += remainingForCat;
  });

  const categoriesToSubmit = Object.keys(categoryToObligations);
  const createdSubmissions: any[] = [];

  for (let idx = 0; idx < categoriesToSubmit.length; idx++) {
    const catId = categoriesToSubmit[idx];
    const txIds = categoryToObligations[catId];
    let proportionalAmount: number;
    if (idx === categoriesToSubmit.length - 1) {
      proportionalAmount = Number(submittedAmount) - createdSubmissions.reduce((sum, s) => sum + s.submitted_amount, 0);
    } else if (totalRemainingOfSelected > 0) {
      proportionalAmount = Math.round(Number(submittedAmount) * (categoryToRemaining[catId] / totalRemainingOfSelected));
    } else {
      proportionalAmount = Math.round(Number(submittedAmount) / categoriesToSubmit.length);
    }

    const { data: newSubmission, error: insertError } = await supabaseAdmin
      .from("payment_submissions")
      .insert({
        category_id: catId,
        participant_id: cp.participant_id,
        method_snapshot: method,
        selected_obligations: txIds,
        submitted_amount: proportionalAmount,
        proof_url: proofUrl || null,
        status: "Pending Verification",
        notes: notes ?? null,
        reference_number: referenceNumber ?? null,
        submission_date: new Date().toISOString(),
      })
      .select()
      .single();
    if (insertError) return res.status(500).json({ error: insertError.message });

    createdSubmissions.push(newSubmission);

    await logActivity(null, "payment", newSubmission.id, "submitted", "participant", {
      categoryId: catId,
      participantId: cp.participant_id,
      amount: proportionalAmount,
    });
  }

  res.status(201).json(toCamelCase(await withSignedProofUrl(createdSubmissions[0])));
}
