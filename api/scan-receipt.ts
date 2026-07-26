import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GoogleGenAI, Type } from "@google/genai";
import { requireAdmin } from "../lib/auth";

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: { headers: { "User-Agent": "smart-split-bill" } },
  });
}

const PROMPT = `You are an expert OCR receipt parsing AI.
Analyze the provided receipt image (struk/nota/bill) and extract structured information into JSON format.

Extraction details:
1. "merchant": Store or business name (e.g. "Starbucks", "Restoran Sederhana", "Indomaret", "Gacoan").
2. "date": Transaction date formatted strictly as YYYY-MM-DD if present on receipt, else leave blank.
3. "items": Array of line items purchased. For each item:
   - "name": Item name or description as listed on receipt.
   - "quantity": Integer quantity of units (default 1 if not explicitly listed).
   - "unitPrice": Price per single unit in IDR integer.
   - "lineTotal": Total cost for this line item in IDR integer.
4. "subtotal": Sum of line items before tax, service charges, discounts, or tips.
5. "tax": Tax amount if listed (PPN / PB1 / Tax).
6. "serviceCharge": Service charge / service fee if listed.
7. "discount": Discount / promo amount if negative or listed separately (positive number).
8. "otherFees": Delivery fee, packaging fee, roundings, or other miscellaneous fees.
9. "total": Grand total amount paid.

Notes:
- All monetary values must be integer numbers without currency symbols (e.g. 50000 instead of "Rp 50.000").
- Map items accurately even for handwritten, low light, or complex receipts.
- If individual line items cannot be determined, extract a single main item representing the total bill.`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Metode tidak diizinkan" });

  const aiClient = getGeminiClient();
  if (!aiClient) {
    return res.status(503).json({ error: "Kunci API Gemini AI tidak ditemukan. Pastikan GEMINI_API_KEY sudah dikonfigurasi." });
  }

  const { base64Image, mimeType } = req.body ?? {};
  if (!base64Image) {
    return res.status(400).json({ error: "Data gambar struk tidak ditemukan." });
  }

  const cleanBase64 = String(base64Image).replace(/^data:image\/[a-zA-Z]+;base64,/, "").trim();

  try {
    const imagePart = { inlineData: { mimeType: mimeType || "image/jpeg", data: cleanBase64 } };
    const textPart = { text: PROMPT };

    const requestConfig = {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          merchant: { type: Type.STRING },
          date: { type: Type.STRING, description: "Transaction date in format YYYY-MM-DD if available" },
          items: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                quantity: { type: Type.NUMBER },
                unitPrice: { type: Type.NUMBER },
                lineTotal: { type: Type.NUMBER },
              },
              required: ["name", "lineTotal"],
            },
          },
          subtotal: { type: Type.NUMBER },
          tax: { type: Type.NUMBER },
          serviceCharge: { type: Type.NUMBER },
          discount: { type: Type.NUMBER },
          otherFees: { type: Type.NUMBER },
          total: { type: Type.NUMBER },
        },
        required: ["merchant", "items"],
      },
    };

    let responseText = "";

    try {
      const response = await aiClient.models.generateContent({
        model: "gemini-3.6-flash",
        contents: { parts: [imagePart, textPart] },
        config: requestConfig,
      });
      responseText = response.text || "";
    } catch (err1: any) {
      console.warn("Tier 1 (gemini-3.6-flash with schema) failed:", err1?.message || err1);
      try {
        const response = await aiClient.models.generateContent({
          model: "gemini-flash-latest",
          contents: { parts: [imagePart, textPart] },
          config: requestConfig,
        });
        responseText = response.text || "";
      } catch (err2: any) {
        console.warn("Tier 2 (gemini-flash-latest with schema) failed:", err2?.message || err2);
        try {
          const response = await aiClient.models.generateContent({
            model: "gemini-3.6-flash",
            contents: { parts: [imagePart, { text: PROMPT + "\nReturn ONLY valid raw JSON." }] },
          });
          responseText = response.text || "";
        } catch (err3: any) {
          console.error("Tier 3 (unstructured gemini-3.6-flash) failed:", err3?.message || err3);
          throw new Error("Tidak dapat menghubungi model Gemini AI: " + (err3?.message || "Kesalahan internal"));
        }
      }
    }

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) responseText = jsonMatch[0];

    let rawData: any = {};
    try {
      rawData = JSON.parse(responseText.trim());
    } catch (parseErr) {
      console.error("JSON parse error on Gemini OCR response:", parseErr, responseText);
      rawData = {};
    }

    let cleanedItems = (Array.isArray(rawData.items) ? rawData.items : [])
      .map((it: any) => {
        const lineTotal = Math.round(Number(it.lineTotal) || 0);
        const quantity = Math.round(Number(it.quantity) || 1);
        const unitPrice = Math.round(Number(it.unitPrice) || (lineTotal ? Math.round(lineTotal / quantity) : 0));
        return {
          name: String(it.name || "Scanned Item").trim(),
          quantity: quantity > 0 ? quantity : 1,
          unitPrice: unitPrice >= 0 ? unitPrice : 0,
          lineTotal: lineTotal || quantity * unitPrice,
        };
      })
      .filter((it: any) => it.lineTotal > 0 || it.name);

    const subtotal = Math.round(Number(rawData.subtotal) || cleanedItems.reduce((sum: number, it: any) => sum + it.lineTotal, 0));
    const total = Math.round(Number(rawData.total) || subtotal);

    if (cleanedItems.length === 0) {
      cleanedItems = [
        {
          name: rawData.merchant ? `${rawData.merchant} Total Bill` : "Scanned Receipt Item",
          quantity: 1,
          unitPrice: total || subtotal || 0,
          lineTotal: total || subtotal || 0,
        },
      ];
    }

    const data = {
      merchant: String(rawData.merchant || "Scanned Merchant").trim(),
      date: rawData.date && /^\d{4}-\d{2}-\d{2}$/.test(rawData.date) ? rawData.date : new Date().toISOString().split("T")[0],
      items: cleanedItems,
      subtotal,
      tax: Math.round(Number(rawData.tax) || 0),
      serviceCharge: Math.round(Number(rawData.serviceCharge) || 0),
      discount: Math.round(Number(rawData.discount) || 0),
      otherFees: Math.round(Number(rawData.otherFees) || 0),
      total,
    };

    res.json({ data });
  } catch (err: any) {
    console.error("Gemini receipt scan error:", err);
    res.status(500).json({ error: "Pemindaian OCR struk gagal: " + (err.message || "Kesalahan server internal") });
  }
}
