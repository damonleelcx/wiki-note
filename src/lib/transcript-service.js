import { getVideoId } from "./youtube.js";

const isUsableTranscript = (text) => {
  const t = String(text || "").trim();
  if (t.length < 300) return false;
  const lines = t.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  return lines.length >= 8;
};

const toPlainText = (payload) => {
  if (typeof payload === "string") return payload.trim();
  const items = Array.isArray(payload?.transcript) ? payload.transcript : [];
  return items.map((x) => String(x?.text || "").trim()).filter(Boolean).join("\n").trim();
};

export const fetchFullTranscriptFromService = async ({ env, videoUrl }) => {
  const videoId = getVideoId(videoUrl) || String(videoUrl || "").trim();
  if (!videoId) throw new Error("Unable to parse YouTube video URL or ID.");

  const apiKey = env.TRANSCRIPT_API_KEY || env.TRANSCRIPT_SERVICE_TOKEN;
  if (!apiKey) throw new Error("Missing TRANSCRIPT_API_KEY.");

  const baseUrl = env.TRANSCRIPT_API_BASE_URL || "https://transcriptapi.com/api/v2/youtube/transcript";
  const url = new URL(baseUrl);
  url.searchParams.set("video_url", videoId);
  url.searchParams.set("format", "json");
  url.searchParams.set("include_timestamp", "false");
  url.searchParams.set("send_metadata", "true");

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      authorization: `Bearer ${apiKey}`,
      accept: "application/json,text/plain,*/*"
    },
    cf: { cacheTtl: 0, cacheEverything: false }
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Transcript API failed: ${res.status} ${detail}`);
  }

  const contentType = res.headers.get("content-type") || "";
  const cacheStatus = res.headers.get("x-cache-status") || "UNKNOWN";
  let payload;
  if (contentType.includes("application/json")) {
    payload = await res.json();
  } else {
    payload = await res.text();
  }

  const transcript = toPlainText(payload);
  if (!isUsableTranscript(transcript)) {
    throw new Error("Transcript API returned insufficient transcript content.");
  }

  return {
    videoId: typeof payload === "object" ? payload?.video_id || videoId : videoId,
    transcript,
    language: typeof payload === "object" ? payload?.language || "unknown" : "unknown",
    source: `transcriptapi.com/${cacheStatus.toLowerCase()}`,
    metadata: typeof payload === "object" ? payload?.metadata || null : null
  };
};

