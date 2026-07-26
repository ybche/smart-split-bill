import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../lib/supabaseAdmin";
import { requireAdmin } from "../../lib/auth";
import { logActivity } from "../../lib/activity";
import { toCamelCase } from "../../lib/caseConvert";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  if (req.method === "GET") {
    const { data, error } = await supabaseAdmin.from("admins").select("*").order("created_at", { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.json(toCamelCase(data));
  }

  if (req.method === "POST") {
    const { email, password, displayName, active } = req.body ?? {};
    if (!email || !password || !displayName) {
      return res.status(400).json({ error: "Username (email), kata sandi, dan nama tampilan wajib diisi." });
    }

    const { data: existing } = await supabaseAdmin.from("admins").select("id").eq("email", email.toLowerCase()).maybeSingle();
    if (existing) {
      return res.status(400).json({ error: "Username sudah digunakan." });
    }

    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: email.toLowerCase(),
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    });
    if (createError) return res.status(400).json({ error: createError.message });

    if (active === false) {
      await supabaseAdmin.from("admins").update({ active: false }).eq("id", created.user.id);
    }

    const { data: adminRow, error: fetchError } = await supabaseAdmin
      .from("admins")
      .select("*")
      .eq("id", created.user.id)
      .maybeSingle();
    if (fetchError || !adminRow) return res.status(500).json({ error: "Admin berhasil dibuat tapi data profil tidak ditemukan." });

    await logActivity(admin.id, "admin", adminRow.id, "created", "admin", { name: displayName });
    return res.status(201).json(toCamelCase(adminRow));
  }

  res.status(405).json({ error: "Metode tidak diizinkan" });
}
