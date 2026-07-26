import { randomBytes } from "crypto";
import { supabaseAdmin } from "./supabaseAdmin";

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export class UploadValidationError extends Error {}

// Shared upload path for both QRIS images and payment transfer proofs.
// Validates mime type and size BEFORE decoding the full buffer, unlike the
// original server.ts (which decoded first and only checked size after).
export async function uploadBase64Image(
  bucket: "qris-codes" | "payment-proofs",
  base64Image: string,
  mimeType: string,
  filePrefix: string
): Promise<string> {
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    throw new UploadValidationError(`Tipe gambar tidak didukung: ${mimeType}`);
  }

  const approxBytes = Math.ceil((base64Image.length * 3) / 4);
  if (approxBytes > MAX_FILE_BYTES) {
    throw new UploadValidationError("Ukuran gambar melebihi batas maksimal 5MB");
  }

  const buffer = Buffer.from(base64Image, "base64");
  if (buffer.byteLength > MAX_FILE_BYTES) {
    throw new UploadValidationError("Ukuran gambar melebihi batas maksimal 5MB");
  }

  const ext = EXT_BY_MIME[mimeType];
  const fileName = `${filePrefix}-${randomBytes(8).toString("hex")}.${ext}`;

  const { error } = await supabaseAdmin.storage.from(bucket).upload(fileName, buffer, {
    contentType: mimeType,
    upsert: false,
  });
  if (error) {
    throw new Error(`Gagal mengunggah gambar: ${error.message}`);
  }

  if (bucket === "qris-codes") {
    const { data } = supabaseAdmin.storage.from(bucket).getPublicUrl(fileName);
    return data.publicUrl;
  }

  // Payment proofs are private — return the storage path; callers must
  // generate a signed URL (createSignedUrl) when they need to display it.
  return fileName;
}

export async function getSignedProofUrl(path: string, expiresInSeconds = 3600): Promise<string | null> {
  const { data, error } = await supabaseAdmin.storage
    .from("payment-proofs")
    .createSignedUrl(path, expiresInSeconds);
  if (error) {
    console.error("createSignedUrl failed:", error.message);
    return null;
  }
  return data.signedUrl;
}

// Once a payment is approved there is no further need to keep the transfer
// proof image around — call this to reclaim storage space. Safe to call even
// if the path is already gone.
export async function deleteProofImage(path: string): Promise<void> {
  const { error } = await supabaseAdmin.storage.from("payment-proofs").remove([path]);
  if (error) console.error("deleteProofImage failed:", error.message);
}

// payment_submissions.proof_url stores a bare storage path (private bucket).
// Call this before sending any row containing proof_url/proofUrl to a client
// so it becomes a usable (time-limited) URL instead of an opaque path.
export async function withSignedProofUrl<T extends Record<string, any>>(row: T, key: "proof_url" | "proofUrl" = "proof_url"): Promise<T> {
  const path = row[key];
  if (!path) return row;
  const signedUrl = await getSignedProofUrl(path);
  return { ...row, [key]: signedUrl || null };
}
