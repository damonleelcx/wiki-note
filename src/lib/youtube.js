const decodeEntities = (s) =>
  s
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&#39;", "'")
    .replaceAll("&quot;", '"');

const cleanLine = (s) =>
  decodeEntities(String(s || ""))
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();

const parseVtt = (vtt) =>
  String(vtt || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(
      (l) =>
        l &&
        !l.startsWith("WEBVTT") &&
        !/^\d+$/.test(l) &&
        !/^\d{2}:\d{2}:\d{2}\.\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}\.\d{3}/.test(l) &&
        !/^\d{2}:\d{2}\.\d{3}\s+-->\s+\d{2}:\d{2}\.\d{3}/.test(l)
    )
    .map(cleanLine)
    .filter(Boolean);

const looksLikeErrorTranscript = (text) => {
  const t = String(text || "").toLowerCase();
  const patterns = [
    "we're sorry",
    "we are sorry",
    "unable to retrieve",
    "could not retrieve",
    "transcript unavailable",
    "youtube is blocking",
    "blocked us from getting the transcript",
    "字幕为空",
    "无法读取字幕",
    "无法获取字幕"
  ];
  return patterns.some((p) => t.includes(p));
};

const isUsableTranscript = (text) => {
  const t = String(text || "").trim();
  if (t.length < 300) return false;
  if (looksLikeErrorTranscript(t)) return false;
  const lines = t.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  return lines.length >= 12;
};

export const getVideoId = (url) => {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1);
    if (u.searchParams.get("v")) return u.searchParams.get("v");
    return null;
  } catch {
    return null;
  }
};

export const fetchTranscript = async (videoUrl) => {
  const videoId = getVideoId(videoUrl);
  if (!videoId) throw new Error("无法解析 YouTube 视频 ID。");

  const watchRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: { "user-agent": "Mozilla/5.0" }
  });
  if (!watchRes.ok) throw new Error("访问 YouTube 页面失败。");
  const watchHtml = await watchRes.text();

  const readXml = (xml) => {
    const src = String(xml || "");
    const out = [];
    for (const m of src.matchAll(/<(text|p)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
      out.push(cleanLine(m[2]));
    }
    return out.filter(Boolean);
  };
  const readJson3 = (txt) => {
    const safe = String(txt || "").trim().replace(/^\)\]\}'\s*/, "");
    const j = JSON.parse(safe);
    return (j.events || [])
      .flatMap((e) => (e.segs || []).map((s) => cleanLine(s.utf8)))
      .filter(Boolean);
  };
  const tryTrackUrls = async (urls, debug) => {
    for (const u of urls) {
      try {
        const r = await fetch(u, { headers: { "user-agent": "Mozilla/5.0" } });
        if (!r.ok) {
          debug.push(`bad_status:${r.status}`);
          continue;
        }
        const raw = await r.text();
        const lines = u.includes("json3") ? readJson3(raw) : u.includes("fmt=vtt") ? parseVtt(raw) : readXml(raw);
        const transcript = lines.join("\n").trim();
        debug.push(`ok:${u.includes("fmt=") ? u.split("fmt=")[1].split("&")[0] : "xml"}:${transcript.length}`);
        if (isUsableTranscript(transcript)) return transcript;
      } catch (e) {
        debug.push(`err:${e?.message || "unknown"}`);
        // continue
      }
    }
    return "";
  };
  const debug = [];

  // 1) Most stable: timedtext list API.
  const listCandidates = [
    `https://video.google.com/timedtext?type=list&v=${videoId}`,
    `https://www.youtube.com/api/timedtext?type=list&v=${videoId}`
  ];
  for (const listUrl of listCandidates) {
    try {
      const r = await fetch(listUrl, { headers: { "user-agent": "Mozilla/5.0" } });
      if (!r.ok) continue;
      const xml = await r.text();
      const tracks = [...xml.matchAll(/<track\s+([^>]+?)\/>/g)].map((m) => m[1]);
      const parsed = tracks.map((attrs) => {
        const get = (k) => (attrs.match(new RegExp(`${k}="([^"]*)"`, "i")) || [])[1] || "";
        return {
          lang: get("lang_code"),
          name: get("name"),
          kind: get("kind")
        };
      });
      if (!parsed.length) continue;

      const ordered = [
        ...parsed.filter((t) => t.lang.startsWith("zh") && t.kind !== "asr"),
        ...parsed.filter((t) => t.lang.startsWith("zh")),
        ...parsed.filter((t) => t.lang === "en" && t.kind !== "asr"),
        ...parsed
      ];
      const uniq = [];
      const seen = new Set();
      for (const t of ordered) {
        const key = `${t.lang}|${t.name}|${t.kind}`;
        if (!seen.has(key)) {
          seen.add(key);
          uniq.push(t);
        }
      }

      for (const t of uniq) {
        const base = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${encodeURIComponent(
          t.lang
        )}${t.name ? `&name=${encodeURIComponent(t.name)}` : ""}${t.kind ? `&kind=${encodeURIComponent(t.kind)}` : ""}`;
        const transcript = await tryTrackUrls([`${base}&fmt=srv3`, `${base}&fmt=json3`, `${base}&fmt=vtt`, base], debug);
        if (transcript) return { videoId, transcript };

        // translate fallback into Chinese when source language is not zh
        if (!t.lang.startsWith("zh")) {
          const zhBase = `${base}&tlang=zh-Hans`;
          const zhTranscript = await tryTrackUrls(
            [`${zhBase}&fmt=srv3`, `${zhBase}&fmt=json3`, `${zhBase}&fmt=vtt`, zhBase],
            debug
          );
          if (isUsableTranscript(zhTranscript)) return { videoId, transcript: zhTranscript };
        }
      }
    } catch {
      // fallback to player response path
    }
  }

  // 2) Fallback: parse player response from watch page.
  const playerMarkers = ["ytInitialPlayerResponse = ", "var ytInitialPlayerResponse = "];
  let playerJson = "";
  for (const mk of playerMarkers) {
    const pIdx = watchHtml.indexOf(mk);
    if (pIdx === -1) continue;
    const pStart = pIdx + mk.length;
    const pEnd = watchHtml.indexOf(";</script>", pStart);
    if (pEnd === -1) continue;
    playerJson = watchHtml.slice(pStart, pEnd).trim();
    if (playerJson) break;
  }
  if (!playerJson) {
    // embed fallback
    try {
      const embedRes = await fetch(`https://www.youtube.com/embed/${videoId}`, {
        headers: { "user-agent": "Mozilla/5.0" }
      });
      const embedHtml = await embedRes.text();
      for (const mk of playerMarkers) {
        const pIdx = embedHtml.indexOf(mk);
        if (pIdx === -1) continue;
        const pStart = pIdx + mk.length;
        const pEnd = embedHtml.indexOf(";</script>", pStart);
        if (pEnd === -1) continue;
        playerJson = embedHtml.slice(pStart, pEnd).trim();
        if (playerJson) break;
      }
    } catch {
      // ignore
    }
  }
  if (!playerJson) throw new Error("未找到字幕轨道，视频可能没有公开字幕。");

  let tracks = [];
  try {
    const player = JSON.parse(playerJson);
    tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  } catch {
    // fallback to legacy marker
    const marker = '"captionTracks":';
    const idx = watchHtml.indexOf(marker);
    if (idx !== -1) {
      const start = idx + marker.length;
      const tail = watchHtml.slice(start, start + 12000);
      const close = tail.indexOf("]");
      if (close !== -1) {
        const jsonRaw = tail.slice(0, close + 1);
        tracks = JSON.parse(jsonRaw);
      }
    }
  }
  if (!tracks.length) throw new Error("未找到字幕轨道，视频可能没有公开字幕。");

  const zhTrack =
    tracks.find((t) => t.languageCode?.startsWith("zh") && !t.kind) ||
    tracks.find((t) => t.languageCode?.startsWith("zh")) ||
    tracks.find((t) => !t.kind) ||
    tracks[0];
  if (!zhTrack?.baseUrl) throw new Error("没有可用字幕轨道。");

  const candidates = [
    `${zhTrack.baseUrl}&fmt=srv3`,
    `${zhTrack.baseUrl}&fmt=json3`,
    `${zhTrack.baseUrl}&fmt=vtt`,
    zhTrack.baseUrl
  ];
  const transcript = await tryTrackUrls(candidates, debug);
  if (isUsableTranscript(transcript)) return { videoId, transcript };

  // 3) Final fallback: public transcript mirror service.
  const parseAltPayload = (raw) => {
    const txt = String(raw || "").trim();
    if (!txt) return "";
    if (txt.startsWith("<")) {
      const lines = readXml(txt);
      return lines.join("\n").trim();
    }
    const safe = txt.replace(/^\)\]\}'\s*/, "");
    const arr = JSON.parse(safe);
    const lines = Array.isArray(arr) ? arr.map((x) => cleanLine(x?.text)).filter(Boolean) : [];
    return lines.join("\n").trim();
  };
  const altUrls = [
    `https://youtubetranscript.com/?server_vid2=${encodeURIComponent(videoId)}`,
    `https://youtubetranscript.com/?format=json&video_id=${encodeURIComponent(videoId)}`
  ];
  for (const altUrl of altUrls) {
    try {
      const alt = await fetch(altUrl, {
        headers: { "user-agent": "Mozilla/5.0", accept: "application/json,text/plain,application/xml,*/*" }
      });
      if (!alt.ok) {
        debug.push(`alt_bad_status:${alt.status}`);
        continue;
      }
      const raw = await alt.text();
      const out = parseAltPayload(raw);
      if (isUsableTranscript(out)) return { videoId, transcript: out };
      debug.push(`alt_ok:${out.length}`);
    } catch (e) {
      debug.push(`alt_err:${e?.message || "unknown"}`);
    }
  }

  throw new Error(`字幕为空或无法读取（或返回了错误模板文本）。请重试稍后再试，或提供可用字幕文本。debug=${debug.slice(0, 8).join("|")}`);
};
