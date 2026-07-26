import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";
import { requireAdmin } from "../../../lib/auth";
import { toCamelCase } from "../../../lib/caseConvert";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== "GET") return res.status(405).json({ error: "Metode tidak diizinkan" });

  const id = req.query.id as string;

  const [{ data: items, error: itemsError }, { data: allocations, error: allocError }] = await Promise.all([
    supabaseAdmin.from("transaction_items").select("*").eq("transaction_id", id).order("sort_order", { ascending: true }),
    supabaseAdmin.from("allocations").select("*").eq("transaction_id", id),
  ]);
  if (itemsError) return res.status(500).json({ error: itemsError.message });
  if (allocError) return res.status(500).json({ error: allocError.message });

  res.json({ items: toCamelCase(items), allocations: toCamelCase(allocations) });
}
