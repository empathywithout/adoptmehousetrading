// Find a profile by Roblox username, ignoring case.
//
// rbx_username is stored with Roblox's own capitalisation ("TheLazy_Bean"),
// taken from the Roblox API at signup. People type it however they like, and
// the browser's password manager saves whatever was typed in the signup
// form, so an exact match locked people out of login and password reset
// (Nov 2026: a user who signed up as "thelazy_bean" could never log back in,
// and reset quietly issued a code that could never verify). Roblox itself
// treats usernames as case-insensitive, so this matches the way people
// think about them.
//
// Returns { profile, error }. If two rows ever differ only by case, the one
// with exactly the typed capitalisation wins; otherwise no match, rather
// than guessing which account someone meant.

export async function findProfileByRobloxName(db, name, columns = "*") {
  const { data, error } = await db
    .from("profiles")
    .select(columns)
    .eqIgnoreCase("rbx_username", name);
  if (error) return { profile: null, error };
  const rows = data || [];
  if (rows.length <= 1) return { profile: rows[0] || null, error: null };
  const exact = rows.find((r) => r.rbx_username === name);
  if (!exact) console.error("[profile-lookup] ambiguous rbx_username, differs only by case:", name, rows.length);
  return { profile: exact || null, error: null };
}
