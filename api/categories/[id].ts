import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../lib/supabaseAdmin";
import { requireAdmin } from "../../lib/auth";
import { logActivity } from "../../lib/activity";
import { toCamelCase } from "../../lib/caseConvert";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const id = req.query.id as string;

  if (req.method === "PUT") {
    const { name, description, startDate, endDate, status, notes } = req.body ?? {};

    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("categories")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (fetchError) return res.status(500).json({ error: fetchError.message });
    if (!existing) return res.status(404).json({ error: "Kategori tidak ditemukan." });

    const { data, error } = await supabaseAdmin
      .from("categories")
      .update({
        name: name !== undefined ? name : existing.name,
        description: description !== undefined ? description : existing.description,
        start_date: startDate !== undefined ? startDate : existing.start_date,
        end_date: endDate !== undefined ? endDate : existing.end_date,
        status: status !== undefined ? status : existing.status,
        notes: notes !== undefined ? notes : existing.notes,
      })
      .eq("id", id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });

    await logActivity(admin.id, "category", id, "updated", "admin", { name });
    return res.json(toCamelCase(data));
  }

  if (req.method === "DELETE") {
    const force = req.query.force === "true";

    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("categories")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (fetchError) return res.status(500).json({ error: fetchError.message });
    if (!existing) return res.status(404).json({ error: "Kategori tidak ditemukan." });

    const { count, error: countError } = await supabaseAdmin
      .from("payment_submissions")
      .select("id", { count: "exact", head: true })
      .eq("category_id", id)
      .eq("status", "Paid");
    if (countError) return res.status(500).json({ error: countError.message });

    if ((count ?? 0) > 0 && !force) {
      return res.status(400).json({ error: "Tidak dapat menghapus kategori yang memiliki pembayaran terverifikasi.", canForce: true });
    }

    // category_participants, transactions (and transitively transaction_items/allocations),
    // and payment_submissions (and transitively payment_allocations) all cascade-delete via FK.
    const { error: deleteError } = await supabaseAdmin.from("categories").delete().eq("id", id);
    if (deleteError) return res.status(500).json({ error: deleteError.message });

    await logActivity(admin.id, "category", id, "deleted", "admin");
    return res.json({ success: true });
  }

  res.status(405).json({ error: "Metode tidak diizinkan" });
}
