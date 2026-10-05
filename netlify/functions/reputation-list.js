// GET -> { reputation: { "<profile_id>": { t, h, b, c } } }
//
// One site-wide map, CDN-cached, fetched once per page. Cards then look
// people up locally instead of asking the server per avatar. Profiles with
// nothing to show are omitted, so this stays small.
//
//   t = verified trades        h = hearts received on builds
//   b = builds registered      c = commissions completed

import { supabaseAdmin, publicJson, json, safeHandler } from "./_lib/supabase.js";
import { getReputationMap } from "./_lib/reputation.js";

async function handlerImpl(event) {
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });
  const map = await getReputationMap(supabaseAdmin());
  return publicJson(200, { reputation: map }, 300);
}

export const handler = safeHandler(handlerImpl);
