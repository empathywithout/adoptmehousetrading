// Shared listing lifecycle constants.
//
// EXPIRE_DAYS lived in listings-list.js, and profile.html carried its own
// hardcoded 30 with a comment saying it mirrored that one. Two copies of a
// number that must agree is the shape of bug this project keeps hitting, so
// the server-side copies now come from here. (profile.html can't import a
// Netlify function, so its copy stays — but it is the only one left, and the
// comment there points at this file.)

// An active listing stops appearing in Browse this many days after its last
// create, edit or renewal. Expiry is derived from updated_at; there is no
// status change and no schema column for it.
export const EXPIRE_DAYS = 30;
