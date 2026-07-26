import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../lib/supabaseAdmin";
import { requireAdmin } from "../../lib/auth";
import { uploadBase64Image, UploadValidationError } from "../../lib/storage";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
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

    res.json({ success: true, imageUrl });
  } catch (err: any) {
    if (err instanceof UploadValidationError) {
      return res.status(400).json({ error: err.message });
    }
    console.error("QRIS upload error:", err);
    res.status(500).json({ error: "Gagal menyimpan gambar: " + err.message });
  }
}
