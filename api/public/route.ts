import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../lib/supabaseAdmin.js";
import { toCamelCase } from "../../lib/caseConvert.js";
import { getPortalData } from "../../lib/portal.js";
import { logActivity } from "../../lib/activity.js";
import { uploadBase64Image, UploadValidationError, withSignedProofUrl } from "../../lib/storage.js";
import { isRateLimited } from "../../lib/rateLimit.js";
import { normalizeIndonesianPhone } from "../../lib/phone.js";
import { submitFreeInputDeclaration } from "../../lib/freeInputAllocations.js";
import { getSlug } from "../../lib/routeSlug.js";

const TYPE_LABELS: Record<string, string> = { bank: "Bank Account", wallet: "E-Wallet", qris: "QRIS" };

// Consolidates every unauthenticated /api/public/* route into a single
// serverless function (Vercel Hobby caps a deployment at 12 functions) via
// an optional catch-all segment. "pay" is kept as a short-URL alias of
// "pay-portal" (same handler), matching the original two-path behavior.
//   ["payment-methods"]                 -> GET
//   ["message-action"]                  -> POST
//   ["find-portal"]                     -> POST
//   ["pay-portal" | "pay", token]        -> GET
//   ["pay-portal" | "pay", token, "declare"] -> POST
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const slug = getSlug(req);
  const route = slug[0];

  if (slug.length === 1 && route === "payment-methods") {
    if (req.method !== "GET") return res.status(405).json({ error: "Metode tidak diizinkan" });

    const { data, error } = await supabaseAdmin
      .from("payment_methods")
      .select("*")
      .eq("enabled", true)
      .order("display_order", { ascending: true });
    if (error) return res.status(500).json({ error: error.message });

    const methods = (data ?? []).map((m: any) => {
      const camel = toCamelCase(m);
      return {
        ...camel,
        accountName: camel.accountHolder,
        qrisImage: camel.imageUrl,
        isPreferred: camel.preferred,
        type: TYPE_LABELS[m.type] || m.type,
      };
    });
    return res.json(methods);
  }

  if (slug.length === 1 && route === "message-action") {
    if (req.method !== "POST") return res.status(405).json({ error: "Metode tidak diizinkan" });

    const { participantId, categoryId, type, generatedMessage, link, action } = req.body ?? {};
    if (!participantId || !categoryId || !type) {
      return res.status(400).json({ error: "Detail aksi tidak lengkap." });
    }

    const { data, error } = await supabaseAdmin
      .from("message_actions")
      .insert({
        participant_id: participantId,
        category_id: categoryId,
        type,
        generated_message: generatedMessage,
        link,
        opened_at: action === "whatsapp_opened" ? new Date().toISOString() : null,
        manually_marked_sent_at: action === "sent" ? new Date().toISOString() : null,
      })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });

    if (type === "introduction") {
      await supabaseAdmin
        .from("participants")
        .update({ introduction_state: action === "whatsapp_opened" ? "Opened" : "ManuallyMarkedSent" })
        .eq("id", participantId);
    }

    return res.json(toCamelCase(data));
  }

  if (slug.length === 1 && route === "find-portal") {
    if (req.method !== "POST") return res.status(405).json({ error: "Metode tidak diizinkan" });

    if (await isRateLimited(req, res, "find-portal", { windowSeconds: 900, maxRequests: 8 })) {
      return;
    }

    const { query } = req.body ?? {};
    if (!query || typeof query !== "string" || !query.trim()) {
      return res.status(400).json({ error: "Silakan masukkan nomor telepon atau token Anda." });
    }

    const q = query.trim().toLowerCase();

    const { data: cpDirectRows } = await supabaseAdmin
      .from("category_participants")
      .select("personal_token")
      .eq("personal_token", q)
      .eq("token_state", "Active")
      .limit(1);
    if (cpDirectRows && cpDirectRows.length > 0) {
      return res.json({ token: cpDirectRows[0].personal_token });
    }

    const normalizedPhone = normalizeIndonesianPhone(query.trim());
    if (!normalizedPhone || normalizedPhone.length < 8) {
      return res.status(404).json({ error: "Data peserta tidak ditemukan. Pastikan nomor HP atau token Anda sesuai." });
    }

    const { data: participant } = await supabaseAdmin
      .from("participants")
      .select("id, full_name")
      .eq("normalized_phone", normalizedPhone)
      .maybeSingle();
    if (!participant) {
      return res.status(404).json({ error: "Data peserta tidak ditemukan. Pastikan nomor HP atau token Anda sesuai." });
    }

    const { data: matchedCPs } = await supabaseAdmin
      .from("category_participants")
      .select("personal_token, categories(name)")
      .eq("participant_id", participant.id)
      .eq("token_state", "Active");

    if (!matchedCPs || matchedCPs.length === 0) {
      return res.status(404).json({ error: "Tidak ada link pembayaran aktif untuk peserta ini." });
    }

    const results = matchedCPs.map((cp: any) => ({
      token: cp.personal_token,
      participantName: participant.full_name || "Peserta",
      categoryName: cp.categories?.name || "Kategori Tagihan",
    }));

    return res.json({ results });
  }

  if (slug.length >= 2 && (route === "pay-portal" || route === "pay")) {
    const token = slug[1];

    if (slug.length === 2) {
      if (req.method !== "GET") return res.status(405).json({ error: "Metode tidak diizinkan" });

      try {
        const result = await getPortalData(token);
        if (result.status !== 200) {
          return res.status(result.status).json({ error: result.error });
        }
        return res.json(result.body);
      } catch (err: any) {
        console.error("pay-portal error:", err);
        return res.status(500).json({ error: err?.message || "Gagal memuat portal." });
      }
    }

    if (slug.length === 3 && slug[2] === "declare") {
      if (req.method !== "POST") return res.status(405).json({ error: "Metode tidak diizinkan" });

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

      const { data: myAllocations } = await supabaseAdmin
        .from("allocations")
        .select("*")
        .eq("participant_id", cp.participant_id)
        .eq("status", "Approved")
        .in("transaction_id", obligations);
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

      return res.status(201).json(toCamelCase(await withSignedProofUrl(createdSubmissions[0])));
    }

    if (slug.length === 3 && slug[2] === "free-input") {
      if (req.method !== "POST") return res.status(405).json({ error: "Metode tidak diizinkan" });

      const { allocationId, amount } = req.body ?? {};
      if (!allocationId || amount === undefined || Number(amount) < 0) {
        return res.status(400).json({ error: "Nominal deklarasi tidak valid." });
      }

      const { data: cpRows, error: cpError } = await supabaseAdmin
        .from("category_participants")
        .select("participant_id, token_state")
        .eq("personal_token", token)
        .limit(1);
      if (cpError) return res.status(500).json({ error: cpError.message });
      const cp = cpRows?.[0];
      if (!cp || cp.token_state !== "Active") {
        return res.status(403).json({ error: "Token tidak valid atau tautan tidak aktif." });
      }

      // Scoped to this specific item's allocation row, and to the token's
      // own participant — a participant can only ever act on their own
      // declaration, never someone else's, even if they guess an id.
      const { data: alloc, error: allocError } = await supabaseAdmin
        .from("allocations")
        .select("id, transaction_id, item_id")
        .eq("id", allocationId)
        .eq("participant_id", cp.participant_id)
        .eq("method", "FreeInput")
        .maybeSingle();
      if (allocError) return res.status(500).json({ error: allocError.message });
      if (!alloc) return res.status(404).json({ error: "Deklarasi untuk item ini tidak ditemukan." });

      const roundedAmount = Math.round(Number(amount));
      try {
        // Takes effect immediately — there is no separate admin-approval
        // step for the value itself, only for the eventual payment submission.
        await submitFreeInputDeclaration(allocationId, roundedAmount);
      } catch (err: any) {
        return res.status(400).json({ error: err?.message || "Gagal mengirim nominal." });
      }

      await logActivity(null, "transaction", alloc.transaction_id, "free_input_declared", "participant", {
        participantId: cp.participant_id,
        itemId: alloc.item_id,
        amount: roundedAmount,
      });

      return res.json({ success: true });
    }
  }

  res.status(404).json({ error: "Rute tidak ditemukan." });
}
