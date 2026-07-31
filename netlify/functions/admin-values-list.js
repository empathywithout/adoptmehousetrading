// GET — admin only, returns all computed item values
import { supabaseAdmin, requireAdmin, json, safeHandler } from "./_lib/supabase.js";

async function handlerImpl(event) {
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });
  if (!requireAdmin(event)) return json(403, { error: "Forbidden" });

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("item_values")
    .select("*")
    .eq("source", "computed")
    .order("value_high", { ascending: false });

  if (error) return json(500, { error: error.message });
  return json(200, { values: data || [] });
}

export const handler = safeHandler(handlerImpl);
