// Recognising rows created by the admin stress and smoke tests.
//
// Those tests run against the live database because there is no staging
// environment. They clean up some of what they make and leave the rest, so
// test accounts and their listings, trades and builds end up mixed in with
// real ones. A "Pending Test House" by StressA_1791132368213 was sitting on
// Browse with a verified-trade badge, and its trade was being counted in
// everyone's reputation totals.
//
// Kept in one place so a new surface cannot forget to filter: trades-list,
// listings-list and the reputation map all use these.

const TEST_NAME_RE = /^(Stress[AB]|Intruder|UploadTest|SmokeTest)_\d+$/;

// Titles the tests use. Anchored at the start so a real build called
// something like "stress free cottage" is not caught by accident.
const TEST_TITLE_RE = /^(upload |pending )?(stress|smoke) test\b/i;

export function isTestDisplayName(name) {
  return TEST_NAME_RE.test(String(name || ""));
}

export function isTestTitle(title) {
  return TEST_TITLE_RE.test(String(title || ""));
}

// True when a row looks like test output by either its title or the display
// name of anyone attached to it.
export function isTestRow({ title, names = [] } = {}) {
  if (isTestTitle(title)) return true;
  return names.some(isTestDisplayName);
}
