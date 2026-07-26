import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomBytes } from "crypto";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";
import { requireAdmin } from "../../../lib/auth";
import { logActivity } from "../../../lib/activity";
import { normalizeIndonesianPhone } from "../../../lib/phone";

async function getOrCreateParticipantToken(participantId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("category_participants")
    .select("personal_token")
    .eq("participant_id", participantId)
    .not("personal_token", "is", null)
    .limit(1)
    .maybeSingle();
  return data?.personal_token || randomBytes(16).toString("hex");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Metode tidak diizinkan" });

  const categoryId = req.query.id as string;
  const { participantIds, newParticipants } = req.body ?? {};

  const { data: category, error: catError } = await supabaseAdmin
    .from("categories")
    .select("id")
    .eq("id", categoryId)
    .maybeSingle();
  if (catError) return res.status(500).json({ error: catError.message });
  if (!category) return res.status(404).json({ error: "Kategori tidak ditemukan." });

  const addedIds: string[] = [];

  if (Array.isArray(participantIds)) {
    for (const pId of participantIds) {
      const { count } = await supabaseAdmin
        .from("category_participants")
        .select("id", { count: "exact", head: true })
        .eq("category_id", categoryId)
        .eq("participant_id", pId);
      if (!count) {
        const token = await getOrCreateParticipantToken(pId);
        const { error } = await supabaseAdmin.from("category_participants").insert({
          category_id: categoryId,
          participant_id: pId,
          personal_token: token,
          token_state: "Active",
        });
        if (!error) addedIds.push(pId);
      }
    }
  }

  if (Array.isArray(newParticipants)) {
    for (const np of newParticipants) {
      const { fullName, phone } = np ?? {};
      if (!fullName || !phone) continue;

      const normalized = normalizeIndonesianPhone(phone);
      let { data: participant } = await supabaseAdmin
        .from("participants")
        .select("*")
        .eq("normalized_phone", normalized)
        .maybeSingle();

      if (!participant) {
        const { data: created, error: createError } = await supabaseAdmin
          .from("participants")
          .insert({
            full_name: fullName,
            normalized_phone: normalized,
            email: np.email || "",
            nickname: np.nickname || fullName,
            notes: np.notes || "",
            introduction_state: "NeverOpened",
            created_source: "transaction",
            active: true,
          })
          .select()
          .single();
        if (createError) continue;
        participant = created;
      }

      const { count } = await supabaseAdmin
        .from("category_participants")
        .select("id", { count: "exact", head: true })
        .eq("category_id", categoryId)
        .eq("participant_id", participant.id);
      if (!count) {
        const token = await getOrCreateParticipantToken(participant.id);
        const { error } = await supabaseAdmin.from("category_participants").insert({
          category_id: categoryId,
          participant_id: participant.id,
          personal_token: token,
          token_state: "Active",
        });
        if (!error) addedIds.push(participant.id);
      }
    }
  }

  await logActivity(admin.id, "category", categoryId, "participants_linked", "admin", { addedIds });
  res.json({ success: true, addedIds });
}
