import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../lib/supabaseAdmin";
import { toCamelCase } from "../../lib/caseConvert";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Metode tidak diizinkan" });

  const { participantId, categoryId, type, generatedMessage, link, action } = req.body ?? {};
  if (!participantId || !categoryId || !type) {
    return res.status(400).json({ error: "Detail aksi tidak lengkap." });
  }

  const { data, error } = await supabaseAdmin
    .from("message_actions")
    .insert({
      participant_id: participantId,
      category_id: categoryId,
      type,
      generated_message: generatedMessage,
      link,
      opened_at: action === "whatsapp_opened" ? new Date().toISOString() : null,
      manually_marked_sent_at: action === "sent" ? new Date().toISOString() : null,
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });

  if (type === "introduction") {
    await supabaseAdmin
      .from("participants")
      .update({ introduction_state: action === "whatsapp_opened" ? "Opened" : "ManuallyMarkedSent" })
      .eq("id", participantId);
  }

  res.json(toCamelCase(data));
}
