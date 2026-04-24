import { json, html, text } from "./lib/response.js";
import { pageHtml } from "./frontend/templates.js";
import { sha256, requireUser } from "./lib/auth.js";
import { fetchFullTranscriptFromService } from "./lib/transcript-service.js";
import { streamGeminiHtml } from "./lib/gemini.js";
import { extractWikiLinks } from "./lib/note-links.js";
import {
  createUser,
  getUserByEmail,
  createSession,
  createNote,
  updateNote,
  getNote,
  listMyNotes,
  deleteNote,
  listNotesForTermMutation,
  listTrashNotes,
  restoreNote,
  permanentlyDeleteNote
} from "./repo.js";

const sse = (stream) =>
  new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive"
    }
  });

const err = (e, code = 400) => text(e?.message || String(e), code);

const deriveTitle = ({ preferredTitle, htmlContent, videoUrl }) => {
  const manual = String(preferredTitle || "").trim();
  if (manual) return manual.slice(0, 120);

  const h1 = String(htmlContent || "").match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1?.[1]) {
    const plain = h1[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (plain) return plain.slice(0, 120);
  }

  const vid = (() => {
    try {
      const u = new URL(videoUrl || "");
      return u.searchParams.get("v") || u.pathname.replace("/", "");
    } catch {
      return "note";
    }
  })();
  return `AI笔记-${vid}-${new Date().toISOString().slice(5, 16).replace("T", " ")}`;
};

const buildPrefillHtml = ({ title, transcript }) => {
  const plain = String(transcript || "").replace(/\s+/g, " ").trim();
  const teaser = plain.slice(0, 240);
  const safeTitle = String(title || "AI 对话笔记预览").replace(/[<>]/g, "");
  const safeTeaser = teaser.replace(/[<>]/g, "");
  return `<h1>${safeTitle}</h1>
<div class="ai-quickview">
  正在基于完整字幕生成结构化文章（Table of Contents / 观点提炼 / 双链词条）。先给你一个快速预览：${safeTeaser}${plain.length > 240 ? "..." : ""}
</div>
<h2>生成中</h2>
<p>已完成字幕解析，正在进行语义重组与排版。内容将持续流式到达。</p>`;
};

const ensureDb = (env) => {
  if (!env?.DB && !env?.wiki_note) {
    throw new Error("D1 database is not bound. Check wrangler.toml d1_databases config.");
  }
};
const ensureSoftDeleteColumn = async (env) => {
  try {
    await env.DB.prepare("ALTER TABLE notes ADD COLUMN deleted_at TEXT").run();
  } catch {
    // already exists
  }
};

export default {
  async fetch(request, env) {
    const runtimeEnv = { ...env, DB: env.DB || env.wiki_note };
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === "/" || pathname.startsWith("/share/")) return html(pageHtml);

    if (request.method === "POST" && pathname === "/api/auth/signup") {
      try {
        ensureDb(runtimeEnv);
        await ensureSoftDeleteColumn(runtimeEnv);
        const { email, password } = await request.json();
        if (!email || !password) return err(new Error("email/password required"));
        if (await getUserByEmail(runtimeEnv, email)) return err(new Error("email already exists"), 409);
        const user = await createUser(runtimeEnv, email, await sha256(password));
        const token = await createSession(runtimeEnv, user.id);
        return json({ token, user });
      } catch (e) {
        return err(e);
      }
    }

    if (request.method === "POST" && pathname === "/api/auth/login") {
      try {
        ensureDb(runtimeEnv);
        await ensureSoftDeleteColumn(runtimeEnv);
        const { email, password } = await request.json();
        const user = await getUserByEmail(runtimeEnv, email);
        if (!user) return err(new Error("user not found"), 404);
        const pass = await sha256(password);
        if (pass !== user.password_hash) return err(new Error("invalid password"), 401);
        const token = await createSession(runtimeEnv, user.id);
        return json({ token, user: { id: user.id, email: user.email } });
      } catch (e) {
        return err(e);
      }
    }

    if (request.method === "POST" && pathname === "/api/transcript") {
      try {
        ensureDb(runtimeEnv);
        await ensureSoftDeleteColumn(runtimeEnv);
        const user = await requireUser(request, runtimeEnv);
        if (!user) return err(new Error("unauthorized"), 401);
        const { videoUrl, title } = await request.json();
        if (!videoUrl) return err(new Error("videoUrl required"));

        const result = await fetchFullTranscriptFromService({ env: runtimeEnv, videoUrl });
        return json({
          videoId: result.videoId,
          language: result.language,
          source: result.source,
          transcriptLength: result.transcript.length,
          transcript: result.transcript
        });
      } catch (e) {
        return err(e);
      }
    }

    if (request.method === "POST" && pathname === "/api/generate") {
      try {
        ensureDb(runtimeEnv);
        await ensureSoftDeleteColumn(runtimeEnv);
        const user = await requireUser(request, runtimeEnv);
        if (!user) return err(new Error("unauthorized"), 401);
        const { videoUrl, title } = await request.json();
        if (!videoUrl) return err(new Error("videoUrl required"));

        const stream = new ReadableStream({
          async start(controller) {
            const encoder = new TextEncoder();
            const push = (obj) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
            try {
              push({ type: "meta", value: { stage: "planning", status: "start", detail: "Input received, building task plan." } });
              push({ type: "meta", value: { stage: "execution", status: "start", detail: "Fetching full transcript from stage-1 service." } });
              const transcriptResult = await fetchFullTranscriptFromService({ env: runtimeEnv, videoUrl });
              push({
                type: "meta",
                value: {
                  stage: "transcript_ready",
                  videoId: transcriptResult.videoId,
                  language: transcriptResult.language,
                  source: transcriptResult.source,
                  length: transcriptResult.transcript.length
                }
              });
              push({
                type: "meta",
                value: {
                  stage: "execution",
                  status: "prefill",
                  detail: "Rendering instant draft preview while waiting for model tokens.",
                  prefillHtml: buildPrefillHtml({
                    title: String(title || "").trim() || "AI 对话笔记",
                    transcript: transcriptResult.transcript
                  })
                }
              });
              push({ type: "meta", value: { stage: "execution", status: "start", detail: "Transcript ready, starting LLM streaming." } });

              let generated = "";
              await streamGeminiHtml({
                apiKey: runtimeEnv.GEMINI_API_KEY,
                model: runtimeEnv.GEMINI_MODEL,
                transcript: transcriptResult.transcript,
                onStage: (m) => push({ type: "meta", value: m }),
                onChunk: (chunk) => {
                  generated += chunk;
                  push({ type: "chunk", value: chunk });
                }
              });
              push({ type: "done", value: { size: generated.length } });
            } catch (e) {
              push({ type: "error", value: e.message || String(e) });
            } finally {
              controller.close();
            }
          }
        });
        return sse(stream);
      } catch (e) {
        return err(e);
      }
    }

    if (request.method === "GET" && pathname === "/api/notes") {
      try {
        ensureDb(runtimeEnv);
        await ensureSoftDeleteColumn(runtimeEnv);
      } catch (e) {
        return err(e, 500);
      }
      const user = await requireUser(request, runtimeEnv);
      if (!user) return err(new Error("unauthorized"), 401);
      const rows = await listMyNotes(runtimeEnv, user.id);
      return json({
        results: (rows?.results || []).map((n) => ({
          ...n,
          links: JSON.parse(n.links_json || "[]")
        }))
      });
    }

    if (request.method === "POST" && pathname === "/api/notes") {
      try {
        ensureDb(runtimeEnv);
        await ensureSoftDeleteColumn(runtimeEnv);
      } catch (e) {
        return err(e, 500);
      }
      const user = await requireUser(request, runtimeEnv);
      if (!user) return err(new Error("unauthorized"), 401);
      const { title, videoUrl, html: noteHtml } = await request.json();
      const quickview = noteHtml.replace(/<[^>]+>/g, " ").slice(0, 180);
      const links = extractWikiLinks(noteHtml);
      const finalTitle = deriveTitle({ preferredTitle: title, htmlContent: noteHtml, videoUrl });
      const id = await createNote(runtimeEnv, {
        userId: user.id,
        title: finalTitle,
        videoUrl,
        html: noteHtml,
        quickview,
        links
      });
      return json({ id });
    }

    if (request.method === "GET" && pathname === "/api/trash") {
      try {
        ensureDb(runtimeEnv);
        await ensureSoftDeleteColumn(runtimeEnv);
      } catch (e) {
        return err(e, 500);
      }
      const user = await requireUser(request, runtimeEnv);
      if (!user) return err(new Error("unauthorized"), 401);
      const rows = await listTrashNotes(runtimeEnv, user.id);
      return json({ results: rows?.results || [] });
    }

    if (request.method === "GET" && pathname.startsWith("/api/notes/")) {
      try {
        ensureDb(runtimeEnv);
        await ensureSoftDeleteColumn(runtimeEnv);
      } catch (e) {
        return err(e, 500);
      }
      const user = await requireUser(request, runtimeEnv);
      if (!user) return err(new Error("unauthorized"), 401);
      const id = pathname.replace("/api/notes/", "");
      const note = await getNote(runtimeEnv, id);
      if (!note || note.user_id !== user.id || note.deleted_at) return err(new Error("note not found"), 404);
      return json({ ...note, links: JSON.parse(note.links_json || "[]") });
    }

    if (request.method === "PUT" && pathname.startsWith("/api/notes/")) {
      try {
        ensureDb(runtimeEnv);
        await ensureSoftDeleteColumn(runtimeEnv);
      } catch (e) {
        return err(e, 500);
      }
      const user = await requireUser(request, runtimeEnv);
      if (!user) return err(new Error("unauthorized"), 401);
      const id = pathname.replace("/api/notes/", "");
      const note = await getNote(runtimeEnv, id);
      if (!note || note.user_id !== user.id || note.deleted_at) return err(new Error("note not found"), 404);
      const { html: noteHtml, title } = await request.json();
      const links = extractWikiLinks(noteHtml);
      const quickview = noteHtml.replace(/<[^>]+>/g, " ").slice(0, 180);
      const nextTitle = String(title || "").trim() || note.title;
      await updateNote(runtimeEnv, id, user.id, { title: nextTitle, html: noteHtml, quickview, links });
      return json({ ok: true });
    }

    if (request.method === "DELETE" && pathname.startsWith("/api/notes/")) {
      try {
        ensureDb(runtimeEnv);
        await ensureSoftDeleteColumn(runtimeEnv);
      } catch (e) {
        return err(e, 500);
      }
      const user = await requireUser(request, runtimeEnv);
      if (!user) return err(new Error("unauthorized"), 401);
      const id = pathname.replace("/api/notes/", "");
      await deleteNote(runtimeEnv, id, user.id);
      return json({ ok: true });
    }

    if (request.method === "POST" && pathname.startsWith("/api/notes/") && pathname.endsWith("/restore")) {
      try {
        ensureDb(runtimeEnv);
        await ensureSoftDeleteColumn(runtimeEnv);
      } catch (e) {
        return err(e, 500);
      }
      const user = await requireUser(request, runtimeEnv);
      if (!user) return err(new Error("unauthorized"), 401);
      const id = pathname.replace("/api/notes/", "").replace("/restore", "");
      await restoreNote(runtimeEnv, id, user.id);
      return json({ ok: true });
    }

    if (request.method === "DELETE" && pathname.startsWith("/api/notes/") && pathname.endsWith("/permanent")) {
      try {
        ensureDb(runtimeEnv);
        await ensureSoftDeleteColumn(runtimeEnv);
      } catch (e) {
        return err(e, 500);
      }
      const user = await requireUser(request, runtimeEnv);
      if (!user) return err(new Error("unauthorized"), 401);
      const id = pathname.replace("/api/notes/", "").replace("/permanent", "");
      await permanentlyDeleteNote(runtimeEnv, id, user.id);
      return json({ ok: true });
    }

    if (request.method === "DELETE" && pathname === "/api/graph/term") {
      try {
        ensureDb(runtimeEnv);
        await ensureSoftDeleteColumn(runtimeEnv);
      } catch (e) {
        return err(e, 500);
      }
      const user = await requireUser(request, runtimeEnv);
      if (!user) return err(new Error("unauthorized"), 401);
      const term = (url.searchParams.get("name") || "").trim();
      if (!term) return err(new Error("term name required"), 400);

      const rows = await listNotesForTermMutation(runtimeEnv, user.id);
      const notes = rows?.results || [];
      let affectedNotes = 0;
      const token = `[[${term}]]`;
      for (const n of notes) {
        if (!String(n.html || "").includes(token)) continue;
        const html = String(n.html || "").split(token).join(term);
        const links = extractWikiLinks(html);
        const quickview = html.replace(/<[^>]+>/g, " ").slice(0, 180);
        await updateNote(runtimeEnv, n.id, user.id, {
          title: n.title,
          html,
          quickview,
          links
        });
        affectedNotes += 1;
      }
      return json({ ok: true, term, affectedNotes });
    }

    if (request.method === "GET" && pathname.startsWith("/api/share/")) {
      try {
        ensureDb(runtimeEnv);
        await ensureSoftDeleteColumn(runtimeEnv);
      } catch (e) {
        return err(e, 500);
      }
      const id = pathname.replace("/api/share/", "");
      const note = await getNote(runtimeEnv, id);
      if (!note || note.deleted_at) return err(new Error("note not found"), 404);
      return json({ ...note, links: JSON.parse(note.links_json || "[]") });
    }

    if (!pathname.startsWith("/api") && runtimeEnv.ASSETS) return runtimeEnv.ASSETS.fetch(request);
    return text("Not found", 404);
  }
};
