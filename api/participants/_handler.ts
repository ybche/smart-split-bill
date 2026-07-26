import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../lib/supabaseAdmin.js";
import { requireAdmin } from "../../lib/auth.js";
import { logActivity } from "../../lib/activity.js";
import { toCamelCase } from "../../lib/caseConvert.js";
import { normalizeIndonesianPhone } from "../../lib/phone.js";
import { getSlug } from "../../lib/routeSlug.js";

// Consolidates every /api/participants/* route into a single serverless
// function (Vercel Hobby caps a deployment at 12 functions) via an optional
// catch-all segment:
//   []          -> GET / POST
//   ["merge"]    -> POST
//   [id]         -> PUT / DELETE
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const slug = getSlug(req);

  if (slug.length === 0) {
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

    return res.status(405).json({ error: "Metode tidak diizinkan" });
  }

  if (slug.length === 1 && slug[0] === "merge") {
    if (req.method !== "POST") return res.status(405).json({ error: "Metode tidak diizinkan" });

    const { sourceId, targetId } = req.body ?? {};

    const [{ data: source, error: sourceError }, { data: target, error: targetError }] = await Promise.all([
      supabaseAdmin.from("participants").select("*").eq("id", sourceId).maybeSingle(),
      supabaseAdmin.from("participants").select("*").eq("id", targetId).maybeSingle(),
    ]);
    if (sourceError) return res.status(500).json({ error: sourceError.message });
    if (targetError) return res.status(500).json({ error: targetError.message });
    if (!source || !target) return res.status(404).json({ error: "Peserta sumber atau tujuan tidak ditemukan." });

    await supabaseAdmin.from("allocations").update({ participant_id: targetId }).eq("participant_id", sourceId);
    await supabaseAdmin.from("payment_submissions").update({ participant_id: targetId }).eq("participant_id", sourceId);

    const { data: sourceCps } = await supabaseAdmin
      .from("category_participants")
      .select("category_id")
      .eq("participant_id", sourceId);
    const { data: targetCps } = await supabaseAdmin
      .from("category_participants")
      .select("category_id")
      .eq("participant_id", targetId);
    const targetCategoryIds = new Set((targetCps ?? []).map((cp: any) => cp.category_id));

    for (const cp of sourceCps ?? []) {
      if (!targetCategoryIds.has(cp.category_id)) {
        await supabaseAdmin
          .from("category_participants")
          .update({ participant_id: targetId })
          .eq("participant_id", sourceId)
          .eq("category_id", cp.category_id);
      }
    }
    // Remove any remaining source links (duplicates already covered by target)
    await supabaseAdmin.from("category_participants").delete().eq("participant_id", sourceId);
    await supabaseAdmin.from("participants").delete().eq("id", sourceId);

    await logActivity(admin.id, "participant", targetId, "merged_with", "admin", {
      sourceId,
      sourceName: source.full_name,
    });
    return res.json({ success: true, target: toCamelCase(target) });
  }

  if (slug.length === 1) {
    const id = slug[0];

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

    return res.status(405).json({ error: "Metode tidak diizinkan" });
  }

  res.status(404).json({ error: "Rute tidak ditemukan." });
}
