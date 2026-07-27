import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../lib/supabaseAdmin.js";
import { requireAdmin } from "../../lib/auth.js";
import { logActivity } from "../../lib/activity.js";
import { toCamelCase } from "../../lib/caseConvert.js";
import { calculateSplits } from "../../lib/splitEngine.js";
import { syncCategoryParticipants } from "../../lib/categoryParticipantSync.js";
import { createAwaitingInputRows, approveFreeInput, rejectFreeInput } from "../../lib/freeInputAllocations.js";
import { getSlug } from "../../lib/routeSlug.js";

// Consolidates every /api/transactions/* route into a single serverless
// function (Vercel Hobby caps a deployment at 12 functions) via an optional
// catch-all segment:
//   []                          -> GET / POST
//   ["declarations"]            -> GET (global pending free-input declarations)
//   [id]                        -> PUT / DELETE
//   [id, "allocations"]         -> GET
//   [id, "free-input", allocId] -> POST (approve/reject a declaration)
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const slug = getSlug(req);

  if (slug.length === 0) {
    if (req.method === "GET") {
      const { data, error } = await supabaseAdmin.from("transactions").select("*").order("created_at", { ascending: false });
      if (error) return res.status(500).json({ error: error.message });
      return res.json(toCamelCase(data));
    }

    if (req.method === "POST") {
      try {
        const {
          categoryId, title, merchant, date, payerId,
          subtotal, tax, serviceCharge, discount, otherFees, total,
          expenseClassification, items, description, notes, status, inputMethod,
          freeInputParticipantIds,
        } = req.body ?? {};

        if (!categoryId || !title || !payerId || subtotal === undefined || total === undefined) {
          return res.status(400).json({ error: "Field wajib belum lengkap: categoryId, title, payerId, subtotal, dan total." });
        }

        const numSubtotal = Number(subtotal || 0);
        const numTax = Number(tax || 0);
        const numServiceCharge = Number(serviceCharge || 0);
        const numDiscount = Number(discount || 0);
        const numOtherFees = Number(otherFees || 0);
        const numTotal = Number(total || 0);

        const calculatedTotal = numSubtotal + numTax + numServiceCharge + numOtherFees - numDiscount;
        if (Math.abs(calculatedTotal - numTotal) > 5) {
          return res.status(400).json({ error: `Total transaksi (${numTotal}) tidak sesuai dengan jumlah subtotal dan biaya (${calculatedTotal}).` });
        }

        const { data: newTransaction, error: txError } = await supabaseAdmin
          .from("transactions")
          .insert({
            category_id: categoryId,
            title,
            merchant: merchant || title,
            date: date || new Date().toISOString().split("T")[0],
            payer_id: payerId,
            input_method: inputMethod || "manual",
            subtotal: numSubtotal,
            tax: numTax,
            service_charge: numServiceCharge,
            discount: numDiscount,
            other_fees: numOtherFees,
            total: numTotal,
            status: status || "Confirmed",
            expense_classification: expenseClassification || "Other",
            description: description || "",
            notes: notes || "",
          })
          .select()
          .single();
        if (txError) return res.status(500).json({ error: txError.message });

        const transactionId = newTransaction.id;
        const safeItems = Array.isArray(items) ? items : [];

        const itemRows = safeItems.map((it: any, index: number) => ({
          transaction_id: transactionId,
          name: it.name || `Item #${index + 1}`,
          quantity: Number(it.quantity || 1),
          unit_price: Number(it.unitPrice || it.lineTotal || 0),
          line_total: Number(it.lineTotal || 0),
          classification: it.classification || expenseClassification || "Other",
          sort_order: index,
        }));

        let insertedItems: any[] = [];
        if (itemRows.length > 0) {
          const { data, error } = await supabaseAdmin.from("transaction_items").insert(itemRows).select();
          if (error) return res.status(500).json({ error: error.message });
          insertedItems = data;
        }

        const engineItems = insertedItems.map((row, index) => ({
          id: row.id,
          price: row.unit_price,
          quantity: row.quantity,
          splitMethod: safeItems[index]?.splitMethod || "Equal",
          itemAllocations: Array.isArray(safeItems[index]?.itemAllocations) ? safeItems[index].itemAllocations : [],
        }));

        const calcResult = calculateSplits(numSubtotal, numTax, numServiceCharge, numDiscount, numOtherFees, engineItems);

        const allocationRows: any[] = [];
        calcResult.itemsObligations.forEach((io) => {
          const matchedItem = engineItems.find((ei) => ei.id === io.itemId);
          const matchedAlloc = matchedItem?.itemAllocations.find((al: any) => al?.participantId === io.participantId);
          allocationRows.push({
            transaction_id: transactionId,
            item_id: io.itemId,
            participant_id: io.participantId,
            method: matchedItem ? matchedItem.splitMethod : "Equal",
            inputs: matchedAlloc ? Number(matchedAlloc.weight || 0) : 0,
            raw_amount: io.amount,
            rounded_amount: io.amount,
          });
        });
        calcResult.chargesObligations.forEach((co) => {
          allocationRows.push({
            transaction_id: transactionId,
            charge_type: co.chargeType,
            participant_id: co.participantId,
            method: "Percentage",
            raw_amount: co.amount,
            rounded_amount: co.amount,
          });
        });

        if (allocationRows.length > 0) {
          const { error } = await supabaseAdmin.from("allocations").insert(allocationRows);
          if (error) return res.status(500).json({ error: error.message });
        }

        if (Array.isArray(freeInputParticipantIds) && freeInputParticipantIds.length > 0) {
          await createAwaitingInputRows(transactionId, freeInputParticipantIds);
        }

        await syncCategoryParticipants(categoryId);
        await logActivity(admin.id, "transaction", transactionId, "created", "admin", { title, total: numTotal });
        return res.status(201).json(toCamelCase(newTransaction));
      } catch (err: any) {
        console.error("Error in POST /api/transactions:", err);
        return res.status(500).json({ error: err?.message || "Gagal menyimpan transaksi karena kesalahan server." });
      }
    }

    return res.status(405).json({ error: "Metode tidak diizinkan" });
  }

  if (slug.length === 1 && slug[0] === "declarations") {
    if (req.method !== "GET") return res.status(405).json({ error: "Metode tidak diizinkan" });

    const { data, error } = await supabaseAdmin
      .from("allocations")
      .select("id, transaction_id, rounded_amount, participants(full_name, nickname), transactions(title, date, categories(name))")
      .eq("method", "FreeInput")
      .eq("status", "Pending");
    if (error) return res.status(500).json({ error: error.message });

    const declarations = (data ?? []).map((row: any) => ({
      id: row.id,
      transactionId: row.transaction_id,
      participantName: row.participants?.nickname || row.participants?.full_name || "Unknown",
      transactionTitle: row.transactions?.title || "Unknown",
      transactionDate: row.transactions?.date,
      categoryName: row.transactions?.categories?.name || "Unknown",
      declaredAmount: row.rounded_amount,
    }));

    return res.json(declarations);
  }

  const id = slug[0];

  if (slug.length === 1) {
    if (req.method === "PUT") {
      try {
        const {
          title, merchant, date, payerId,
          subtotal, tax, serviceCharge, discount, otherFees, total,
          expenseClassification, items, description, notes, status,
          freeInputParticipantIds,
        } = req.body ?? {};

        const { data: existing, error: fetchError } = await supabaseAdmin
          .from("transactions")
          .select("*")
          .eq("id", id)
          .maybeSingle();
        if (fetchError) return res.status(500).json({ error: fetchError.message });
        if (!existing) return res.status(404).json({ error: "Transaksi tidak ditemukan." });

        const numSubtotal = subtotal !== undefined ? Number(subtotal || 0) : existing.subtotal;
        const numTax = tax !== undefined ? Number(tax || 0) : existing.tax;
        const numServiceCharge = serviceCharge !== undefined ? Number(serviceCharge || 0) : existing.service_charge;
        const numDiscount = discount !== undefined ? Number(discount || 0) : existing.discount;
        const numOtherFees = otherFees !== undefined ? Number(otherFees || 0) : existing.other_fees;
        const numTotal = total !== undefined ? Number(total || 0) : existing.total;

        const { data: updated, error: updateError } = await supabaseAdmin
          .from("transactions")
          .update({
            title: title || existing.title,
            merchant: merchant !== undefined ? merchant : existing.merchant,
            date: date || existing.date,
            payer_id: payerId || existing.payer_id,
            subtotal: numSubtotal,
            tax: numTax,
            service_charge: numServiceCharge,
            discount: numDiscount,
            other_fees: numOtherFees,
            total: numTotal,
            status: status || existing.status,
            expense_classification: expenseClassification || existing.expense_classification,
            description: description !== undefined ? description : existing.description,
            notes: notes !== undefined ? notes : existing.notes,
          })
          .eq("id", id)
          .select()
          .single();
        if (updateError) return res.status(500).json({ error: updateError.message });

        // Full replace of items + split-engine allocations for this
        // transaction. FreeInput rows are excluded — a participant's
        // declaration (awaiting, pending, approved, or rejected) must survive
        // the admin editing unrelated parts of the transaction.
        await supabaseAdmin.from("allocations").delete().eq("transaction_id", id).neq("method", "FreeInput");
        await supabaseAdmin.from("transaction_items").delete().eq("transaction_id", id);

        const safeItems = Array.isArray(items) ? items : [];
        const itemRows = safeItems.map((it: any, index: number) => ({
          transaction_id: id,
          name: it.name || `Item #${index + 1}`,
          quantity: Number(it.quantity || 1),
          unit_price: Number(it.unitPrice || it.lineTotal || 0),
          line_total: Number(it.lineTotal || 0),
          classification: it.classification || expenseClassification || "Other",
          sort_order: index,
        }));

        let insertedItems: any[] = [];
        if (itemRows.length > 0) {
          const { data, error } = await supabaseAdmin.from("transaction_items").insert(itemRows).select();
          if (error) return res.status(500).json({ error: error.message });
          insertedItems = data;
        }

        const engineItems = insertedItems.map((row, index) => ({
          id: row.id,
          price: row.unit_price,
          quantity: row.quantity,
          splitMethod: safeItems[index]?.splitMethod || "Equal",
          itemAllocations: Array.isArray(safeItems[index]?.itemAllocations) ? safeItems[index].itemAllocations : [],
        }));

        const calcResult = calculateSplits(numSubtotal, numTax, numServiceCharge, numDiscount, numOtherFees, engineItems);

        const allocationRows: any[] = [];
        calcResult.itemsObligations.forEach((io) => {
          const matchedItem = engineItems.find((ei) => ei.id === io.itemId);
          const matchedAlloc = matchedItem?.itemAllocations.find((al: any) => al?.participantId === io.participantId);
          allocationRows.push({
            transaction_id: id,
            item_id: io.itemId,
            participant_id: io.participantId,
            method: matchedItem ? matchedItem.splitMethod : "Equal",
            inputs: matchedAlloc ? Number(matchedAlloc.weight || 0) : 0,
            raw_amount: io.amount,
            rounded_amount: io.amount,
          });
        });
        calcResult.chargesObligations.forEach((co) => {
          allocationRows.push({
            transaction_id: id,
            charge_type: co.chargeType,
            participant_id: co.participantId,
            method: "Percentage",
            raw_amount: co.amount,
            rounded_amount: co.amount,
          });
        });

        if (allocationRows.length > 0) {
          const { error } = await supabaseAdmin.from("allocations").insert(allocationRows);
          if (error) return res.status(500).json({ error: error.message });
        }

        const freeInputIds = Array.isArray(freeInputParticipantIds) ? freeInputParticipantIds : [];
        if (freeInputIds.length > 0) {
          await createAwaitingInputRows(id, freeInputIds);
        }
        // A participant removed from the free-input list only has their row
        // dropped if it's still untouched (AwaitingInput) — once they've
        // declared something (Pending/Approved/Rejected) it must not vanish
        // just because admin unchecked them here.
        await supabaseAdmin
          .from("allocations")
          .delete()
          .eq("transaction_id", id)
          .eq("method", "FreeInput")
          .eq("status", "AwaitingInput")
          .not("participant_id", "in", `(${(freeInputIds.length ? freeInputIds : ["00000000-0000-0000-0000-000000000000"]).join(",")})`);

        await syncCategoryParticipants(existing.category_id);
        await logActivity(admin.id, "transaction", id, "updated", "admin", { title: updated.title, total: updated.total });
        return res.json(toCamelCase(updated));
      } catch (err: any) {
        console.error("Error in PUT /api/transactions/:id:", err);
        return res.status(500).json({ error: err?.message || "Gagal memperbarui transaksi karena kesalahan server." });
      }
    }

    if (req.method === "DELETE") {
      const force = req.query.force === "true";

      const { data: existing, error: fetchError } = await supabaseAdmin
        .from("transactions")
        .select("id, category_id")
        .eq("id", id)
        .maybeSingle();
      if (fetchError) return res.status(500).json({ error: fetchError.message });
      if (!existing) return res.status(404).json({ error: "Transaksi tidak ditemukan." });

      const { data: paidSubs, error: subsError } = await supabaseAdmin
        .from("payment_submissions")
        .select("id, selected_obligations")
        .eq("status", "Paid")
        .contains("selected_obligations", [id]);
      if (subsError) return res.status(500).json({ error: subsError.message });

      if (paidSubs.length > 0 && !force) {
        return res.status(400).json({
          error: "Tidak dapat menghapus transaksi. Ada catatan pembayaran terverifikasi yang mereferensikan transaksi ini.",
          canForce: true,
        });
      }

      if (force) {
        for (const sub of paidSubs) {
          const remaining = (sub.selected_obligations as string[]).filter((oId) => oId !== id);
          if (remaining.length === 0) {
            await supabaseAdmin.from("payment_submissions").delete().eq("id", sub.id);
          } else {
            await supabaseAdmin.from("payment_submissions").update({ selected_obligations: remaining }).eq("id", sub.id);
          }
        }
      }

      // transaction_items and allocations cascade-delete via FK on transactions.id
      const { error: deleteError } = await supabaseAdmin.from("transactions").delete().eq("id", id);
      if (deleteError) return res.status(500).json({ error: deleteError.message });

      await syncCategoryParticipants(existing.category_id);
      await logActivity(admin.id, "transaction", id, "deleted", "admin");
      return res.json({ success: true });
    }

    return res.status(405).json({ error: "Metode tidak diizinkan" });
  }

  if (slug.length === 2 && slug[1] === "allocations") {
    if (req.method !== "GET") return res.status(405).json({ error: "Metode tidak diizinkan" });

    const [{ data: items, error: itemsError }, { data: allocations, error: allocError }] = await Promise.all([
      supabaseAdmin.from("transaction_items").select("*").eq("transaction_id", id).order("sort_order", { ascending: true }),
      supabaseAdmin.from("allocations").select("*").eq("transaction_id", id),
    ]);
    if (itemsError) return res.status(500).json({ error: itemsError.message });
    if (allocError) return res.status(500).json({ error: allocError.message });

    // The edit form (Transactions.tsx) reconstructs each item's checked
    // participants from item.allocations, so allocations must be nested per
    // item, not returned as a separate flat array.
    const itemsWithAllocations = (items ?? []).map((item: any) => ({
      ...toCamelCase(item),
      allocations: toCamelCase((allocations ?? []).filter((al: any) => al.item_id === item.id)),
    }));

    const chargeAllocations = toCamelCase((allocations ?? []).filter((al: any) => !al.item_id && al.method !== "FreeInput"));
    const freeInputAllocations = toCamelCase((allocations ?? []).filter((al: any) => al.method === "FreeInput"));

    return res.json({ items: itemsWithAllocations, allocations: chargeAllocations, freeInputAllocations });
  }

  if (slug.length === 3 && slug[1] === "free-input") {
    if (req.method !== "POST") return res.status(405).json({ error: "Metode tidak diizinkan" });

    const allocationId = slug[2];
    const { action, rejectionReason } = req.body ?? {};

    try {
      if (action === "approve") {
        await approveFreeInput(allocationId);
        await logActivity(admin.id, "transaction", id, "free_input_approved", "admin", { allocationId });
        return res.json({ success: true });
      }
      if (action === "reject") {
        const reason = rejectionReason || "Nominal tidak sesuai atau tidak dapat diverifikasi.";
        await rejectFreeInput(allocationId, reason);
        await logActivity(admin.id, "transaction", id, "free_input_rejected", "admin", { allocationId, reason });
        return res.json({ success: true });
      }
      return res.status(400).json({ error: "Aksi tidak valid. Harus 'approve' atau 'reject'." });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "Gagal memproses deklarasi." });
    }
  }

  res.status(404).json({ error: "Rute tidak ditemukan." });
}
