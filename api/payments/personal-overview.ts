import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../lib/supabaseAdmin";
import { requireAdmin } from "../../lib/auth";
import { getSignedProofUrl } from "../../lib/storage";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== "GET") return res.status(405).json({ error: "Metode tidak diizinkan" });

  const [{ data: participants }, { data: allocations }, { data: transactions }, { data: categories }, { data: items }, { data: submissions }] =
    await Promise.all([
      supabaseAdmin.from("participants").select("*"),
      supabaseAdmin.from("allocations").select("*"),
      supabaseAdmin.from("transactions").select("*"),
      supabaseAdmin.from("categories").select("*"),
      supabaseAdmin.from("transaction_items").select("*"),
      supabaseAdmin.from("payment_submissions").select("*"),
    ]);

  const transactionsById = new Map((transactions ?? []).map((t: any) => [t.id, t]));
  const categoriesById = new Map((categories ?? []).map((c: any) => [c.id, c]));
  const itemsById = new Map((items ?? []).map((i: any) => [i.id, i]));

  const participantsOverview = (participants ?? []).map((p: any) => {
    const pAllocations = (allocations ?? []).filter((al: any) => al.participant_id === p.id);

    const txAllocationsMap = new Map<string, any[]>();
    pAllocations.forEach((al: any) => {
      const list = txAllocationsMap.get(al.transaction_id) || [];
      list.push(al);
      txAllocationsMap.set(al.transaction_id, list);
    });

    const history = Array.from(txAllocationsMap.entries())
      .map(([txId, als]) => {
        const tx = transactionsById.get(txId);
        if (!tx) return null;

        const category = categoriesById.get(tx.category_id);
        const totalExpected = als.reduce((sum, a) => sum + (a.rounded_amount || 0), 0);

        const itemNamesList: string[] = [];
        als.forEach((al) => {
          if (al.item_id) {
            const itemObj = itemsById.get(al.item_id);
            if (itemObj?.name) itemNamesList.push(itemObj.name);
          }
        });
        const itemName = itemNamesList.length > 0 ? itemNamesList.join(", ") : undefined;

        const matchingSubmissions = (submissions ?? []).filter(
          (ps: any) => ps.participant_id === p.id && (ps.selected_obligations || []).includes(tx.id)
        );

        let status: "Not Paid" | "Pending Approval" | "Paid" | "Rejected" = "Not Paid";
        let submittedAmount: number | string = "Not Paid";
        let proofUrl: string | undefined;
        let methodSnapshot: any = null;
        let submissionDate: string | undefined;
        let rejectionReason: string | undefined;
        let submissionId: string | undefined;

        const paidSub = matchingSubmissions.find((s: any) => s.status === "Paid");
        const pendingSub = matchingSubmissions.find((s: any) => s.status === "Pending Verification");
        const rejectedSub = matchingSubmissions.find((s: any) => s.status === "Rejected");

        if (paidSub) {
          status = "Paid";
          submissionId = paidSub.id;
          submittedAmount = paidSub.submitted_amount;
          proofUrl = paidSub.proof_url;
          methodSnapshot = paidSub.method_snapshot;
          submissionDate = paidSub.submission_date;
        } else if (pendingSub) {
          status = "Pending Approval";
          submissionId = pendingSub.id;
          submittedAmount = pendingSub.submitted_amount;
          proofUrl = pendingSub.proof_url;
          methodSnapshot = pendingSub.method_snapshot;
          submissionDate = pendingSub.submission_date;
        } else if (rejectedSub) {
          status = "Rejected";
          submissionId = rejectedSub.id;
          submittedAmount = rejectedSub.submitted_amount;
          proofUrl = rejectedSub.proof_url;
          methodSnapshot = rejectedSub.method_snapshot;
          submissionDate = rejectedSub.submission_date;
          rejectionReason = rejectedSub.rejection_reason;
        }

        return {
          id: tx.id,
          submissionId,
          transactionId: tx.id,
          title: tx.title,
          merchant: tx.merchant,
          itemName,
          date: tx.date,
          categoryId: tx.category_id,
          categoryName: category ? category.name : "Unknown",
          expectedAmount: totalExpected,
          submittedAmount,
          status,
          proofUrl,
          methodSnapshot,
          submissionDate,
          rejectionReason,
        };
      })
      .filter(Boolean);

    return {
      participantId: p.id,
      fullName: p.full_name,
      nickname: p.nickname || p.full_name,
      email: p.email,
      phone: p.normalized_phone,
      history,
    };
  });

  // Sign every proof URL in place (proof_url in the DB is a bare private-bucket
  // path, not a usable URL) before sending the response.
  await Promise.all(
    participantsOverview.flatMap((p: any) =>
      p.history
        .filter((h: any) => h.proofUrl)
        .map(async (h: any) => {
          h.proofUrl = await getSignedProofUrl(h.proofUrl);
        })
    )
  );

  res.json(participantsOverview);
}
