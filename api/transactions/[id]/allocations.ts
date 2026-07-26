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

  // The edit form (Transactions.tsx) reconstructs each item's checked
  // participants from item.allocations, so allocations must be nested per
  // item, not returned as a separate flat array.
  const itemsWithAllocations = (items ?? []).map((item: any) => ({
    ...toCamelCase(item),
    allocations: toCamelCase((allocations ?? []).filter((al: any) => al.item_id === item.id)),
  }));

  const chargeAllocations = toCamelCase((allocations ?? []).filter((al: any) => !al.item_id));

  res.json({ items: itemsWithAllocations, allocations: chargeAllocations });
}
