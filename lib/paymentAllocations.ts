import { supabaseAdmin } from "./supabaseAdmin.js";

// Reproportions a payment submission's total submitted_amount across the
// transactions it covers, weighted by how much of that participant's
// obligation each transaction represents. Used both when a submission is
// approved and whenever its submitted_amount is edited after approval.
export async function recalculatePaymentAllocations(
  submissionId: string,
  participantId: string,
  obligationIds: string[],
  submittedAmount: number
): Promise<void> {
  await supabaseAdmin.from("payment_allocations").delete().eq("payment_submission_id", submissionId);

  if (obligationIds.length === 0) return;

  const { data: allocations } = await supabaseAdmin
    .from("allocations")
    .select("transaction_id, rounded_amount")
    .eq("participant_id", participantId)
    .in("transaction_id", obligationIds);

  const obligationByTx = new Map<string, number>();
  (allocations ?? []).forEach((a: any) => {
    obligationByTx.set(a.transaction_id, (obligationByTx.get(a.transaction_id) || 0) + a.rounded_amount);
  });

  const totalObligationToCover = obligationIds.reduce((sum, txId) => sum + (obligationByTx.get(txId) || 0), 0);
  if (totalObligationToCover === 0) return;

  let runningAllocated = 0;
  const rows = obligationIds.map((txId, idx) => {
    const pObligation = obligationByTx.get(txId) || 0;
    let allocatedShare: number;
    if (idx === obligationIds.length - 1) {
      allocatedShare = submittedAmount - runningAllocated;
    } else {
      allocatedShare = Math.round((submittedAmount * pObligation) / totalObligationToCover);
      runningAllocated += allocatedShare;
    }
    return { payment_submission_id: submissionId, transaction_id: txId, amount: allocatedShare };
  });
  await supabaseAdmin.from("payment_allocations").insert(rows);
}
