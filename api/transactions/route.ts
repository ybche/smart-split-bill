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
//   [id]                        -> PUT / DELETE
//   [id, "allocations"]         -> GET
//   [id, "free-input", allocId] -> POST (approve/reject a participant's item declaration)
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const slug = getSlug(req);

  if (slug.length === 0) {
    if (req.method === "GET") {
      const [{ data, error }, { data: pendingAllocs }] = await Promise.all([
        supabaseAdmin.from("transactions").select("*").order("created_at", { ascending: false }),
        supabaseAdmin.from("allocations").select("transaction_id").eq("method", "FreeInput").eq("status", "Pending"),
      ]);
      if (error) return res.status(500).json({ error: error.message });

      // Lets the Transactions list surface which rows have a participant
      // declaration awaiting review, without a separate admin page.
      const pendingCountByTx = new Map<string, number>();
      (pendingAllocs ?? []).forEach((a: any) => {
        pendingCountByTx.set(a.transaction_id, (pendingCountByTx.get(a.transaction_id) || 0) + 1);
      });

      const enriched = (data ?? []).map((t: any) => ({
        ...toCamelCase(t),
        pendingFreeInputCount: pendingCountByTx.get(t.id) || 0,
      }));
      return res.json(enriched);
    }

    if (req.method === "POST") {
      try {
        const {
          categoryId, title, merchant, date, payerId,
          subtotal, tax, serviceCharge, discount, otherFees, total,
          expenseClassification, items, description, notes, status, inputMethod,
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

        // Items carry a client-generated id (crypto.randomUUID()) even when
        // brand new, so it doubles as the real primary key here — this lets
        // free-input allocations reference a stable item_id from creation.
        const insertedItems = await upsertTransactionItems(transactionId, safeItems, expenseClassification);
        const insertedById = new Map(insertedItems.map((row: any) => [row.id, row]));

        const fixedItems = safeItems.filter((it: any) => it.splitMethod !== "FreeInput");
        const engineItems = fixedItems
          .map((it: any) => {
            const row = insertedById.get(it.id);
            if (!row) return null;
            return {
              id: row.id,
              price: row.unit_price,
              quantity: row.quantity,
              splitMethod: it.splitMethod || "Equal",
              itemAllocations: Array.isArray(it.itemAllocations) ? it.itemAllocations : [],
            };
          })
          .filter(Boolean) as any[];

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

        await reconcileFreeInputItems(transactionId, safeItems, insertedById);

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

  const id = slug[0];

  if (slug.length === 1) {
    if (req.method === "PUT") {
      try {
        const {
          title, merchant, date, payerId,
          subtotal, tax, serviceCharge, discount, otherFees, total,
          expenseClassification, items, description, notes, status,
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

        const safeItems = Array.isArray(items) ? items : [];

        // Items are upserted by id (not wholesale deleted+reinserted): an item
        // the admin didn't touch keeps its real id, so any free-input
        // declaration tied to it (via allocations.item_id, which cascades on
        // delete) survives editing unrelated parts of the transaction. Items
        // genuinely removed from the form are deleted, which correctly also
        // drops any declarations that belonged only to them.
        const { data: existingItemRows } = await supabaseAdmin.from("transaction_items").select("id").eq("transaction_id", id);
        const existingItemIds = new Set((existingItemRows ?? []).map((r: any) => r.id));
        const incomingIds = new Set(safeItems.map((it: any) => it.id));
        const idsToDelete = Array.from(existingItemIds).filter((itemId) => !incomingIds.has(itemId));
        if (idsToDelete.length > 0) {
          await supabaseAdmin.from("transaction_items").delete().in("id", idsToDelete);
        }

        // Split-engine allocations are always fully recomputed below.
        // FreeInput rows are never touched here regardless of status.
        await supabaseAdmin.from("allocations").delete().eq("transaction_id", id).neq("method", "FreeInput");

        const insertedItems = await upsertTransactionItems(id, safeItems, expenseClassification);
        const insertedById = new Map(insertedItems.map((row: any) => [row.id, row]));

        const fixedItems = safeItems.filter((it: any) => it.splitMethod !== "FreeInput");
        const engineItems = fixedItems
          .map((it: any) => {
            const row = insertedById.get(it.id);
            if (!row) return null;
            return {
              id: row.id,
              price: row.unit_price,
              quantity: row.quantity,
              splitMethod: it.splitMethod || "Equal",
              itemAllocations: Array.isArray(it.itemAllocations) ? it.itemAllocations : [],
            };
          })
          .filter(Boolean) as any[];

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

        await reconcileFreeInputItems(id, safeItems, insertedById);

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
    // participants (and any free-input declarations) from item.allocations,
    // so allocations must be nested per item, not returned as a flat array.
    const itemsWithAllocations = (items ?? []).map((item: any) => ({
      ...toCamelCase(item),
      allocations: toCamelCase((allocations ?? []).filter((al: any) => al.item_id === item.id)),
    }));

    const chargeAllocations = toCamelCase((allocations ?? []).filter((al: any) => !al.item_id));

    return res.json({ items: itemsWithAllocations, allocations: chargeAllocations });
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

// Inserts new items / updates existing ones in place (matched by the
// client-generated id every item already carries), so item ids stay stable
// across edits — required for free-input allocations to survive them.
async function upsertTransactionItems(transactionId: string, safeItems: any[], expenseClassification: string): Promise<any[]> {
  if (safeItems.length === 0) return [];

  const itemRows = safeItems.map((it: any, index: number) => ({
    id: it.id,
    transaction_id: transactionId,
    name: it.name || `Item #${index + 1}`,
    quantity: Number(it.quantity || 1),
    unit_price: it.splitMethod === "FreeInput" ? 0 : Number(it.unitPrice || it.lineTotal || 0),
    line_total: it.splitMethod === "FreeInput" ? 0 : Number(it.lineTotal || 0),
    classification: it.classification || expenseClassification || "Other",
    sort_order: index,
  }));

  const { data, error } = await supabaseAdmin.from("transaction_items").upsert(itemRows, { onConflict: "id" }).select();
  if (error) throw new Error(error.message);
  return data ?? [];
}

// For each item marked "FreeInput", makes sure exactly the currently-checked
// participants have an allocation row for it: creates AwaitingInput rows for
// newly-added participants, and drops rows for removed ones -- but only if
// still untouched (AwaitingInput). A participant who already declared
// (Pending/Approved/Rejected) never has their row silently removed here.
async function reconcileFreeInputItems(transactionId: string, safeItems: any[], insertedById: Map<string, any>): Promise<void> {
  const freeInputItems = safeItems.filter((it: any) => it.splitMethod === "FreeInput");

  for (const it of freeInputItems) {
    const row = insertedById.get(it.id);
    if (!row) continue;

    const participantIds = (Array.isArray(it.itemAllocations) ? it.itemAllocations : [])
      .filter((al: any) => al.weight > 0)
      .map((al: any) => al.participantId);

    await createAwaitingInputRows(transactionId, row.id, participantIds);

    await supabaseAdmin
      .from("allocations")
      .delete()
      .eq("transaction_id", transactionId)
      .eq("item_id", row.id)
      .eq("method", "FreeInput")
      .eq("status", "AwaitingInput")
      .not("participant_id", "in", `(${(participantIds.length ? participantIds : ["00000000-0000-0000-0000-000000000000"]).join(",")})`);
  }
}
