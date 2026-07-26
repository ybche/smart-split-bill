import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomBytes } from "crypto";
import { supabaseAdmin } from "../../lib/supabaseAdmin";
import { requireAdmin } from "../../lib/auth";
import { logActivity } from "../../lib/activity";
import { toCamelCase } from "../../lib/caseConvert";
import { normalizeIndonesianPhone } from "../../lib/phone";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  if (req.method === "GET") {
    const { data, error } = await supabaseAdmin.from("participants").select("*").order("created_at", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.json(toCamelCase(data));
  }

  if (req.method === "POST") {
    const { fullName, phone, email, nickname, notes } = req.body ?? {};
    if (!fullName || !phone) {
      return res.status(400).json({ error: "Nama Lengkap dan Nomor Telepon wajib diisi." });
    }

    const normalized = normalizeIndonesianPhone(phone);

    const { data: existing } = await supabaseAdmin
      .from("participants")
      .select("*")
      .eq("normalized_phone", normalized)
      .maybeSingle();
    if (existing) {
      return res.status(400).json({
        error: `Peserta dengan nomor telepon ini sudah ada: ${existing.full_name}.`,
        participant: toCamelCase(existing),
      });
    }

    const { data, error } = await supabaseAdmin
      .from("participants")
      .insert({
        full_name: fullName,
        normalized_phone: normalized,
        email: email || "",
        nickname: nickname || fullName,
        notes: notes || "",
        introduction_state: "NeverOpened",
        created_source: "manual",
        active: true,
      })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });

    await logActivity(admin.id, "participant", data.id, "created", "admin", { fullName });
    return res.status(201).json(toCamelCase(data));
  }

  res.status(405).json({ error: "Metode tidak diizinkan" });
}
