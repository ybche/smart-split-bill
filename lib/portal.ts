import { supabaseAdmin } from "./supabaseAdmin";
import { toCamelCase } from "./caseConvert";
import { withSignedProofUrl } from "./storage";

// Ported from the original getPayPortalHandler in server.ts.
// Aggregates obligations across ALL of a participant's active category links
// (the "unified billing delegate" behavior), not just the token's own category.
export async function getPortalData(token: string) {
  const { data: cp, error: cpError } = await supabaseAdmin
    .from("category_participants")
    .select("*")
    .eq("personal_token", token)
    .maybeSingle();
  if (cpError) throw new Error(cpError.message);
  if (!cp || cp.token_state !== "Active") {
    return { error: "Tautan aman ini tidak valid, sudah kedaluwarsa, atau telah dicabut.", status: 403 } as const;
  }

  const [
    { data: participant },
    { data: category },
    { data: paymentMethodsRaw },
    { data: activeCPs },
    { data: adminSettings },
  ] = await Promise.all([
    supabaseAdmin.from("participants").select("*").eq("id", cp.participant_id).maybeSingle(),
    supabaseAdmin.from("categories").select("*").eq("id", cp.category_id).maybeSingle(),
    supabaseAdmin.from("payment_methods").select("*").eq("enabled", true),
    supabaseAdmin.from("category_participants").select("*").eq("participant_id", cp.participant_id).eq("token_state", "Active"),
    supabaseAdmin.from("admins").select("require_proof").order("created_at", { ascending: true }).limit(1).maybeSingle(),
  ]);

  if (!participant || !category) {
    return { error: "Detail kategori atau peserta terkait tidak ditemukan.", status: 404 } as const;
  }

  const TYPE_LABELS: Record<string, string> = { bank: "Bank Account", wallet: "E-Wallet", qris: "QRIS" };
  const paymentMethods = (paymentMethodsRaw ?? []).map((m: any) => ({
    ...m,
    accountName: m.account_holder,
    qrisImage: m.image_url,
    isPreferred: m.preferred,
    type: TYPE_LABELS[m.type] || m.type,
  }));

  const categoryIds = (activeCPs ?? []).map((c: any) => c.category_id);

  const [
    { data: allCategories },
    { data: allTransactions },
    { data: allAllocations },
    { data: allItems },
    { data: allSubmissions },
    { data: allPaymentAllocations },
    { data: allParticipants },
  ] = await Promise.all([
    supabaseAdmin.from("categories").select("*").in("id", categoryIds.length ? categoryIds : [cp.category_id]),
    supabaseAdmin.from("transactions").select("*").in("category_id", categoryIds.length ? categoryIds : [cp.category_id]),
    supabaseAdmin.from("allocations").select("*").eq("participant_id", cp.participant_id),
    supabaseAdmin.from("transaction_items").select("*"),
    supabaseAdmin.from("payment_submissions").select("*").eq("participant_id", cp.participant_id),
    supabaseAdmin.from("payment_allocations").select("*"),
    supabaseAdmin.from("participants").select("*"),
  ]);

  const categoriesById = new Map((allCategories ?? []).map((c: any) => [c.id, c]));
  const transactionsById = new Map((allTransactions ?? []).map((t: any) => [t.id, t]));
  const itemsByTx = new Map<string, any[]>();
  (allItems ?? []).forEach((it: any) => {
    const list = itemsByTx.get(it.transaction_id) || [];
    list.push(it);
    itemsByTx.set(it.transaction_id, list);
  });
  const participantsById = new Map((allParticipants ?? []).map((p: any) => [p.id, p]));

  // All allocations for this transaction set (any participant), needed for "sharesWith".
  const { data: allTxAllocationsRaw } = await supabaseAdmin
    .from("allocations")
    .select("*")
    .in("transaction_id", Array.from(transactionsById.keys()).length ? Array.from(transactionsById.keys()) : ["00000000-0000-0000-0000-000000000000"]);
  const allTxAllocationsByTx = new Map<string, any[]>();
  (allTxAllocationsRaw ?? []).forEach((al: any) => {
    const list = allTxAllocationsByTx.get(al.transaction_id) || [];
    list.push(al);
    allTxAllocationsByTx.set(al.transaction_id, list);
  });

  const nameOf = (pId: string) => {
    const p = participantsById.get(pId);
    return p ? p.nickname || p.full_name : null;
  };

  const outstandingList: any[] = [];
  const payableTransactions: any[] = [];
  let totalOriginalObligation = 0;

  for (const activeCP of activeCPs ?? []) {
    const cat = categoriesById.get(activeCP.category_id);
    if (!cat) continue;

    const categoryTransactions = (allTransactions ?? []).filter((t: any) => t.category_id === activeCP.category_id);

    for (const t of categoryTransactions) {
      const allocations = (allAllocations ?? []).filter((al: any) => al.transaction_id === t.id);
      if (allocations.length === 0) continue;

      const obligationAmount = allocations.reduce((sum: number, al: any) => sum + al.rounded_amount, 0);

      const paymentsForTx = (allSubmissions ?? []).filter((ps: any) => (ps.selected_obligations || []).includes(t.id));

      const verifiedPaid = paymentsForTx
        .filter((p: any) => p.status === "Paid")
        .reduce((sum: number, p: any) => {
          const pAlloc = (allPaymentAllocations ?? []).find((pa: any) => pa.payment_submission_id === p.id && pa.transaction_id === t.id);
          return sum + (pAlloc ? pAlloc.amount : p.submitted_amount);
        }, 0);

      const pendingPaid = paymentsForTx
        .filter((p: any) => p.status === "Pending Verification")
        .reduce((sum: number, p: any) => sum + p.submitted_amount, 0);

      const remainingAmount = Math.max(0, obligationAmount - verifiedPaid);
      totalOriginalObligation += obligationAmount;

      const hasPendingOrPaid = paymentsForTx.some((p: any) => p.status === "Paid" || p.status === "Pending Verification");
      if (hasPendingOrPaid || remainingAmount <= 0) continue;

      const txItems = itemsByTx.get(t.id) || [];
      const outstandingItems = txItems
        .map((it: any) => {
          const itemAlloc = allocations.find((al: any) => al.item_id === it.id);
          if (!itemAlloc) return null;
          return {
            name: it.name,
            quantity: it.quantity,
            unitPrice: it.unit_price,
            lineTotal: it.line_total,
            participantShare: itemAlloc.rounded_amount,
          };
        })
        .filter(Boolean);

      const assignedItems = txItems
        .map((it: any) => {
          const itemAlloc = allocations.find((al: any) => al.item_id === it.id);
          if (!itemAlloc) return null;
          const itemAllocations = (allTxAllocationsByTx.get(t.id) || []).filter((al: any) => al.item_id === it.id);
          const itemParticipantIds = Array.from(new Set(itemAllocations.map((al: any) => al.participant_id)));
          const otherItemParticipantIds = itemParticipantIds.filter((pId) => pId !== cp.participant_id);
          const allItemParticipantNames = itemParticipantIds.map(nameOf).filter(Boolean);
          const itemSharesWith = otherItemParticipantIds
            .map((pId: any) => {
              const p = participantsById.get(pId);
              return p ? { id: p.id, fullName: p.full_name, nickname: p.nickname || p.full_name } : null;
            })
            .filter(Boolean);

          return {
            id: it.id,
            name: it.name,
            quantity: it.quantity,
            unitPrice: it.unit_price,
            lineTotal: it.line_total,
            allocatedAmount: itemAlloc.rounded_amount,
            sharesWith: itemSharesWith,
            sharedByNames: allItemParticipantNames,
            participantCount: itemParticipantIds.length,
          };
        })
        .filter(Boolean);

      const chargesAllocated = allocations.filter((al: any) => !al.item_id).reduce((sum: number, al: any) => sum + al.rounded_amount, 0);

      const allTxAllocations = allTxAllocationsByTx.get(t.id) || [];
      const otherParticipantIds = Array.from(new Set(allTxAllocations.filter((al: any) => al.participant_id !== cp.participant_id).map((al: any) => al.participant_id)));
      const sharesWith = otherParticipantIds
        .map((pId: any) => {
          const p = participantsById.get(pId);
          return p ? { id: p.id, fullName: p.full_name, nickname: p.nickname || p.full_name } : null;
        })
        .filter(Boolean);
      const participantCount = new Set(allTxAllocations.map((al: any) => al.participant_id)).size;

      const payerName = t.payer_id === "administrator" ? "Administrator" : participantsById.get(t.payer_id)?.full_name || "Payer";
      const charges = allocations.filter((al: any) => !al.item_id).map((al: any) => ({ type: al.charge_type, amount: al.rounded_amount }));

      outstandingList.push({
        transactionId: t.id, title: t.title, merchant: t.merchant, date: t.date, categoryName: cat.name,
        payerName, obligationAmount, verifiedPaid, pendingPaid, remainingAmount,
        classification: t.expense_classification, items: outstandingItems, sharesWith, participantCount,
        transactionTotal: t.total, charges,
      });

      payableTransactions.push({
        id: t.id, transactionId: t.id, title: t.title, merchant: t.merchant, date: t.date, categoryName: cat.name,
        payerName, allocationTotal: obligationAmount, obligationAmount, verifiedPaid, pendingPaid, remainingAmount,
        classification: t.expense_classification, assignedItems, items: outstandingItems, sharesWith, participantCount,
        transactionTotal: t.total, chargesAllocated, charges,
      });
    }
  }

  const rawPaymentHistory = allSubmissions ?? [];
  const verifiedPaidTotal = rawPaymentHistory.filter((ps: any) => ps.status === "Paid").reduce((sum: number, ps: any) => sum + ps.submitted_amount, 0);
  const pendingPaidTotal = rawPaymentHistory
    .filter((ps: any) => ps.status === "Pending Verification")
    .reduce((sum: number, ps: any) => sum + ps.submitted_amount, 0);
  const remainingPayableTotal = Math.max(0, totalOriginalObligation - verifiedPaidTotal - pendingPaidTotal);

  const activeSubmissions = await Promise.all(
    rawPaymentHistory
      .filter((ps: any) => ps.status === "Pending Verification")
      .map(async (ps: any) => toCamelCase(await withSignedProofUrl(ps)))
  );
  const recentRejectedRaw = rawPaymentHistory.find((ps: any) => ps.status === "Rejected");
  const recentRejected = recentRejectedRaw ? toCamelCase(await withSignedProofUrl(recentRejectedRaw)) : undefined;
  const paymentHistory = rawPaymentHistory.filter((ps: any) => ps.status === "Paid");

  const enrichedPaymentHistory = await Promise.all(paymentHistory.map(async (h: any) => {
    const signedProofUrl = h.proof_url ? (await withSignedProofUrl(h)).proof_url : null;
    const resolvedObligations = (h.selected_obligations || [])
      .map((txId: string) => {
        const t = transactionsById.get(txId);
        if (!t) return null;
        const cat = categoriesById.get(t.category_id);
        const allocations = (allAllocations ?? []).filter((al: any) => al.transaction_id === t.id);
        const obligationAmount = allocations.reduce((sum: number, al: any) => sum + al.rounded_amount, 0);

        const txItems = itemsByTx.get(t.id) || [];
        const assignedItems = txItems
          .map((it: any) => {
            const itemAlloc = allocations.find((al: any) => al.item_id === it.id);
            if (!itemAlloc) return null;
            const itemAllocations = (allTxAllocationsByTx.get(t.id) || []).filter((al: any) => al.item_id === it.id);
            const itemParticipantIds = Array.from(new Set(itemAllocations.map((al: any) => al.participant_id)));
            const otherItemParticipantIds = itemParticipantIds.filter((pId) => pId !== h.participant_id);
            const allItemParticipantNames = itemParticipantIds.map(nameOf).filter(Boolean);
            const itemSharesWith = otherItemParticipantIds
              .map((pId: any) => {
                const p = participantsById.get(pId);
                return p ? { id: p.id, fullName: p.full_name, nickname: p.nickname || p.full_name } : null;
              })
              .filter(Boolean);
            return {
              id: it.id, name: it.name, quantity: it.quantity, unitPrice: it.unit_price, lineTotal: it.line_total,
              allocatedAmount: itemAlloc.rounded_amount, sharesWith: itemSharesWith, sharedByNames: allItemParticipantNames,
              participantCount: itemParticipantIds.length,
            };
          })
          .filter(Boolean);

        const chargesAllocated = allocations.filter((al: any) => !al.item_id).reduce((sum: number, al: any) => sum + al.rounded_amount, 0);
        const allTxAllocations = allTxAllocationsByTx.get(t.id) || [];
        const otherParticipantIds = Array.from(new Set(allTxAllocations.filter((al: any) => al.participant_id !== h.participant_id).map((al: any) => al.participant_id)));
        const sharesWith = otherParticipantIds
          .map((pId: any) => {
            const p = participantsById.get(pId);
            return p ? { id: p.id, fullName: p.full_name, nickname: p.nickname || p.full_name } : null;
          })
          .filter(Boolean);
        const participantCount = new Set(allTxAllocations.map((al: any) => al.participant_id)).size;

        return {
          transactionId: t.id, title: t.title, merchant: t.merchant, date: t.date,
          categoryName: cat ? cat.name : "Unknown", allocationTotal: obligationAmount, assignedItems,
          chargesAllocated, sharesWith, participantCount, transactionTotal: t.total,
        };
      })
      .filter(Boolean);

    return {
      id: h.id, categoryId: h.category_id, participantId: h.participant_id, methodSnapshot: h.method_snapshot,
      selectedObligations: h.selected_obligations, submittedAmount: h.submitted_amount, proofUrl: signedProofUrl,
      status: h.status, notes: h.notes, rejectionReason: h.rejection_reason, referenceNumber: h.reference_number,
      submissionDate: h.submission_date, verificationDate: h.verification_date, createdAt: h.created_at, updatedAt: h.updated_at,
      resolvedObligations,
    };
  }));

  return {
    status: 200,
    body: {
      participant: {
        id: participant.id,
        fullName: participant.full_name,
        email: participant.email,
        normalizedPhone: participant.normalized_phone,
      },
      category: {
        id: category.id,
        name: (activeCPs ?? []).length > 1 ? "Unified Billing Delegate" : category.name,
        description: (activeCPs ?? []).length > 1 ? "All billing across your registered project containers" : category.description,
        status: category.status,
      },
      outstandingTransactions: outstandingList,
      payableTransactions,
      totals: {
        totalOriginalObligation,
        verifiedPaid: verifiedPaidTotal,
        paid: verifiedPaidTotal,
        pendingVerification: pendingPaidTotal,
        pending: pendingPaidTotal,
        remainingPayable: remainingPayableTotal,
        remaining: remainingPayableTotal,
      },
      paymentMethods,
      requireProof: adminSettings?.require_proof ?? true,
      paymentHistory: enrichedPaymentHistory,
      activeSubmissions,
      recentRejected,
    },
  } as const;
}
