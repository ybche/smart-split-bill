import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getPortalData } from "../../../lib/portal";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Metode tidak diizinkan" });

  const token = req.query.token as string;
  try {
    const result = await getPortalData(token);
    if (result.status !== 200) {
      return res.status(result.status).json({ error: result.error });
    }
    return res.json(result.body);
  } catch (err: any) {
    console.error("pay-portal error:", err);
    return res.status(500).json({ error: err?.message || "Gagal memuat portal." });
  }
}
