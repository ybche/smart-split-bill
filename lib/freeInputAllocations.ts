import { supabaseAdmin } from "./supabaseAdmin.js";

// Free-input allocations let a participant self-declare their own share of a
// transaction the admin doesn't have exact item/price data for (e.g. cash
// paid up front with no surviving receipt). They live in the same
// `allocations` table as normal split-engine rows, tagged
// method='FreeInput', and cycle through:
//   AwaitingInput -> (participant submits) -> Pending -> Approved | Rejected
// Only 'Approved' rows count toward obligation totals anywhere in the app.

// Creates the initial "please declare your share" placeholder rows for one
// item within a transaction. Participants who already have a FreeInput row
// for this specific item (in any status) are skipped, so this is safe to
// call again on every transaction edit without duplicating or clobbering an
// existing declaration.
export async function createAwaitingInputRows(transactionId: string, itemId: string, participantIds: string[]): Promise<void> {
  if (participantIds.length === 0) return;

  const { data: existing, error: fetchError } = await supabaseAdmin
    .from("allocations")
    .select("participant_id")
    .eq("transaction_id", transactionId)
    .eq("item_id", itemId)
    .eq("method", "FreeInput");
  if (fetchError) throw new Error(fetchError.message);

  const existingIds = new Set((existing ?? []).map((a: any) => a.participant_id));
  const rows = participantIds
    .filter((participantId) => !existingIds.has(participantId))
    .map((participantId) => ({
      transaction_id: transactionId,
      item_id: itemId,
      participant_id: participantId,
      method: "FreeInput",
      status: "AwaitingInput",
      raw_amount: 0,
      rounded_amount: 0,
    }));
  if (rows.length === 0) return;

  const { error } = await supabaseAdmin.from("allocations").insert(rows);
  if (error) throw new Error(error.message);
}

async function bumpTransactionTotal(transactionId: string, delta: number): Promise<void> {
  if (delta === 0) return;
  const { data: tx, error: fetchError } = await supabaseAdmin
    .from("transactions")
    .select("total")
    .eq("id", transactionId)
    .maybeSingle();
  if (fetchError) throw new Error(fetchError.message);
  if (!tx) return;

  const { error: updateError } = await supabaseAdmin
    .from("transactions")
    .update({ total: tx.total + delta })
    .eq("id", transactionId);
  if (updateError) throw new Error(updateError.message);
}

// Approving folds the declared amount into transactions.total so the
// "Total Amount" column stays an accurate, confirmed figure.
export async function approveFreeInput(allocationId: string): Promise<void> {
  const { data: alloc, error: fetchError } = await supabaseAdmin
    .from("allocations")
    .select("*")
    .eq("id", allocationId)
    .maybeSingle();
  if (fetchError) throw new Error(fetchError.message);
  if (!alloc) throw new Error("Deklarasi tidak ditemukan.");
  if (alloc.method !== "FreeInput") throw new Error("Alokasi ini bukan deklarasi input bebas.");

  const wasApproved = alloc.status === "Approved";

  const { error: updateError } = await supabaseAdmin
    .from("allocations")
    .update({ status: "Approved", rejection_reason: null })
    .eq("id", allocationId);
  if (updateError) throw new Error(updateError.message);

  if (!wasApproved) {
    await bumpTransactionTotal(alloc.transaction_id, alloc.rounded_amount);
  }
}

// Rejecting lets the participant declare again (portal shows the reason and
// re-opens the input field). If this reverses a previously-approved amount,
// the earlier total bump is undone.
export async function rejectFreeInput(allocationId: string, reason: string): Promise<void> {
  const { data: alloc, error: fetchError } = await supabaseAdmin
    .from("allocations")
    .select("*")
    .eq("id", allocationId)
    .maybeSingle();
  if (fetchError) throw new Error(fetchError.message);
  if (!alloc) throw new Error("Deklarasi tidak ditemukan.");
  if (alloc.method !== "FreeInput") throw new Error("Alokasi ini bukan deklarasi input bebas.");

  const wasApproved = alloc.status === "Approved";

  const { error: updateError } = await supabaseAdmin
    .from("allocations")
    .update({ status: "Rejected", rejection_reason: reason })
    .eq("id", allocationId);
  if (updateError) throw new Error(updateError.message);

  if (wasApproved) {
    await bumpTransactionTotal(alloc.transaction_id, -alloc.rounded_amount);
  }
}
