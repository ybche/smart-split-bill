import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../lib/supabaseAdmin";
import { requireAdmin, mapAdminRow } from "../../lib/auth";

export default async function handler(req: VercelRequest, res: VercelResponse) {
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

  res.json({ admin: mapAdminRow(data, admin.email) });
}
