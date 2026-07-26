import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../lib/supabaseAdmin";
import { requireAdmin } from "../../lib/auth";
import { logActivity } from "../../lib/activity";
import { toCamelCase } from "../../lib/caseConvert";

// Consolidates every /api/admins/* route into a single serverless function
// (Vercel Hobby caps a deployment at 12 functions) via an optional catch-all
// segment:
//   []   -> GET / POST
//   [id] -> PUT / DELETE
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const slug = ([] as string[]).concat((req.query.slug as string | string[] | undefined) || []);

  if (slug.length === 0) {
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

    return res.status(405).json({ error: "Metode tidak diizinkan" });
  }

  const id = slug[0];

  if (slug.length === 1) {
    if (req.method === "PUT") {
      const { email, password, displayName, active } = req.body ?? {};

      const { data: existing, error: fetchError } = await supabaseAdmin.from("admins").select("*").eq("id", id).maybeSingle();
      if (fetchError) return res.status(500).json({ error: fetchError.message });
      if (!existing) return res.status(404).json({ error: "Administrator tidak ditemukan." });

      if (active === false) {
        const { count } = await supabaseAdmin.from("admins").select("id", { count: "exact", head: true }).eq("active", true);
        if ((count ?? 0) <= 1 && existing.active) {
          return res.status(400).json({ error: "Tidak dapat menonaktifkan akun Administrator aktif terakhir." });
        }
      }

      if (email && email.toLowerCase() !== existing.email) {
        const { data: emailExists } = await supabaseAdmin
          .from("admins")
          .select("id")
          .eq("email", email.toLowerCase())
          .neq("id", id)
          .maybeSingle();
        if (emailExists) return res.status(400).json({ error: "Username sudah digunakan." });

        const { error: authUpdateError } = await supabaseAdmin.auth.admin.updateUserById(id, { email: email.toLowerCase() });
        if (authUpdateError) return res.status(400).json({ error: authUpdateError.message });
      }

      if (password) {
        const { error: authUpdateError } = await supabaseAdmin.auth.admin.updateUserById(id, { password });
        if (authUpdateError) return res.status(400).json({ error: authUpdateError.message });
      }

      const patch: Record<string, any> = {};
      if (email) patch.email = email.toLowerCase();
      if (displayName) patch.display_name = displayName;
      if (active !== undefined) patch.active = active;

      const { data: updated, error: updateError } = await supabaseAdmin.from("admins").update(patch).eq("id", id).select().single();
      if (updateError) return res.status(500).json({ error: updateError.message });

      await logActivity(admin.id, "admin", id, "updated", "admin", { name: updated.display_name });
      return res.json(toCamelCase(updated));
    }

    if (req.method === "DELETE") {
      if (id === admin.id) {
        return res.status(400).json({ error: "Tidak dapat menghapus akun sesi Anda sendiri." });
      }

      const { data: existing, error: fetchError } = await supabaseAdmin.from("admins").select("*").eq("id", id).maybeSingle();
      if (fetchError) return res.status(500).json({ error: fetchError.message });
      if (!existing) return res.status(404).json({ error: "Administrator tidak ditemukan." });

      const { count } = await supabaseAdmin.from("admins").select("id", { count: "exact", head: true }).eq("active", true);
      if ((count ?? 0) <= 1 && existing.active) {
        return res.status(400).json({ error: "Tidak dapat menghapus akun Administrator aktif terakhir." });
      }

      const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(id);
      if (deleteError) return res.status(500).json({ error: deleteError.message });
      // admins row cascade-deletes via FK on auth.users(id)

      await logActivity(admin.id, "admin", id, "deleted", "admin", { name: existing.display_name });
      return res.json({ success: true });
    }

    return res.status(405).json({ error: "Metode tidak diizinkan" });
  }

  res.status(404).json({ error: "Rute tidak ditemukan." });
}
