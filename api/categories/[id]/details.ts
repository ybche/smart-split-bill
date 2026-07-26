import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";
import { requireAdmin } from "../../../lib/auth";
import { toCamelCase } from "../../../lib/caseConvert";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== "GET") return res.status(405).json({ error: "Metode tidak diizinkan" });

  const id = req.query.id as string;

  const { data: category, error: catError } = await supabaseAdmin.from("categories").select("*").eq("id", id).maybeSingle();
  if (catError) return res.status(500).json({ error: catError.message });
  if (!category) return res.status(404).json({ error: "Kategori tidak ditemukan." });

  const [
    { data: cps, error: cpError },
    { data: transactions, error: txError },
    { data: payments, error: paymentsError },
    { data: allocations, error: allocError },
  ] = await Promise.all([
    supabaseAdmin.from("category_participants").select("*, participants(*)").eq("category_id", id),
    supabaseAdmin.from("transactions").select("*").eq("category_id", id),
    supabaseAdmin.from("payment_submissions").select("*").eq("category_id", id),
    supabaseAdmin
      .from("allocations")
      .select("*, transactions!inner(category_id)")
      .eq("transactions.category_id", id),
  ]);
  if (cpError) return res.status(500).json({ error: cpError.message });
  if (txError) return res.status(500).json({ error: txError.message });
  if (paymentsError) return res.status(500).json({ error: paymentsError.message });
  if (allocError) return res.status(500).json({ error: allocError.message });

  const mappedParticipants = (cps ?? [])
    .filter((cp: any) => cp.participants)
    .map((cp: any) => ({
      ...toCamelCase(cp.participants),
      personalToken: cp.personal_token,
      tokenState: cp.token_state,
    }));

  const participantObligations: Record<string, { totalOriginalObligation: number; paid: number; pending: number; remaining: number }> = {};
  mappedParticipants.forEach((p: any) => {
    participantObligations[p.id] = { totalOriginalObligation: 0, paid: 0, pending: 0, remaining: 0 };
  });

  let totalSpent = 0;
  let verifiedPaid = 0;
  let pendingPaid = 0;

  (transactions ?? []).forEach((t: any) => {
    totalSpent += t.total;
  });

  (allocations ?? []).forEach((alloc: any) => {
    if (participantObligations[alloc.participant_id]) {
      participantObligations[alloc.participant_id].totalOriginalObligation += alloc.rounded_amount;
    }
  });

  (payments ?? []).forEach((p: any) => {
    if (p.status === "Paid") {
      verifiedPaid += p.submitted_amount;
      if (participantObligations[p.participant_id]) {
        participantObligations[p.participant_id].paid += p.submitted_amount;
      }
    } else if (p.status === "Pending Verification") {
      pendingPaid += p.submitted_amount;
      if (participantObligations[p.participant_id]) {
        participantObligations[p.participant_id].pending += p.submitted_amount;
      }
    }
  });

  mappedParticipants.forEach((p: any) => {
    const ob = participantObligations[p.id];
    ob.remaining = Math.max(0, ob.totalOriginalObligation - ob.paid);
  });

  const totalOutstanding = totalSpent - verifiedPaid;

  res.json({
    category: toCamelCase(category),
    participants: mappedParticipants.map((p: any) => ({ ...p, totals: participantObligations[p.id] })),
    transactions: toCamelCase(transactions),
    totals: {
      totalSpent,
      verifiedPaid,
      pendingPaid,
      outstanding: Math.max(0, totalOutstanding),
    },
  });
}
