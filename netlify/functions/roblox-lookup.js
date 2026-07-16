// POST { username }
// -> { rbx_user_id, rbx_username, avatar_url }
//
// Proxies to Roblox's public APIs so the browser doesn't need to deal with
// CORS, and so we can validate the username actually exists before letting
// someone claim a profile with it.

import {  json, safeHandler } from "./_lib/supabase.js";

async function handlerImpl(event) {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  let username;
  try {
    ({ username } = JSON.parse(event.body || "{}"));
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  username = (username || "").trim();
  if (!username || username.length > 20) {
    return json(400, { error: "Enter a valid Roblox username" });
  }

  try {
    const lookupRes = await fetch("https://users.roblox.com/v1/usernames/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usernames: [username], excludeBannedUsers: true }),
    });
    const lookupData = await lookupRes.json();
    const user = lookupData?.data?.[0];

    if (!user) {
      return json(404, { error: "That Roblox username doesn't exist" });
    }

    let avatar_url = null;
    try {
      const thumbRes = await fetch(
        `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${user.id}&size=150x150&format=Png&isCircular=true`
      );
      const thumbData = await thumbRes.json();
      avatar_url = thumbData?.data?.[0]?.imageUrl || null;
    } catch {
      // Avatar is a nice-to-have — don't fail profile creation if this hiccups.
    }

    return json(200, {
      rbx_user_id: user.id,
      rbx_username: user.name,
      avatar_url,
    });
  } catch (err) {
    return json(502, { error: "Couldn't reach Roblox — try again in a moment" });
  }
}

export const handler = safeHandler(handlerImpl);
