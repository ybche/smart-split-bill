import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../lib/supabaseAdmin";
import { requireAdmin } from "../../lib/auth";
import { logActivity } from "../../lib/activity";
import { toCamelCase } from "../../lib/caseConvert";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
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
  res.json({ success: true, target: toCamelCase(target) });
}
