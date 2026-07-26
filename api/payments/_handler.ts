import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../lib/supabaseAdmin.js";
import { requireAdmin } from "../../lib/auth.js";
import { logActivity } from "../../lib/activity.js";
import { toCamelCase } from "../../lib/caseConvert.js";
import { withSignedProofUrl, deleteProofImage, getSignedProofUrl } from "../../lib/storage.js";
import { recalculatePaymentAllocations } from "../../lib/paymentAllocations.js";
import { getSlug } from "../../lib/routeSlug.js";

// Consolidates every /api/payments/* route into a single serverless function
// (Vercel Hobby caps a deployment at 12 functions) via an optional catch-all
// segment:
//   []                       -> GET (overview list)
//   ["personal-overview"]     -> GET
//   [id]                      -> PATCH / DELETE
//   [id, "verify"]            -> POST
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const slug = getSlug(req);

  if (slug.length === 0) {
    if (req.method !== "GET") return res.status(405).json({ error: "Metode tidak diizinkan" });

    const [{ data: submissions, error: subError }, { data: participants }, { data: categories }, { data: allocations }] = await Promise.all([
      supabaseAdmin.from("payment_submissions").select("*").order("submission_date", { ascending: false }),
      supabaseAdmin.from("participants").select("id, full_name"),
      supabaseAdmin.from("categories").select("id, name"),
      supabaseAdmin.from("allocations").select("transaction_id, participant_id, rounded_amount"),
    ]);
    if (subError) return res.status(500).json({ error: subError.message });

    const participantsById = new Map((participants ?? []).map((p: any) => [p.id, p.full_name]));
    const categoriesById = new Map((categories ?? []).map((c: any) => [c.id, c.name]));

    const enriched = await Promise.all(
      (submissions ?? []).map(async (p: any) => {
        const obligations: string[] = p.selected_obligations || [];
        const expectedAmount = (allocations ?? [])
          .filter((al: any) => obligations.includes(al.transaction_id) && al.participant_id === p.participant_id)
          .reduce((sum: number, al: any) => sum + (al.rounded_amount || 0), 0);

        const signed = await withSignedProofUrl(p);
        return {
          ...toCamelCase(signed),
          participantName: participantsById.get(p.participant_id) || "Unknown",
          categoryName: categoriesById.get(p.category_id) || "Unknown",
          expectedAmount,
        };
      })
    );

    return res.json(enriched);
  }

  if (slug.length === 1 && slug[0] === "personal-overview") {
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

    return res.json(participantsOverview);
  }

  const id = slug[0];

  if (slug.length === 1) {
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

    if (req.method === "DELETE") {
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

      return res.json({ success: true });
    }

    return res.status(405).json({ error: "Metode tidak diizinkan" });
  }

  if (slug.length === 2 && slug[1] === "verify") {
    if (req.method !== "POST") return res.status(405).json({ error: "Metode tidak diizinkan" });

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

    return res.status(400).json({ error: "Aksi tidak valid. Harus 'approve' atau 'reject'." });
  }

  res.status(404).json({ error: "Rute tidak ditemukan." });
}
