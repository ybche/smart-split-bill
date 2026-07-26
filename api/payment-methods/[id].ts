import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../lib/supabaseAdmin";
import { requireAdmin } from "../../lib/auth";
import { toCamelCase } from "../../lib/caseConvert";

function withAliases(row: any) {
  const camel = toCamelCase(row);
  return { ...camel, accountName: camel.accountHolder, qrisImage: camel.imageUrl, isPreferred: camel.preferred };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const id = req.query.id as string;

  if (req.method === "PUT") {
    const { name, accountHolder, accountName, accountNumber, instructions, notes, enabled, preferred, isPreferred, displayOrder, imageUrl, qrisImage } =
      req.body ?? {};

    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("payment_methods")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (fetchError) return res.status(500).json({ error: fetchError.message });
    if (!existing) return res.status(404).json({ error: "Metode pembayaran tidak ditemukan." });

    const finalAccountHolder = accountHolder !== undefined ? accountHolder : accountName;
    const finalPreferred = preferred !== undefined ? preferred : isPreferred;
    const finalImageUrl = imageUrl !== undefined ? imageUrl : qrisImage;

    if (finalPreferred) {
      await supabaseAdmin.from("payment_methods").update({ preferred: false }).neq("id", id);
    }

    const { data, error } = await supabaseAdmin
      .from("payment_methods")
      .update({
        name: name !== undefined ? name : existing.name,
        account_holder: finalAccountHolder !== undefined ? finalAccountHolder : existing.account_holder,
        account_number: accountNumber !== undefined ? accountNumber : existing.account_number,
        instructions: instructions !== undefined ? instructions : existing.instructions,
        notes: notes !== undefined ? notes : existing.notes,
        enabled: enabled !== undefined ? enabled : existing.enabled,
        preferred: finalPreferred !== undefined ? finalPreferred : existing.preferred,
        display_order: displayOrder !== undefined ? displayOrder : existing.display_order,
        image_url: finalImageUrl !== undefined ? finalImageUrl : existing.image_url,
      })
      .eq("id", id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });

    return res.json(withAliases(data));
  }

  if (req.method === "DELETE") {
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("payment_methods")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (fetchError) return res.status(500).json({ error: fetchError.message });
    if (!existing) return res.status(404).json({ error: "Metode pembayaran tidak ditemukan." });

    const { error } = await supabaseAdmin.from("payment_methods").delete().eq("id", id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }

  res.status(405).json({ error: "Metode tidak diizinkan" });
}
