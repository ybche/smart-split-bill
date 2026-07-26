import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../lib/supabaseAdmin";
import { logActivity } from "../../lib/activity";
import { mapAdminRow } from "../../lib/auth";

// Replaces the old self-disabling /api/auth/signup: creates the very first
// admin account. Only works while the admins table is empty — same
// self-disabling behavior as before, now backed by Supabase Auth instead of
// a local SHA-256 password hash. Subsequent admins are created via the
// authenticated POST /api/admins route.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Metode tidak diizinkan" });

  const { email, password, displayName } = req.body ?? {};
  if (!email || !password || !displayName) {
    return res.status(400).json({ error: "Username (email), kata sandi, dan nama tampilan wajib diisi." });
  }

  const { count, error: countError } = await supabaseAdmin.from("admins").select("id", { count: "exact", head: true });
  if (countError) return res.status(500).json({ error: countError.message });
  if ((count ?? 0) > 0) {
    return res.status(400).json({ error: "Setup sudah pernah diselesaikan." });
  }

  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email: email.toLowerCase(),
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  });
  if (createError) return res.status(400).json({ error: createError.message });

  // The on_auth_user_created trigger inserts the admins profile row; wait for it.
  const { data: adminRow, error: adminError } = await supabaseAdmin
    .from("admins")
    .select("*")
    .eq("id", created.user.id)
    .maybeSingle();
  if (adminError || !adminRow) {
    return res.status(500).json({ error: "Admin berhasil dibuat tapi data profil tidak ditemukan." });
  }

  await logActivity(adminRow.id, "admin", adminRow.id, "created", "admin", { name: displayName });
  res.status(201).json(mapAdminRow(adminRow, created.user.email ?? undefined));
}
