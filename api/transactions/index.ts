import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../lib/supabaseAdmin";
import { requireAdmin } from "../../lib/auth";
import { logActivity } from "../../lib/activity";
import { toCamelCase } from "../../lib/caseConvert";
import { calculateSplits } from "../../lib/splitEngine";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

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

      await logActivity(admin.id, "transaction", transactionId, "created", "admin", { title, total: numTotal });
      return res.status(201).json(toCamelCase(newTransaction));
    } catch (err: any) {
      console.error("Error in POST /api/transactions:", err);
      return res.status(500).json({ error: err?.message || "Gagal menyimpan transaksi karena kesalahan server." });
    }
  }

  res.status(405).json({ error: "Metode tidak diizinkan" });
}
