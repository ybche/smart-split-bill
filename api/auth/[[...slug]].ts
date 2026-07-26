import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../lib/supabaseAdmin";
import { requireAdmin, mapAdminRow } from "../../lib/auth";
import { logActivity } from "../../lib/activity";

// Consolidates every /api/auth/* route into a single serverless function
// (Vercel Hobby caps a deployment at 12 functions) via an optional catch-all
// segment. "status" and "bootstrap-admin" are unauthenticated (they exist
// specifically to answer "is there an admin yet?" / create the first one);
// "me" and "settings" require an admin session.
//   ["status"]           -> GET, public
//   ["bootstrap-admin"]  -> POST, public
//   ["me"]               -> GET, admin
//   ["settings"]         -> PUT, admin
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const slug = ([] as string[]).concat((req.query.slug as string | string[] | undefined) || []);
  const route = slug[0];

  if (slug.length === 1 && route === "status") {
    if (req.method !== "GET") return res.status(405).json({ error: "Metode tidak diizinkan" });

    const { count, error } = await supabaseAdmin.from("admins").select("id", { count: "exact", head: true });
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ setupRequired: (count ?? 0) === 0 });
  }

  if (slug.length === 1 && route === "bootstrap-admin") {
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
    return res.status(201).json(mapAdminRow(adminRow, created.user.email ?? undefined));
  }

  if (slug.length === 1 && route === "me") {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (req.method !== "GET") return res.status(405).json({ error: "Metode tidak diizinkan" });

    return res.json(admin);
  }

  if (slug.length === 1 && route === "settings") {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (req.method !== "PUT") return res.status(405).json({ error: "Metode tidak diizinkan" });

    const { settings } = req.body ?? {};
    const patch: Record<string, any> = {};
    if (settings?.currency !== undefined) patch.currency = settings.currency;
    if (settings?.locale !== undefined) patch.locale = settings.locale;
    if (settings?.timezone !== undefined) patch.timezone = settings.timezone;
    if (settings?.requireProof !== undefined) patch.require_proof = settings.requireProof;
    if (settings?.roundingPolicy !== undefined) patch.rounding_policy = settings.roundingPolicy;
    if (settings?.introductionTemplate !== undefined) patch.introduction_template = settings.introductionTemplate;
    if (settings?.reminderTemplate !== undefined) patch.reminder_template = settings.reminderTemplate;

    const { data, error } = await supabaseAdmin.from("admins").update(patch).eq("id", admin.id).select().single();
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ admin: mapAdminRow(data, admin.email) });
  }

  res.status(404).json({ error: "Rute tidak ditemukan." });
}
