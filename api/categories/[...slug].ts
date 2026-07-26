import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomBytes } from "crypto";
import { supabaseAdmin } from "../../lib/supabaseAdmin.js";
import { requireAdmin } from "../../lib/auth.js";
import { logActivity } from "../../lib/activity.js";
import { toCamelCase } from "../../lib/caseConvert.js";
import { normalizeIndonesianPhone } from "../../lib/phone.js";
import { getOrCreateParticipantToken } from "../../lib/categoryParticipantSync.js";
import { getSlug } from "../../lib/routeSlug.js";

// Consolidates every /api/categories/* route into a single serverless
// function (Vercel Hobby caps a deployment at 12 functions) via an optional
// catch-all segment. Routes below by [...slug] instead of one file per path:
//   []                                              -> GET / POST
//   [id]                                             -> PUT / DELETE
//   [id, "details"]                                  -> GET
//   [id, "participants"]                             -> POST
//   [id, "participants", participantId, "regenerate-token"] -> POST
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const slug = getSlug(req, "categories");

  // Vercel's file-system router does not match the bare "/api/categories"
  // path against a catch-all segment file, so vercel.json rewrites it to
  // "/api/categories/_index" instead — treat that the same as no segments.
  if (slug.length === 0 || (slug.length === 1 && slug[0] === "_index")) {
    if (req.method === "GET") {
      const { data, error } = await supabaseAdmin.from("categories").select("*").order("created_at", { ascending: false });
      if (error) return res.status(500).json({ error: error.message });
      return res.json(toCamelCase(data));
    }

    if (req.method === "POST") {
      const { name, description, startDate, endDate, notes } = req.body ?? {};
      if (!name) return res.status(400).json({ error: "Nama kategori wajib diisi." });

      const { data, error } = await supabaseAdmin
        .from("categories")
        .insert({
          name,
          description: description || "",
          start_date: startDate || null,
          end_date: endDate || null,
          notes: notes ?? null,
          status: "Draft",
        })
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });

      await logActivity(admin.id, "category", data.id, "created", "admin", { name });
      return res.status(201).json(toCamelCase(data));
    }

    return res.status(405).json({ error: "Metode tidak diizinkan" });
  }

  const categoryId = slug[0];

  if (slug.length === 1) {
    if (req.method === "PUT") {
      const { name, description, startDate, endDate, status, notes } = req.body ?? {};

      const { data: existing, error: fetchError } = await supabaseAdmin
        .from("categories")
        .select("*")
        .eq("id", categoryId)
        .maybeSingle();
      if (fetchError) return res.status(500).json({ error: fetchError.message });
      if (!existing) return res.status(404).json({ error: "Kategori tidak ditemukan." });

      const { data, error } = await supabaseAdmin
        .from("categories")
        .update({
          name: name !== undefined ? name : existing.name,
          description: description !== undefined ? description : existing.description,
          start_date: startDate !== undefined ? startDate : existing.start_date,
          end_date: endDate !== undefined ? endDate : existing.end_date,
          status: status !== undefined ? status : existing.status,
          notes: notes !== undefined ? notes : existing.notes,
        })
        .eq("id", categoryId)
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });

      await logActivity(admin.id, "category", categoryId, "updated", "admin", { name });
      return res.json(toCamelCase(data));
    }

    if (req.method === "DELETE") {
      const force = req.query.force === "true";

      const { data: existing, error: fetchError } = await supabaseAdmin
        .from("categories")
        .select("id")
        .eq("id", categoryId)
        .maybeSingle();
      if (fetchError) return res.status(500).json({ error: fetchError.message });
      if (!existing) return res.status(404).json({ error: "Kategori tidak ditemukan." });

      const { count, error: countError } = await supabaseAdmin
        .from("payment_submissions")
        .select("id", { count: "exact", head: true })
        .eq("category_id", categoryId)
        .eq("status", "Paid");
      if (countError) return res.status(500).json({ error: countError.message });

      if ((count ?? 0) > 0 && !force) {
        return res.status(400).json({ error: "Tidak dapat menghapus kategori yang memiliki pembayaran terverifikasi.", canForce: true });
      }

      // category_participants, transactions (and transitively transaction_items/allocations),
      // and payment_submissions (and transitively payment_allocations) all cascade-delete via FK.
      const { error: deleteError } = await supabaseAdmin.from("categories").delete().eq("id", categoryId);
      if (deleteError) return res.status(500).json({ error: deleteError.message });

      await logActivity(admin.id, "category", categoryId, "deleted", "admin");
      return res.json({ success: true });
    }

    return res.status(405).json({ error: "Metode tidak diizinkan" });
  }

  if (slug.length === 2 && slug[1] === "details") {
    if (req.method !== "GET") return res.status(405).json({ error: "Metode tidak diizinkan" });

    const { data: category, error: catError } = await supabaseAdmin.from("categories").select("*").eq("id", categoryId).maybeSingle();
    if (catError) return res.status(500).json({ error: catError.message });
    if (!category) return res.status(404).json({ error: "Kategori tidak ditemukan." });

    const [
      { data: cps, error: cpError },
      { data: transactions, error: txError },
      { data: payments, error: paymentsError },
      { data: allocations, error: allocError },
    ] = await Promise.all([
      supabaseAdmin.from("category_participants").select("*, participants(*)").eq("category_id", categoryId),
      supabaseAdmin.from("transactions").select("*").eq("category_id", categoryId),
      supabaseAdmin.from("payment_submissions").select("*").eq("category_id", categoryId),
      supabaseAdmin
        .from("allocations")
        .select("*, transactions!inner(category_id)")
        .eq("transactions.category_id", categoryId),
    ]);
    if (cpError) return res.status(500).json({ error: cpError.message });
    if (txError) return res.status(500).json({ error: txError.message });
    if (paymentsError) return res.status(500).json({ error: paymentsError.message });
    if (allocError) return res.status(500).json({ error: allocError.message });

    const mappedParticipants = (cps ?? [])
      .filter((cp: any) => cp.participants)
      .map((cp: any) => ({
        ...toCamelCase(cp.participants),
        personalToken: cp.personal_token,
        tokenState: cp.token_state,
      }));

    const participantObligations: Record<string, { totalOriginalObligation: number; paid: number; pending: number; remaining: number }> = {};
    mappedParticipants.forEach((p: any) => {
      participantObligations[p.id] = { totalOriginalObligation: 0, paid: 0, pending: 0, remaining: 0 };
    });

    let totalSpent = 0;
    let verifiedPaid = 0;
    let pendingPaid = 0;

    (transactions ?? []).forEach((t: any) => {
      totalSpent += t.total;
    });

    (allocations ?? []).forEach((alloc: any) => {
      if (participantObligations[alloc.participant_id]) {
        participantObligations[alloc.participant_id].totalOriginalObligation += alloc.rounded_amount;
      }
    });

    (payments ?? []).forEach((p: any) => {
      if (p.status === "Paid") {
        verifiedPaid += p.submitted_amount;
        if (participantObligations[p.participant_id]) {
          participantObligations[p.participant_id].paid += p.submitted_amount;
        }
      } else if (p.status === "Pending Verification") {
        pendingPaid += p.submitted_amount;
        if (participantObligations[p.participant_id]) {
          participantObligations[p.participant_id].pending += p.submitted_amount;
        }
      }
    });

    mappedParticipants.forEach((p: any) => {
      const ob = participantObligations[p.id];
      ob.remaining = Math.max(0, ob.totalOriginalObligation - ob.paid);
    });

    const totalOutstanding = totalSpent - verifiedPaid;

    return res.json({
      category: toCamelCase(category),
      participants: mappedParticipants.map((p: any) => ({ ...p, totals: participantObligations[p.id] })),
      transactions: toCamelCase(transactions),
      totals: {
        totalSpent,
        verifiedPaid,
        pendingPaid,
        outstanding: Math.max(0, totalOutstanding),
      },
    });
  }

  if (slug.length === 2 && slug[1] === "participants") {
    if (req.method !== "POST") return res.status(405).json({ error: "Metode tidak diizinkan" });

    const { participantIds, newParticipants } = req.body ?? {};

    const { data: category, error: catError } = await supabaseAdmin
      .from("categories")
      .select("id")
      .eq("id", categoryId)
      .maybeSingle();
    if (catError) return res.status(500).json({ error: catError.message });
    if (!category) return res.status(404).json({ error: "Kategori tidak ditemukan." });

    const addedIds: string[] = [];

    if (Array.isArray(participantIds)) {
      for (const pId of participantIds) {
        const { count } = await supabaseAdmin
          .from("category_participants")
          .select("id", { count: "exact", head: true })
          .eq("category_id", categoryId)
          .eq("participant_id", pId);
        if (!count) {
          const token = await getOrCreateParticipantToken(pId);
          const { error } = await supabaseAdmin.from("category_participants").insert({
            category_id: categoryId,
            participant_id: pId,
            personal_token: token,
            token_state: "Active",
          });
          if (!error) addedIds.push(pId);
        }
      }
    }

    if (Array.isArray(newParticipants)) {
      for (const np of newParticipants) {
        const { fullName, phone } = np ?? {};
        if (!fullName || !phone) continue;

        const normalized = normalizeIndonesianPhone(phone);
        let { data: participant } = await supabaseAdmin
          .from("participants")
          .select("*")
          .eq("normalized_phone", normalized)
          .maybeSingle();

        if (!participant) {
          const { data: created, error: createError } = await supabaseAdmin
            .from("participants")
            .insert({
              full_name: fullName,
              normalized_phone: normalized,
              email: np.email || "",
              nickname: np.nickname || fullName,
              notes: np.notes || "",
              introduction_state: "NeverOpened",
              created_source: "transaction",
              active: true,
            })
            .select()
            .single();
          if (createError) continue;
          participant = created;
        }

        const { count } = await supabaseAdmin
          .from("category_participants")
          .select("id", { count: "exact", head: true })
          .eq("category_id", categoryId)
          .eq("participant_id", participant.id);
        if (!count) {
          const token = await getOrCreateParticipantToken(participant.id);
          const { error } = await supabaseAdmin.from("category_participants").insert({
            category_id: categoryId,
            participant_id: participant.id,
            personal_token: token,
            token_state: "Active",
          });
          if (!error) addedIds.push(participant.id);
        }
      }
    }

    await logActivity(admin.id, "category", categoryId, "participants_linked", "admin", { addedIds });
    return res.json({ success: true, addedIds });
  }

  if (slug.length === 4 && slug[1] === "participants" && slug[3] === "regenerate-token") {
    if (req.method !== "POST") return res.status(405).json({ error: "Metode tidak diizinkan" });

    const participantId = slug[2];

    const { count, error: countError } = await supabaseAdmin
      .from("category_participants")
      .select("id", { count: "exact", head: true })
      .eq("participant_id", participantId);
    if (countError) return res.status(500).json({ error: countError.message });
    if (!count) return res.status(404).json({ error: "Data hubungan peserta-kategori tidak ditemukan." });

    const newToken = randomBytes(16).toString("hex");
    // Regenerates across ALL categories this participant belongs to, matching the
    // original "one personal token per participant" behavior — not scoped to categoryId.
    const { error } = await supabaseAdmin
      .from("category_participants")
      .update({ personal_token: newToken, token_state: "Active" })
      .eq("participant_id", participantId);
    if (error) return res.status(500).json({ error: error.message });

    await logActivity(admin.id, "token", participantId, "regenerated", "admin", { categoryId });
    return res.json({ success: true, personalToken: newToken });
  }

  res.status(404).json({ error: "Rute tidak ditemukan." });
}
