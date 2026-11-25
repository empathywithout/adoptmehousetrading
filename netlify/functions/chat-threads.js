// GET, Authorization: Bearer <token>
// -> { threads: [{ context_type, context_id, title, link, status, counterparty: { display_name, rbx_avatar_url },
//                  last: { preset_key, mine, created_at } | null, updated_at }] }
//
// Every trade chat the signed-in person is part of, newest activity first,
// for the Messages page (messages.html). Chat only exists once an offer is
// accepted or a commission is accepted or later, the same rule chat-list.js
// and chat-send.js enforce, so only those are listed. The messages
// themselves are still fetched per thread through chat-list.js, which does
// its own party and status checks.

import { supabaseAdmin, requireProfile, json, safeHandler } from "./_lib/supabase.js";

const OFFER_OPEN = ["accepted"];
const COMMISSION_OPEN = ["accepted", "delivered", "verified"];
const MAX_THREADS = 100;

async function handlerImpl(event) {
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });

  const profile = await requireProfile(event);
  if (!profile) return json(401, { error: "Not signed in" });

  const db = supabaseAdmin();
  const me = profile.id;

  // Offers I made, and offers on my listings. Two queries rather than an OR
  // across a join, which the query shim doesn't do.
  const { data: myListings, error: lErr } = await db.from("listings").select("id").eq("profile_id", me);
  if (lErr) return json(500, { error: "Couldn't load your conversations" });
  const myListingIds = (myListings || []).map((l) => l.id);

  const offerSelect = "id, status, created_at, listing_id, offering_profile_id, listings(id, title, profile_id)";
  const commSelect = "id, status, created_at, description, builder_profile_id, requester_profile_id";
  const [madeRes, receivedRes, buildingRes, requestedRes] = await Promise.all([
    db.from("offers").select(offerSelect).eq("offering_profile_id", me).in("status", OFFER_OPEN),
    myListingIds.length
      ? db.from("offers").select(offerSelect).in("listing_id", myListingIds).in("status", OFFER_OPEN)
      : Promise.resolve({ data: [] }),
    db.from("commission_requests").select(commSelect).eq("builder_profile_id", me).in("status", COMMISSION_OPEN),
    db.from("commission_requests").select(commSelect).eq("requester_profile_id", me).in("status", COMMISSION_OPEN),
  ]);
  const anyErr = madeRes.error || receivedRes.error || buildingRes.error || requestedRes.error;
  if (anyErr) {
    console.error("[chat-threads]", anyErr);
    return json(500, { error: "Couldn't load your conversations" });
  }
  const commRes = { data: [...(buildingRes.data || []), ...(requestedRes.data || [])] };

  const threads = [];
  const seenOffers = new Set();
  for (const o of [...(madeRes.data || []), ...(receivedRes.data || [])]) {
    if (seenOffers.has(o.id)) continue;
    seenOffers.add(o.id);
    const lister = o.listings?.profile_id;
    threads.push({
      context_type: "offer",
      context_id: o.id,
      title: o.listings?.title || "Trade",
      link: `listings/listing.html?id=${o.listing_id}`,
      status: o.status,
      counterparty_id: o.offering_profile_id === me ? lister : o.offering_profile_id,
      created_at: o.created_at,
    });
  }
  for (const c of commRes.data || []) {
    if (c.builder_profile_id !== me && c.requester_profile_id !== me) continue;
    const iAmBuilder = c.builder_profile_id === me;
    threads.push({
      context_type: "commission",
      context_id: c.id,
      title: iAmBuilder ? "Commission you're building" : "Your commission",
      subtitle: String(c.description || "").slice(0, 80),
      link: "profile.html",
      status: c.status,
      counterparty_id: iAmBuilder ? c.requester_profile_id : c.builder_profile_id,
      created_at: c.created_at,
    });
  }

  if (!threads.length) return json(200, { threads: [] });

  const ids = threads.map((t) => t.context_id);
  const cpIds = [...new Set(threads.map((t) => t.counterparty_id).filter(Boolean))];
  const [msgRes, cpRes] = await Promise.all([
    db
      .from("trade_chat_messages")
      .select("context_type, context_id, sender_profile_id, preset_key, created_at")
      .in("context_id", ids)
      .order("created_at", { ascending: false })
      .limit(2000),
    cpIds.length
      ? db.from("profiles").select("id, display_name, rbx_avatar_url").in("id", cpIds)
      : Promise.resolve({ data: [] }),
  ]);
  if (msgRes.error) {
    console.error("[chat-threads] messages", msgRes.error);
    return json(500, { error: "Couldn't load your conversations" });
  }

  // Newest message per thread: rows are newest first, so the first one wins.
  const last = new Map();
  for (const m of msgRes.data || []) {
    const key = `${m.context_type}:${m.context_id}`;
    if (!last.has(key)) last.set(key, m);
  }
  const cpById = new Map((cpRes.data || []).map((p) => [p.id, p]));

  const out = threads
    .map((t) => {
      const m = last.get(`${t.context_type}:${t.context_id}`);
      const cp = cpById.get(t.counterparty_id);
      const { counterparty_id, ...rest } = t;
      return {
        ...rest,
        counterparty: cp ? { display_name: cp.display_name, rbx_avatar_url: cp.rbx_avatar_url } : null,
        last: m ? { preset_key: m.preset_key, mine: m.sender_profile_id === me, created_at: m.created_at } : null,
        updated_at: m?.created_at || t.created_at,
      };
    })
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
    .slice(0, MAX_THREADS);

  return json(200, { threads: out });
}

export const handler = safeHandler(handlerImpl);
