// Scheduled once a day (see [functions."rebuild-site"] in netlify.toml).
//
// The house pages now carry this site's own listings and verified trades,
// baked in at build time by scripts/lib/house-stats.mjs. That is deliberate —
// a crawler hitting 54 generated files costs nothing, where rendering them on
// request would wake Neon compute on every crawl, and compute is billed per
// CU-hour. The trade-off is that the data is only as fresh as the last
// deploy, which otherwise means "whenever someone happens to push".
//
// So this triggers a build once a day. It needs BUILD_HOOK_URL set to a
// Netlify build hook (Site configuration -> Build & deploy -> Build hooks).
// Without it this is a no-op that logs and returns: better a stale page than
// a scheduled function that fails loudly every night for a missing setting.

const HOOK_ENV = "BUILD_HOOK_URL";

export const handler = async () => {
  const hook = process.env[HOOK_ENV];
  if (!hook) {
    console.log(`[rebuild-site] ${HOOK_ENV} is not set — skipping. House pages will refresh on the next push instead.`);
    return { statusCode: 200, body: "skipped: no build hook configured" };
  }

  // A build hook is a plain POST with no body; it is the URL itself that
  // authorises it, which is why it belongs in an env var and not in the repo.
  if (!/^https:\/\/api\.netlify\.com\/build_hooks\//.test(hook)) {
    console.error(`[rebuild-site] ${HOOK_ENV} does not look like a Netlify build hook — refusing to POST to it.`);
    return { statusCode: 500, body: "refused: unexpected hook URL" };
  }

  try {
    const res = await fetch(hook, { method: "POST" });
    if (!res.ok) {
      console.error(`[rebuild-site] build hook returned ${res.status}`);
      return { statusCode: 502, body: `hook returned ${res.status}` };
    }
    console.log("[rebuild-site] triggered a rebuild so the house pages pick up today's listings and trades");
    return { statusCode: 200, body: "triggered" };
  } catch (err) {
    console.error("[rebuild-site] could not reach the build hook:", err.message);
    return { statusCode: 502, body: "hook unreachable" };
  }
};
