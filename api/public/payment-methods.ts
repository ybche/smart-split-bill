import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../lib/supabaseAdmin";
import { toCamelCase } from "../../lib/caseConvert";

const TYPE_LABELS: Record<string, string> = { bank: "Bank Account", wallet: "E-Wallet", qris: "QRIS" };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Metode tidak diizinkan" });

  const { data, error } = await supabaseAdmin
    .from("payment_methods")
    .select("*")
    .eq("enabled", true)
    .order("display_order", { ascending: true });
  if (error) return res.status(500).json({ error: error.message });

  const methods = (data ?? []).map((m: any) => {
    const camel = toCamelCase(m);
    return {
      ...camel,
      accountName: camel.accountHolder,
      qrisImage: camel.imageUrl,
      isPreferred: camel.preferred,
      type: TYPE_LABELS[m.type] || m.type,
    };
  });
  res.json(methods);
}
