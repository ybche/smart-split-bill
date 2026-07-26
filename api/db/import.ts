import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../lib/supabaseAdmin";
import { requireAdmin } from "../../lib/auth";
import { logActivity } from "../../lib/activity";
import { toSnakeCase } from "../../lib/caseConvert";

// Table order matters: delete children before parents, insert parents before children.
// "admins" is intentionally never touched here — admin rows are tied 1:1 to
// Supabase Auth users via a trigger, so wiping/reinserting them from a JSON
// backup would desync them from auth.users (and could lock out the caller).
const TABLES_DELETE_ORDER = [
  "message_actions",
  "activities",
  "payment_allocations",
  "payment_submissions",
  "allocations",
  "transaction_items",
  "transactions",
  "category_participants",
  "payment_methods",
  "participants",
  "categories",
] as const;

const TABLES_INSERT_ORDER = [...TABLES_DELETE_ORDER].reverse();

const CAMEL_TO_TABLE: Record<string, string> = {
  categories: "categories",
  participants: "participants",
  paymentMethods: "payment_methods",
  categoryParticipants: "category_participants",
  transactions: "transactions",
  transactionItems: "transaction_items",
  allocations: "allocations",
  paymentSubmissions: "payment_submissions",
  paymentAllocations: "payment_allocations",
  activities: "activities",
  messageActions: "message_actions",
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Metode tidak diizinkan" });

  const backup = req.body;
  if (!backup || typeof backup !== "object") {
    return res.status(400).json({ error: "Struktur file cadangan tidak valid." });
  }

  const rowsByTable: Record<string, any[]> = {};
  for (const [camelKey, tableName] of Object.entries(CAMEL_TO_TABLE)) {
    const rows = backup[camelKey];
    if (rows !== undefined && !Array.isArray(rows)) {
      return res.status(400).json({ error: `Field "${camelKey}" harus berupa array.` });
    }
    rowsByTable[tableName] = Array.isArray(rows) ? toSnakeCase(rows) : [];
  }

  for (const table of TABLES_DELETE_ORDER) {
    const { error } = await supabaseAdmin.from(table).delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) return res.status(500).json({ error: `Gagal menghapus data lama dari ${table}: ${error.message}` });
  }

  for (const table of TABLES_INSERT_ORDER) {
    const rows = rowsByTable[table];
    if (rows.length === 0) continue;
    const { error } = await supabaseAdmin.from(table).insert(rows);
    if (error) return res.status(500).json({ error: `Gagal memulihkan data ke ${table}: ${error.message}` });
  }

  await logActivity(admin.id, "database", "root", "restored", "admin");
  res.json({ success: true, message: "Database berhasil dipulihkan dari cadangan." });
}
