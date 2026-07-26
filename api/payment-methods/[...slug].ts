import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../lib/supabaseAdmin.js";
import { requireAdmin } from "../../lib/auth.js";
import { logActivity } from "../../lib/activity.js";
import { toCamelCase } from "../../lib/caseConvert.js";
import { uploadBase64Image, UploadValidationError } from "../../lib/storage.js";
import { getSlug } from "../../lib/routeSlug.js";

function withAliases(row: any) {
  const camel = toCamelCase(row);
  return { ...camel, accountName: camel.accountHolder, qrisImage: camel.imageUrl, isPreferred: camel.preferred };
}

// Consolidates every /api/payment-methods/* route into a single serverless
// function (Vercel Hobby caps a deployment at 12 functions) via an optional
// catch-all segment:
//   []                  -> GET / POST
//   ["upload-qris"]      -> POST
//   [id]                 -> PUT / DELETE
//   [id, "preferred"]    -> POST
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const slug = getSlug(req, "payment-methods");

  // Vercel's file-system router does not match the bare "/api/payment-methods"
  // path against a catch-all segment file, so vercel.json rewrites it to
  // "/api/payment-methods/_index" instead — treat that the same as no segments.
  if (slug.length === 0 || (slug.length === 1 && slug[0] === "_index")) {
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

    return res.status(405).json({ error: "Metode tidak diizinkan" });
  }

  if (slug.length === 1 && slug[0] === "upload-qris") {
    if (req.method !== "POST") return res.status(405).json({ error: "Metode tidak diizinkan" });

    const { base64Image, mimeType, methodId } = req.body ?? {};
    if (!base64Image) {
      return res.status(400).json({ error: "Data gambar tidak ditemukan." });
    }

    if (methodId) {
      const { count } = await supabaseAdmin
        .from("payment_methods")
        .select("id", { count: "exact", head: true })
        .eq("id", methodId);
      if (!count) return res.status(404).json({ error: "Metode pembayaran tidak ditemukan." });
    }

    try {
      const imageUrl = await uploadBase64Image("qris-codes", base64Image, mimeType || "image/png", "qris");

      if (methodId) {
        await supabaseAdmin.from("payment_methods").update({ image_url: imageUrl }).eq("id", methodId);
      }

      return res.json({ success: true, imageUrl });
    } catch (err: any) {
      if (err instanceof UploadValidationError) {
        return res.status(400).json({ error: err.message });
      }
      console.error("QRIS upload error:", err);
      return res.status(500).json({ error: "Gagal menyimpan gambar: " + err.message });
    }
  }

  const id = slug[0];

  if (slug.length === 1) {
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

    return res.status(405).json({ error: "Metode tidak diizinkan" });
  }

  if (slug.length === 2 && slug[1] === "preferred") {
    if (req.method !== "POST") return res.status(405).json({ error: "Metode tidak diizinkan" });

    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("payment_methods")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (fetchError) return res.status(500).json({ error: fetchError.message });
    if (!existing) return res.status(404).json({ error: "Metode pembayaran tidak ditemukan." });

    await supabaseAdmin.from("payment_methods").update({ preferred: false }).neq("id", id);
    const { error } = await supabaseAdmin.from("payment_methods").update({ preferred: true }).eq("id", id);
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ success: true });
  }

  res.status(404).json({ error: "Rute tidak ditemukan." });
}
