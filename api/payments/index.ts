import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../lib/supabaseAdmin";
import { requireAdmin } from "../../lib/auth";
import { toCamelCase } from "../../lib/caseConvert";
import { withSignedProofUrl } from "../../lib/storage";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== "GET") return res.status(405).json({ error: "Metode tidak diizinkan" });

  const [{ data: submissions, error: subError }, { data: participants }, { data: categories }, { data: allocations }] = await Promise.all([
    supabaseAdmin.from("payment_submissions").select("*").order("submission_date", { ascending: false }),
    supabaseAdmin.from("participants").select("id, full_name"),
    supabaseAdmin.from("categories").select("id, name"),
    supabaseAdmin.from("allocations").select("transaction_id, participant_id, rounded_amount"),
  ]);
  if (subError) return res.status(500).json({ error: subError.message });

  const participantsById = new Map((participants ?? []).map((p: any) => [p.id, p.full_name]));
  const categoriesById = new Map((categories ?? []).map((c: any) => [c.id, c.name]));

  const enriched = await Promise.all(
    (submissions ?? []).map(async (p: any) => {
      const obligations: string[] = p.selected_obligations || [];
      const expectedAmount = (allocations ?? [])
        .filter((al: any) => obligations.includes(al.transaction_id) && al.participant_id === p.participant_id)
        .reduce((sum: number, al: any) => sum + (al.rounded_amount || 0), 0);

      const signed = await withSignedProofUrl(p);
      return {
        ...toCamelCase(signed),
        participantName: participantsById.get(p.participant_id) || "Unknown",
        categoryName: categoriesById.get(p.category_id) || "Unknown",
        expectedAmount,
      };
    })
  );

  res.json(enriched);
}
