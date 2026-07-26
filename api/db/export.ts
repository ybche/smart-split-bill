import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../lib/supabaseAdmin";
import { requireAdmin } from "../../lib/auth";
import { toCamelCase } from "../../lib/caseConvert";

const TABLES = [
  "categories",
  "participants",
  "payment_methods",
  "category_participants",
  "transactions",
  "transaction_items",
  "allocations",
  "payment_submissions",
  "payment_allocations",
  "activities",
  "message_actions",
] as const;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== "GET") return res.status(405).json({ error: "Metode tidak diizinkan" });

  const backup: Record<string, any> = {};

  for (const table of TABLES) {
    const { data, error } = await supabaseAdmin.from(table).select("*");
    if (error) return res.status(500).json({ error: `Gagal mengekspor tabel ${table}: ${error.message}` });
    backup[toCamelCaseKey(table)] = toCamelCase(data ?? []);
  }

  res.setHeader("Content-Disposition", `attachment; filename=smart_split_bill_db_backup_${new Date().toISOString().split("T")[0]}.json`);
  res.setHeader("Content-Type", "application/json");
  res.send(JSON.stringify(backup, null, 2));
}

function toCamelCaseKey(snake: string): string {
  return snake.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}
