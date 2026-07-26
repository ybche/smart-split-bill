import { supabaseAdmin } from "./supabaseAdmin.js";

export type EntityType = "category" | "transaction" | "participant" | "payment" | "token" | "method" | "admin" | "database";
export type ActorType = "admin" | "participant";

export async function logActivity(
  actorId: string | null,
  entityType: EntityType,
  entityId: string,
  action: string,
  actorType: ActorType,
  metadata?: unknown
) {
  const { error } = await supabaseAdmin.from("activities").insert({
    actor_id: actorId,
    entity_type: entityType,
    entity_id: entityId,
    action,
    actor_type: actorType,
    metadata: metadata ?? null,
  });
  if (error) {
    console.error("logActivity failed:", error.message);
  }
}
