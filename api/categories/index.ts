import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../lib/supabaseAdmin";
import { requireAdmin } from "../../lib/auth";
import { logActivity } from "../../lib/activity";
import { toCamelCase } from "../../lib/caseConvert";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  if (req.method === "GET") {
    const { data, error } = await supabaseAdmin.from("categories").select("*").order("created_at", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.json(toCamelCase(data));
  }

  if (req.method === "POST") {
    const { name, description, startDate, endDate, notes } = req.body ?? {};
    if (!name) {
      return res.status(400).json({ error: "Nama kategori wajib diisi." });
    }

    const { data, error } = await supabaseAdmin
      .from("categories")
      .insert({
        name,
        description: description || "",
        start_date: startDate || null,
        end_date: endDate || null,
        notes: notes ?? null,
        status: "Draft",
      })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });

    await logActivity(admin.id, "category", data.id, "created", "admin", { name });
    return res.status(201).json(toCamelCase(data));
  }

  res.status(405).json({ error: "Metode tidak diizinkan" });
}
