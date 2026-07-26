import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../lib/supabaseAdmin";
import { isRateLimited } from "../../lib/rateLimit";
import { normalizeIndonesianPhone } from "../../lib/phone";

// Hardened rewrite of the original /api/public/find-portal.
//
// The original did an unthrottled substring search across participant
// full name/nickname/email/phone and returned the live personal payment
// token for every match — a single letter query could dump the entire
// participant/token directory. This version:
//   1. Rate-limits by IP (this endpoint has no auth at all).
//   2. Only resolves an EXACT personal token, or an EXACT normalized phone
//      number match — no substring/name search, so it can no longer be used
//      to enumerate participants.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Metode tidak diizinkan" });

  if (await isRateLimited(req, res, "find-portal", { windowSeconds: 900, maxRequests: 8 })) {
    return;
  }

  const { query } = req.body ?? {};
  if (!query || typeof query !== "string" || !query.trim()) {
    return res.status(400).json({ error: "Silakan masukkan nomor telepon atau token Anda." });
  }

  const q = query.trim().toLowerCase();

  const { data: cpDirectRows } = await supabaseAdmin
    .from("category_participants")
    .select("personal_token")
    .eq("personal_token", q)
    .eq("token_state", "Active")
    .limit(1);
  if (cpDirectRows && cpDirectRows.length > 0) {
    return res.json({ token: cpDirectRows[0].personal_token });
  }

  const normalizedPhone = normalizeIndonesianPhone(query.trim());
  if (!normalizedPhone || normalizedPhone.length < 8) {
    return res.status(404).json({ error: "Data peserta tidak ditemukan. Pastikan nomor HP atau token Anda sesuai." });
  }

  const { data: participant } = await supabaseAdmin
    .from("participants")
    .select("id, full_name")
    .eq("normalized_phone", normalizedPhone)
    .maybeSingle();
  if (!participant) {
    return res.status(404).json({ error: "Data peserta tidak ditemukan. Pastikan nomor HP atau token Anda sesuai." });
  }

  const { data: matchedCPs } = await supabaseAdmin
    .from("category_participants")
    .select("personal_token, categories(name)")
    .eq("participant_id", participant.id)
    .eq("token_state", "Active");

  if (!matchedCPs || matchedCPs.length === 0) {
    return res.status(404).json({ error: "Tidak ada link pembayaran aktif untuk peserta ini." });
  }

  const results = matchedCPs.map((cp: any) => ({
    token: cp.personal_token,
    participantName: participant.full_name || "Peserta",
    categoryName: cp.categories?.name || "Kategori Tagihan",
  }));

  res.json({ results });
}
