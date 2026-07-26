import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "./supabaseAdmin.js";

export interface AdminSettings {
  currency: string;
  locale: string;
  timezone: string;
  requireProof: boolean;
  roundingPolicy: string;
  introductionTemplate: string;
  reminderTemplate: string;
}

export interface AdminProfile {
  id: string;
  email: string;
  displayName: string | null;
  active: boolean;
  lastLogin: string | null;
  settings: AdminSettings;
  createdAt: string;
  updatedAt: string;
}

// Frontend components (Categories.tsx, Settings.tsx) read admin.settings.* —
// keep that nested shape rather than flattening it, to match types.ts's
// original AdminSettings contract.
export function mapAdminRow(row: any, email?: string): AdminProfile {
  return {
    id: row.id,
    email: row.email || email || "",
    displayName: row.display_name,
    active: row.active,
    lastLogin: row.last_login,
    settings: {
      currency: row.currency,
      locale: row.locale,
      timezone: row.timezone,
      requireProof: row.require_proof,
      roundingPolicy: row.rounding_policy,
      introductionTemplate: row.introduction_template,
      reminderTemplate: row.reminder_template,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Verifies the Supabase Auth JWT in the Authorization header and confirms the
// caller has a corresponding row in the admins table. Sends a 401 response
// and returns null if verification fails, so callers can just `if (!admin) return;`.
export async function requireAdmin(
  req: VercelRequest,
  res: VercelResponse
): Promise<AdminProfile | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Akses ditolak. Autentikasi admin diperlukan." });
    return null;
  }
  const token = authHeader.substring(7);

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData?.user) {
    res.status(401).json({ error: "Sesi tidak valid atau sudah kedaluwarsa. Silakan masuk kembali." });
    return null;
  }

  const { data: adminRow, error: adminError } = await supabaseAdmin
    .from("admins")
    .select("*")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (adminError || !adminRow) {
    res.status(401).json({ error: "Akses ditolak. Autentikasi admin diperlukan." });
    return null;
  }
  if (!adminRow.active) {
    res.status(401).json({ error: "Akun administrator ini telah dinonaktifkan." });
    return null;
  }

  return mapAdminRow(adminRow, userData.user.email ?? "");
}
