import { openNoteView } from "./note-view.js";
import { renderGraphView } from "./graph-view.js";

const app = document.getElementById("app");
const tokenKey = "wiki_note_token";
let currentToken = localStorage.getItem(tokenKey) || "";
let graphFocusTerm = "";
const draftKey = "wiki_note_draft_v1";
let currentDraft = null;

const qs = (s, root = document) => root.querySelector(s);
const esc = (s) =>
  String(s || "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const stageKey = (m) => `${m.stage}:${m.status || ""}:${m.detail || ""}`;

const api = async (path, options = {}) => {
  const headers = { ...(options.headers || {}) };
  if (currentToken) headers.authorization = `Bearer ${currentToken}`;
  const res = await fetch(path, { ...options, headers });
  if (!res.ok) throw new Error(await res.text());
  return res;
};

const renderWikiLinks = (rawHtml) =>
  String(rawHtml || "").replace(/\[\[([^[\]]+)\]\]/g, (_, term) => {
    const t = String(term || "").trim();
    if (!t) return "";
    return `<a href="#" class="wikilink" data-wikilink="${esc(t)}">[[${esc(t)}]]</a>`;
  });

const stripRenderedWikiLinks = (html) =>
  String(html || "").replace(
    /<a[^>]*class="[^"]*wikilink[^"]*"[^>]*>\s*\[\[([^[\]]+)\]\]\s*<\/a>/gi,
    (_, term) => `[[${String(term || "").trim()}]]`,
  );

const extractTitleFromHtml = (html) => {
  const m = String(html || "").match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (!m?.[1]) return "";
  return m[1]
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
};

const updateStages = (logs) => {
  const box = qs("#stageLog");
  if (!box) return;
  box.innerHTML = logs
    .map(
      (m) =>
        `<div class="stage-item"><span class="chip">${esc(m.stage)}</span><strong>${esc(
          m.status || "update",
        )}</strong><span>${esc(m.detail || "")}</span></div>`,
    )
    .join("");
  box.scrollTop = box.scrollHeight;
  const outer = box.closest(".toc");
  if (outer) outer.scrollTop = outer.scrollHeight;
};

const autoScrollMainContent = () => {
  window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
};

const persistDraft = (draft) => {
  currentDraft = draft;
  sessionStorage.setItem(draftKey, JSON.stringify(draft));
};

const readDraft = () => {
  if (currentDraft) return currentDraft;
  try {
    const raw = sessionStorage.getItem(draftKey);
    if (!raw) return null;
    currentDraft = JSON.parse(raw);
    return currentDraft;
  } catch {
    return null;
  }
};

const clearDraft = () => {
  currentDraft = null;
  sessionStorage.removeItem(draftKey);
};

function bindTopbar() {
  qs("#goHomeBtn").onclick = () => renderHome();
  qs("#goGraphBtn").onclick = () => renderGraph(graphFocusTerm || "");
  qs("#logoutBtn").onclick = () => {
    currentToken = "";
    localStorage.removeItem(tokenKey);
    updateTopbarAuthState();
    renderAuth();
  };
  updateTopbarAuthState();
}

function updateTopbarAuthState() {
  const home = qs("#goHomeBtn");
  const graph = qs("#goGraphBtn");
  const logout = qs("#logoutBtn");
  const authed = Boolean(currentToken);
  if (home) home.textContent = authed ? "Home" : "Landing";
  if (graph) graph.style.display = authed ? "inline-block" : "none";
  if (logout) logout.style.display = authed ? "inline-block" : "none";
}

function renderAuth() {
  app.innerHTML = `<div class="container landing">
    <section class="magic-hero">
      <p class="eyebrow">AI KNOWLEDGE OPERATING SYSTEM</p>
      <h1>Turn YouTube Conversations into a Living Personal Wiki</h1>
      <p class="sub">From transcript to beautifully structured wiki-notes. Streamed in real time, linked by ideas, mapped by thought.</p>
      <div class="hero-cta">
        <button id="heroSignup">Start Free</button>
        <button id="heroLogin" class="ghost">I already have an account</button>
      </div>
      <div class="hero-grid">
        <article class="value-card"><h3>Links</h3><p>Create smart bidirectional links with [[terms]] and grow your own personal Wikipedia.</p></article>
        <article class="value-card"><h3>Graph</h3><p>See hidden patterns across notes through a relationship graph based on shared concepts.</p></article>
        <article class="value-card"><h3>AI QuickView</h3><p>Get polished Chinese editorial output with TOC, sectioning, key quotes, and share-ready layout.</p></article>
      </div>
    </section>
    <section class="auth magic-auth">
      <h2>Sign up / Log in</h2><p>Build your second brain in minutes.</p>
      <input id="email" placeholder="email" />
      <input id="pwd" type="password" placeholder="password" style="margin-top:8px" />
      <div style="display:flex;gap:8px;margin-top:12px"><button id="signup">Sign up</button><button id="login" class="ghost">Log in</button></div>
    </section>
  </div>`;
  qs("#heroSignup").onclick = () => qs("#signup").click();
  qs("#heroLogin").onclick = () => qs("#login").click();
  qs("#signup").onclick = async () => auth("/api/auth/signup");
  qs("#login").onclick = async () => auth("/api/auth/login");
}

async function auth(path) {
  const email = qs("#email").value.trim();
  const password = qs("#pwd").value;
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) return alert(await res.text());
  const data = await res.json();
  currentToken = data.token;
  localStorage.setItem(tokenKey, currentToken);
  updateTopbarAuthState();
  renderHome();
}

async function renderHome() {
  if (!currentToken) return renderAuth();
  const notes = await (await api("/api/notes")).json();
  const trash = await (await api("/api/trash")).json();
  const draft = readDraft();
  app.innerHTML = `<div class="container"><section class="hero"><h1>Write Your Personal Wiki</h1><p>Paste a subtitled YouTube link. We fetch full transcript first, then stream a Chinese wiki-style HTML article.</p><div class="panel"><input id="videoUrl" placeholder="https://www.youtube.com/watch?v=..." /><textarea id="noteTitle" placeholder="Title (optional)"></textarea><button id="generateBtn">Generate (Streaming)</button></div></section>
    <section class="panel"><h3>My Notes</h3><div>${
      notes.results
        .map(
          (n) =>
            `<p><a href="#" data-note="${n.id}">${esc(n.title)}</a> <button class="ghost" data-open="${n.id}">Open</button> <button class="ghost" data-share="${n.id}">Share</button> <button class="ghost" data-delete-note="${n.id}">Delete</button></p>`,
        )
        .join("") || "No notes yet."
    }</div></section>
    ${
      draft?.html
        ? `<section class="panel"><h3>Unsaved Draft</h3><p>${esc(draft.title || "Untitled draft")} <button class="ghost" id="resumeDraftBtn">Resume Draft</button> <button class="ghost" id="discardDraftBtn">Discard Draft</button></p></section>`
        : ""
    }
    <section class="panel"><h3>Trash Bin</h3><div>${
      (trash.results || [])
        .map(
          (n) =>
            `<p>${esc(n.title)} <button class="ghost" data-restore-note="${n.id}">Restore</button> <button class="ghost" data-perma-delete-note="${n.id}">Permanently Delete</button></p>`,
        )
        .join("") || "Trash is empty."
    }</div></section></div>`;
  qs("#generateBtn").onclick = generateAndRender;
  app.querySelectorAll("[data-note]").forEach(
    (a) =>
      (a.onclick = (e) => {
        e.preventDefault();
        openNote(a.dataset.note, false);
      }),
  );
  app
    .querySelectorAll("[data-open]")
    .forEach((b) => (b.onclick = () => openNote(b.dataset.open, false)));
  app
    .querySelectorAll("[data-share]")
    .forEach((b) => (b.onclick = () => copyShareLink(b.dataset.share)));
  app
    .querySelectorAll("[data-delete-note]")
    .forEach((b) => (b.onclick = () => deleteNoteById(b.dataset.deleteNote)));
  app
    .querySelectorAll("[data-restore-note]")
    .forEach((b) => (b.onclick = () => restoreNoteById(b.dataset.restoreNote)));
  app
    .querySelectorAll("[data-perma-delete-note]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          permanentlyDeleteNoteById(b.dataset.permaDeleteNote)),
    );
  if (qs("#resumeDraftBtn")) qs("#resumeDraftBtn").onclick = () => renderDraftEditor();
  if (qs("#discardDraftBtn"))
    qs("#discardDraftBtn").onclick = () => {
      clearDraft();
      renderHome();
    };
}

function buildToc(container) {
  const heads = [...container.querySelectorAll("h1, h2, h3")];
  return heads
    .map((h, i) => {
      const id = `sec_${i + 1}`;
      h.id = id;
      const level = h.tagName.toLowerCase();
      const cls = level === "h1" ? "toc-l1" : level === "h2" ? "toc-l2" : "toc-l3";
      return `<a class="${cls}" href="#${id}">${h.textContent}</a>`;
    })
    .join("");
}

async function generateAndRender() {
  const videoUrl = qs("#videoUrl").value.trim();
  const title = qs("#noteTitle").value.trim();
  if (!videoUrl) return alert("Please paste a YouTube URL first.");

  app.innerHTML = `<div class="container"><div class="grid"><aside class="panel toc"><h3>Table of Contents</h3><div id="toc"></div><hr/><h3>Workflow Logs</h3><div id="stageLog"></div></aside><article class="panel doc"><div class="meta">AI QuickView <span class="chip">streaming</span></div><div id="live"></div><div id="genState" style="margin-top:12px;display:flex;align-items:center;gap:8px"><span class="spinner" aria-hidden="true"></span><span>Generating...</span></div><div id="saveWrap" style="margin-top:12px;display:none"><button id="saveBtn">Save Note</button></div></article></div></div>`;

  const live = qs("#live");
  const stageLogs = [];
  updateStages([{ stage: "planning", status: "start", detail: "Preparing request..." }]);

  const res = await api("/api/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ videoUrl, title }),
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let rawHtml = "";
  let prefillHtml = "";
  let hasRealChunk = false;
  const draftBase = { title: title || "AI ????", videoUrl, html: "", updatedAt: Date.now() };
  persistDraft(draftBase);
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx = buf.indexOf("\n\n");
    while (idx !== -1) {
      const packet = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      idx = buf.indexOf("\n\n");
      const line = packet.split("\n").find((x) => x.startsWith("data:"));
      if (!line) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      const msg = JSON.parse(payload);
      if (msg.type === "meta" && msg.value) {
        const prev = stageLogs[stageLogs.length - 1];
        if (!prev || stageKey(prev) !== stageKey(msg.value)) {
          stageLogs.push(msg.value);
          updateStages(stageLogs.slice(-24));
        }
        if (msg.value.prefillHtml && !hasRealChunk) {
          prefillHtml = String(msg.value.prefillHtml);
          live.innerHTML = renderWikiLinks(prefillHtml);
          qs("#toc").innerHTML = buildToc(live);
        }
      }
      if (msg.type === "chunk") {
        hasRealChunk = true;
        rawHtml += msg.value;
        live.innerHTML = renderWikiLinks(rawHtml);
        qs("#toc").innerHTML = buildToc(live);
        persistDraft({ ...draftBase, html: rawHtml, updatedAt: Date.now() });
        autoScrollMainContent();
      }
      if (msg.type === "done") {
        const htmlToSave = rawHtml || prefillHtml;
        qs("#genState").style.display = "none";
        qs("#saveWrap").style.display = "block";
        qs("#saveBtn").onclick = () => saveNote({ title: title || "", videoUrl, html: htmlToSave });
      }
      if (msg.type === "error") {
        qs("#genState").style.display = "none";
        alert(msg.value);
      }
    }
  }
}

async function saveNote(payload) {
  const res = await api("/api/notes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  clearDraft();
  openNote(data.id, false);
}

function renderDraftEditor() {
  const draft = readDraft();
  if (!draft?.html) return renderHome();
  app.innerHTML = `<div class="container"><div class="grid"><aside class="panel toc"><h3>Table of Contents</h3><div id="toc"></div><hr/><div><button class="ghost" id="toGraphFromDraft">Graph</button></div></aside><article class="panel doc"><div class="meta">Unsaved Draft <span class="chip">recoverable</span></div><div id="live">${renderWikiLinks(draft.html)}</div><div style="margin-top:12px;display:flex;gap:8px"><button id="saveDraftBtn">Save Note</button><button class="ghost" id="discardDraftBtn2">Discard Draft</button></div></article></div></div>`;
  qs("#toc").innerHTML = buildToc(qs("#live"));
  qs("#saveDraftBtn").onclick = () =>
    saveNote({ title: draft.title || "", videoUrl: draft.videoUrl, html: draft.html });
  qs("#discardDraftBtn2").onclick = () => {
    clearDraft();
    renderHome();
  };
  qs("#toGraphFromDraft").onclick = () => renderGraph("");
}

async function deleteNoteById(noteId) {
  if (!confirm("Move this note to Trash Bin? You can restore it later.")) return;
  await api(`/api/notes/${noteId}`, { method: "DELETE" });
  renderHome();
}

async function restoreNoteById(noteId) {
  await api(`/api/notes/${noteId}/restore`, { method: "POST" });
  renderHome();
}

async function permanentlyDeleteNoteById(noteId) {
  if (!confirm("Permanently delete this note from Trash? This cannot be undone.")) return;
  await api(`/api/notes/${noteId}/permanent`, { method: "DELETE" });
  renderHome();
}

async function copyShareLink(noteId) {
  const link = `${location.origin}/share/${noteId}`;
  try {
    await navigator.clipboard.writeText(link);
    alert(`Share link copied:\n${link}`);
  } catch {
    prompt("Copy this share link:", link);
  }
}

const ctx = {
  app,
  qs,
  esc,
  api,
  buildToc,
  renderWikiLinks,
  stripRenderedWikiLinks,
  extractTitleFromHtml,
  renderHome,
  renderAuth,
  saveNote,
  readDraft,
  clearDraft,
  renderDraftEditor,
  copyShareLink,
  deleteNoteById,
  getCurrentToken: () => currentToken,
  setGraphFocusTerm: (term) => {
    graphFocusTerm = String(term || "").trim();
  },
  getGraphFocusTerm: () => graphFocusTerm,
  openNote: (id, shared) => openNote(id, shared),
  renderGraph: (focusTerm = "") => renderGraph(focusTerm),
};

const openNote = (id, shared) => openNoteView(id, shared, ctx);
const renderGraph = (focusTerm = "") => renderGraphView(focusTerm, ctx);

if (location.pathname.startsWith("/share/")) {
  bindTopbar();
  openNote(location.pathname.split("/").pop(), true);
} else {
  bindTopbar();
  currentToken ? renderHome() : renderAuth();
}

function bindWikiLinkNavigation() {
  // no-op: kept for compatibility; delegated listener is registered below.
}

app.addEventListener("click", async (e) => {
  const link = e.target.closest(".wikilink[data-wikilink]");
  if (!link) return;
  e.preventDefault();
  const term = link.getAttribute("data-wikilink") || "";
  if (!term) return;
  await renderGraph(term);
});
