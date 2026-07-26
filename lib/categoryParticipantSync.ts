import { randomBytes } from "crypto";
import { supabaseAdmin } from "./supabaseAdmin.js";

// Reuses an existing personal_token for this participant (from any category)
// so each participant only ever has one token, matching the original
// "one personalToken per participant" design.
export async function getOrCreateParticipantToken(participantId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("category_participants")
    .select("personal_token")
    .eq("participant_id", participantId)
    .not("personal_token", "is", null)
    .limit(1)
    .maybeSingle();
  return data?.personal_token || randomBytes(16).toString("hex");
}

// Keeps category_participants (portal access) in sync with who actually has
// allocations in a category's transactions. A participant automatically
// gains a payment portal the moment they're allocated a share of any
// transaction in the category, and loses it once they have zero allocations
// left there (e.g. after editing/deleting the transaction that split to them).
export async function syncCategoryParticipants(categoryId: string): Promise<void> {
  const { data: txRows, error: txErr } = await supabaseAdmin.from("transactions").select("id").eq("category_id", categoryId);
  if (txErr) console.error("[sync] fetch transactions failed:", txErr.message);
  const transactionIds = (txRows ?? []).map((t: any) => t.id);

  let allocatedParticipantIds = new Set<string>();
  if (transactionIds.length > 0) {
    const { data: allocs, error: allocErr } = await supabaseAdmin
      .from("allocations")
      .select("participant_id")
      .in("transaction_id", transactionIds);
    if (allocErr) console.error("[sync] fetch allocations failed:", allocErr.message);
    allocatedParticipantIds = new Set((allocs ?? []).map((a: any) => a.participant_id));
  }

  const { data: existingCps, error: cpErr } = await supabaseAdmin
    .from("category_participants")
    .select("id, participant_id")
    .eq("category_id", categoryId);
  if (cpErr) console.error("[sync] fetch existing category_participants failed:", cpErr.message);

  const existingParticipantIds = new Set((existingCps ?? []).map((cp: any) => cp.participant_id));
  const toAdd = [...allocatedParticipantIds].filter((pId) => !existingParticipantIds.has(pId));
  const toRemove = (existingCps ?? []).filter((cp: any) => !allocatedParticipantIds.has(cp.participant_id));

  for (const participantId of toAdd) {
    const token = await getOrCreateParticipantToken(participantId);
    const { error: insertErr } = await supabaseAdmin.from("category_participants").insert({
      category_id: categoryId,
      participant_id: participantId,
      personal_token: token,
      token_state: "Active",
    });
    if (insertErr) console.error(`[sync] insert failed for participant ${participantId}:`, insertErr.message);
  }

  for (const cp of toRemove) {
    const { error: deleteErr } = await supabaseAdmin.from("category_participants").delete().eq("id", cp.id);
    if (deleteErr) console.error(`[sync] delete failed for cp ${cp.id}:`, deleteErr.message);
  }
}
