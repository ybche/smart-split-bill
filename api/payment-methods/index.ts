import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../lib/supabaseAdmin";
import { requireAdmin } from "../../lib/auth";
import { logActivity } from "../../lib/activity";
import { toCamelCase } from "../../lib/caseConvert";

function withAliases(row: any) {
  const camel = toCamelCase(row);
  return { ...camel, accountName: camel.accountHolder, qrisImage: camel.imageUrl, isPreferred: camel.preferred };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  if (req.method === "GET") {
    const { data, error } = await supabaseAdmin.from("payment_methods").select("*").order("display_order", { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.json((data ?? []).map(withAliases));
  }

  if (req.method === "POST") {
    const { type, name, accountHolder, accountName, accountNumber, instructions, notes, preferred, isPreferred, qrisImage, imageUrl } =
      req.body ?? {};

    const finalAccountHolder = type === "QRIS" ? accountHolder || accountName || "QRIS Code" : accountHolder !== undefined ? accountHolder : accountName;
    const finalAccountNumber = type === "QRIS" ? accountNumber || "STATIC_QRIS_STANDARDIZED" : accountNumber;
    const finalPreferred = preferred !== undefined ? preferred : isPreferred;
    const finalImageUrl = imageUrl !== undefined ? imageUrl : qrisImage;

    if (!type || !name || !finalAccountHolder || !finalAccountNumber) {
      return res.status(400).json({ error: "Tipe, Nama, Nama Pemilik Akun, dan Nomor Akun/ID wajib diisi." });
    }

    if (finalPreferred) {
      await supabaseAdmin.from("payment_methods").update({ preferred: false }).neq("id", "00000000-0000-0000-0000-000000000000");
    }

    const { count } = await supabaseAdmin.from("payment_methods").select("id", { count: "exact", head: true });

    const { data, error } = await supabaseAdmin
      .from("payment_methods")
      .insert({
        type,
        name,
        account_holder: finalAccountHolder,
        account_number: finalAccountNumber,
        instructions: instructions || "",
        notes: notes || "",
        enabled: true,
        preferred: !!finalPreferred,
        image_url: finalImageUrl || "",
        display_order: (count ?? 0) + 1,
      })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });

    await logActivity(admin.id, "method", data.id, "created", "admin", { name });
    return res.status(201).json(withAliases(data));
  }

  res.status(405).json({ error: "Metode tidak diizinkan" });
}
