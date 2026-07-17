// Returns null if valid/not provided, or an error string if invalid
export async function validateVideoUrl(url) {
  if (!url) return null;

  const ALLOWED_HOSTS = ["youtube.com", "www.youtube.com", "youtu.be", "streamable.com", "www.streamable.com"];
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return "Invalid video URL.";
  }

  if (!ALLOWED_HOSTS.includes(parsed.hostname)) {
    return "Video link must be from YouTube or Streamable.";
  }

  // oEmbed existence + public check
  let oembedUrl;
  if (parsed.hostname === "streamable.com" || parsed.hostname === "www.streamable.com") {
    oembedUrl = `https://api.streamable.com/oembed.json?url=${encodeURIComponent(url)}`;
  } else {
    oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
  }

  try {
    const res = await fetch(oembedUrl, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return "Video not found or not public. Make sure the video is public and the link is correct.";
  } catch {
    // oEmbed fetch failed (network issue) — allow through rather than blocking valid submissions
    return null;
  }

  return null;
}
