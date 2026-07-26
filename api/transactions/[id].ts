import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../lib/supabaseAdmin";
import { requireAdmin } from "../../lib/auth";
import { logActivity } from "../../lib/activity";
import { toCamelCase } from "../../lib/caseConvert";
import { calculateSplits } from "../../lib/splitEngine";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const id = req.query.id as string;

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

      // Full replace of items + allocations for this transaction.
      await supabaseAdmin.from("allocations").delete().eq("transaction_id", id);
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
      .select("id")
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

    await logActivity(admin.id, "transaction", id, "deleted", "admin");
    return res.json({ success: true });
  }

  res.status(405).json({ error: "Metode tidak diizinkan" });
}
