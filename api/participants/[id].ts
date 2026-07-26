import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../lib/supabaseAdmin";
import { requireAdmin } from "../../lib/auth";
import { logActivity } from "../../lib/activity";
import { toCamelCase } from "../../lib/caseConvert";
import { normalizeIndonesianPhone } from "../../lib/phone";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const id = req.query.id as string;

  if (req.method === "PUT") {
    const { fullName, phone, email, nickname, notes, active } = req.body ?? {};

    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("participants")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (fetchError) return res.status(500).json({ error: fetchError.message });
    if (!existing) return res.status(404).json({ error: "Peserta tidak ditemukan." });

    const normalized = phone ? normalizeIndonesianPhone(phone) : existing.normalized_phone;

    if (phone && normalized !== existing.normalized_phone) {
      const { data: dup } = await supabaseAdmin
        .from("participants")
        .select("full_name")
        .eq("normalized_phone", normalized)
        .neq("id", id)
        .maybeSingle();
      if (dup) {
        return res.status(400).json({ error: `Nomor telepon sudah digunakan oleh peserta lain: ${dup.full_name}.` });
      }
    }

    const { data, error } = await supabaseAdmin
      .from("participants")
      .update({
        full_name: fullName || existing.full_name,
        normalized_phone: normalized,
        email: email !== undefined ? email : existing.email,
        nickname: nickname || existing.nickname,
        notes: notes !== undefined ? notes : existing.notes,
        active: active !== undefined ? active : existing.active,
      })
      .eq("id", id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });

    await logActivity(admin.id, "participant", id, "updated", "admin", { fullName });
    return res.json(toCamelCase(data));
  }

  if (req.method === "DELETE") {
    const force = req.query.force === "true";

    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("participants")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (fetchError) return res.status(500).json({ error: fetchError.message });
    if (!existing) return res.status(404).json({ error: "Peserta tidak ditemukan." });

    const { count, error: countError } = await supabaseAdmin
      .from("allocations")
      .select("id", { count: "exact", head: true })
      .eq("participant_id", id);
    if (countError) return res.status(500).json({ error: countError.message });

    if ((count ?? 0) > 0 && !force) {
      return res.status(400).json({
        error: "Tidak dapat menghapus peserta. Peserta ini memiliki alokasi tagihan aktif. Arsipkan sebagai gantinya.",
        canForce: true,
      });
    }

    if (force) {
      await supabaseAdmin.from("allocations").delete().eq("participant_id", id);
      await supabaseAdmin.from("payment_submissions").delete().eq("participant_id", id);
    }

    // category_participants cascade-deletes via FK on participants.id
    const { error: deleteError } = await supabaseAdmin.from("participants").delete().eq("id", id);
    if (deleteError) return res.status(500).json({ error: deleteError.message });

    await logActivity(admin.id, "participant", id, "deleted", "admin");
    return res.json({ success: true });
  }

  res.status(405).json({ error: "Metode tidak diizinkan" });
}
