const app = document.getElementById("app");
const tokenKey = "wiki_note_token";
let currentToken = localStorage.getItem(tokenKey) || "";
let graphFocusTerm = "";
const draftKey = "wiki_note_draft_v1";
let currentDraft = null;

const api = async (path, options = {}) => {
  const headers = { ...(options.headers || {}) };
  if (currentToken) headers.authorization = `Bearer ${currentToken}`;
  const res = await fetch(path, { ...options, headers });
  if (!res.ok) throw new Error(await res.text());
  return res;
};

const qs = (s, root = document) => root.querySelector(s);
const esc = (s) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const stageKey = (m) => `${m.stage}:${m.status || ""}:${m.detail || ""}`;

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
        <article class="value-card">
          <h3>Links</h3>
          <p>Create smart bidirectional links with [[terms]] and grow your own personal Wikipedia.</p>
        </article>
        <article class="value-card">
          <h3>Graph</h3>
          <p>See hidden patterns across notes through a relationship graph based on shared concepts.</p>
        </article>
        <article class="value-card">
          <h3>AI QuickView</h3>
          <p>Get polished Chinese editorial output with TOC, sectioning, key quotes, and share-ready layout.</p>
        </article>
      </div>
    </section>
    <section class="auth magic-auth">
      <h2>Sign up / Log in</h2>
      <p>Build your second brain in minutes.</p>
      <input id="email" placeholder="email" />
      <input id="pwd" type="password" placeholder="password" style="margin-top:8px" />
      <div style="display:flex;gap:8px;margin-top:12px">
        <button id="signup">Sign up</button>
        <button id="login" class="ghost">Log in</button>
      </div>
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
  app.innerHTML = `<div class="container">
    <section class="hero">
      <h1>Write Your Personal Wiki</h1>
      <p>Paste a subtitled YouTube link. We fetch full transcript first, then stream a Chinese wiki-style HTML article.</p>
      <div class="panel">
        <input id="videoUrl" placeholder="https://www.youtube.com/watch?v=..." />
        <textarea id="noteTitle" placeholder="Title (optional)"></textarea>
        <button id="generateBtn">Generate (Streaming)</button>
      </div>
    </section>
    <section class="panel">
      <h3>My Notes</h3>
      <div>${
        notes.results
          .map(
            (n) =>
              `<p><a href="#" data-note="${n.id}">${esc(n.title)}</a> <button class="ghost" data-open="${n.id}">Open</button> <button class="ghost" data-share="${n.id}">Share</button> <button class="ghost" data-delete-note="${n.id}">Delete</button></p>`,
          )
          .join("") || "No notes yet."
      }</div>
    </section>
    ${
      draft?.html
        ? `<section class="panel"><h3>Unsaved Draft</h3><p>${esc(draft.title || "Untitled draft")} <button class="ghost" id="resumeDraftBtn">Resume Draft</button> <button class="ghost" id="discardDraftBtn">Discard Draft</button></p></section>`
        : ""
    }
    <section class="panel">
      <h3>Trash Bin</h3>
      <div>${
        (trash.results || [])
          .map(
            (n) =>
              `<p>${esc(n.title)} <button class="ghost" data-restore-note="${n.id}">Restore</button> <button class="ghost" data-perma-delete-note="${n.id}">Permanently Delete</button></p>`,
          )
          .join("") || "Trash is empty."
      }</div>
    </section>
  </div>`;
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
  if (qs("#resumeDraftBtn"))
    qs("#resumeDraftBtn").onclick = () => renderDraftEditor();
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
      const cls =
        level === "h1" ? "toc-l1" : level === "h2" ? "toc-l2" : "toc-l3";
      return `<a class="${cls}" href="#${id}">${h.textContent}</a>`;
    })
    .join("");
}

async function generateAndRender() {
  const videoUrl = qs("#videoUrl").value.trim();
  const title = qs("#noteTitle").value.trim();
  if (!videoUrl) return alert("Please paste a YouTube URL first.");

  app.innerHTML = `<div class="container"><div class="grid">
    <aside class="panel toc">
      <h3>Table of Contents</h3>
      <div id="toc"></div>
      <hr/>
      <h3>Workflow Logs</h3>
      <div id="stageLog"></div>
    </aside>
    <article class="panel doc">
      <div class="meta">AI QuickView <span class="chip">streaming</span></div>
      <div id="live"></div>
      <div id="genState" style="margin-top:12px;display:flex;align-items:center;gap:8px">
        <span class="spinner" aria-hidden="true"></span>
        <span>Generating...</span>
      </div>
      <div id="saveWrap" style="margin-top:12px;display:none"><button id="saveBtn">Save Note</button></div>
    </article>
  </div></div>`;

  const live = qs("#live");
  const stageLogs = [];
  updateStages([
    { stage: "planning", status: "start", detail: "Preparing request..." },
  ]);

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
  const draftBase = {
    title: title || "AI 对话笔记",
    videoUrl,
    html: "",
    updatedAt: Date.now(),
  };
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
      }
      if (msg.type === "done") {
        const htmlToSave = rawHtml || prefillHtml;
        qs("#genState").style.display = "none";
        qs("#saveWrap").style.display = "block";
        qs("#saveBtn").onclick = () =>
          saveNote({ title: title || "", videoUrl, html: htmlToSave });
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

async function openNote(id, shared) {
  const res = await fetch(shared ? `/api/share/${id}` : `/api/notes/${id}`, {
    headers: currentToken ? { authorization: `Bearer ${currentToken}` } : {},
  });
  if (!res.ok) return alert(await res.text());
  const n = await res.json();
  const links = n.links || [];
  app.innerHTML = `<div class="container"><div class="grid">
    <aside class="panel toc">
      <h3>Table of Contents</h3>
      <div id="toc"></div>
      <hr/>
      <div class="links">${links.map((x) => `<a href="#" class="chip wikilink" data-wikilink="${esc(x)}">[[${esc(x)}]]</a>`).join("")}</div>
    </aside>
    <article class="panel doc">
      <div class="meta">AI QuickView <span class="chip">shareable</span> <a href="/share/${n.id}" target="_blank">Public Link</a> ${
        shared
          ? ""
          : `<button class="ghost" id="updateBtnTop">Update</button> <button class="ghost" id="copyShareBtn">Copy Share Link</button> <button class="ghost" id="deleteNoteBtn">Delete Note</button>`
      }</div>
      ${
        shared
          ? `<h1>${esc(n.title || "")}</h1>`
          : `<input id="titleInput" value="${esc(n.title || "")}" placeholder="Note title" style="margin-bottom:12px;font-size:20px;font-weight:700" />`
      }
      ${
        shared
          ? ""
          : `<div style="margin:0 0 12px;display:flex;gap:8px;align-items:center"><button id="updateBtnTopBar">Update Note</button></div>`
      }
      <div id="docRoot" contenteditable="${shared ? "false" : "true"}">${renderWikiLinks(n.html)}</div>
      ${shared ? "" : '<div style="margin-top:12px"><button id="updateBtn">Update</button></div>'}
    </article>
  </div></div>`;
  qs("#toc").innerHTML = buildToc(qs("#docRoot"));
  bindWikiLinkNavigation();
  if (!shared) {
    const autoTitle =
      (n.title || "").trim() === "AI 对话笔记"
        ? extractTitleFromHtml(n.html)
        : "";
    if (autoTitle && qs("#titleInput")) qs("#titleInput").value = autoTitle;

    const doUpdate = async () => {
      const html = stripRenderedWikiLinks(qs("#docRoot").innerHTML);
      let title = (qs("#titleInput")?.value || "").trim();
      if (!title) title = extractTitleFromHtml(html);
      await api(`/api/notes/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, html }),
      });
      alert("Updated");
      renderHome();
    };
    qs("#copyShareBtn").onclick = () => copyShareLink(n.id);
    qs("#deleteNoteBtn").onclick = () => deleteNoteById(n.id);
    qs("#updateBtnTop").onclick = doUpdate;
    qs("#updateBtnTopBar").onclick = doUpdate;
    qs("#updateBtn").onclick = doUpdate;
  }
}

async function renderGraph(focusTerm = "") {
  if (!currentToken) return renderAuth();
  graphFocusTerm = String(focusTerm || "").trim();
  const notes = await (await api("/api/notes")).json();
  const draft = readDraft();
  app.innerHTML = `<div class="container panel"><h2>Knowledge Graph</h2><p id="graphMeta"></p><div id="graphActions"></div>${
    draft?.html
      ? `<p><button class="ghost" id="backToDraftBtn">Back to Unsaved Draft</button></p>`
      : ""
  }<canvas class="graph" id="g"></canvas><div id="graphLinkedArticles"></div></div>`;
  if (qs("#backToDraftBtn"))
    qs("#backToDraftBtn").onclick = () => renderDraftEditor();
  const canvas = qs("#g");
  const ctx = canvas.getContext("2d");
  const dpr = devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  ctx.scale(dpr, dpr);

  const linkFreq = new Map();
  const edgeFreq = new Map();
  for (const note of notes.results || []) {
    const uniq = [
      ...new Set(
        (note.links || []).map((x) => String(x || "").trim()).filter(Boolean),
      ),
    ];
    uniq.forEach((t) => linkFreq.set(t, (linkFreq.get(t) || 0) + 1));
    for (let i = 0; i < uniq.length; i++) {
      for (let j = i + 1; j < uniq.length; j++) {
        const a = uniq[i] < uniq[j] ? uniq[i] : uniq[j];
        const b = uniq[i] < uniq[j] ? uniq[j] : uniq[i];
        const key = `${a}|||${b}`;
        edgeFreq.set(key, (edgeFreq.get(key) || 0) + 1);
      }
    }
  }

  const terms = [...linkFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 120)
    .map(([term, freq]) => ({ term, freq }));

  const termSet = new Set(terms.map((t) => t.term));
  const degreeByTerm = new Map(terms.map((t) => [t.term, 0]));

  const nodeByTerm = new Map();
  const edges = [];
  for (const [key, weight] of edgeFreq.entries()) {
    const [aTerm, bTerm] = key.split("|||");
    if (!termSet.has(aTerm) || !termSet.has(bTerm)) continue;
    degreeByTerm.set(aTerm, (degreeByTerm.get(aTerm) || 0) + 1);
    degreeByTerm.set(bTerm, (degreeByTerm.get(bTerm) || 0) + 1);
    edges.push({ aTerm, bTerm, weight });
  }
  const orderedTerms = [...terms].sort(
    (a, b) => (degreeByTerm.get(b.term) || 0) - (degreeByTerm.get(a.term) || 0),
  );

  // Circular layered layout: high-degree nodes near center.
  const cx = 520;
  const cy = 330;
  const rings = [
    { cap: 1, r: 0 },
    { cap: 10, r: 120 },
    { cap: 20, r: 220 },
    { cap: 32, r: 320 },
    { cap: 60, r: 430 },
  ];
  let idx = 0;
  const nodes = [];
  for (const ring of rings) {
    const left = orderedTerms.length - idx;
    if (left <= 0) break;
    const count = Math.min(ring.cap, left);
    for (let i = 0; i < count; i++) {
      const t = orderedTerms[idx++];
      const theta = count === 1 ? 0 : (Math.PI * 2 * i) / count;
      const x = cx + ring.r * Math.cos(theta);
      const y = cy + ring.r * Math.sin(theta);
      const degree = degreeByTerm.get(t.term) || 0;
      const size = Math.min(8 + degree * 0.85, 26);
      const n = {
        id: `term:${t.term}`,
        term: t.term,
        freq: t.freq,
        degree,
        x,
        y,
        size,
      };
      nodes.push(n);
      nodeByTerm.set(t.term, n);
    }
  }
  const finalEdges = edges
    .map((e) => ({
      a: nodeByTerm.get(e.aTerm),
      b: nodeByTerm.get(e.bTerm),
      weight: e.weight,
    }))
    .filter((e) => e.a && e.b);
  const focusNode = graphFocusTerm ? nodeByTerm.get(graphFocusTerm) : null;
  const focusNeighbors = new Set();
  if (focusNode) {
    for (const e of finalEdges) {
      if (e.a.term === focusNode.term) focusNeighbors.add(e.b.term);
      if (e.b.term === focusNode.term) focusNeighbors.add(e.a.term);
    }
  }
  qs("#graphMeta").textContent = focusNode
    ? `Focused: [[${focusNode.term}]] • ${focusNeighbors.size} related terms • ${
        finalEdges.filter(
          (e) => e.a.term === focusNode.term || e.b.term === focusNode.term,
        ).length
      } highlighted links.`
    : `${nodes.length} wiki terms, ${finalEdges.length} co-occurrence links from ${notes.results?.length || 0} notes.`;
  if (focusNode) {
    qs("#graphActions").innerHTML =
      `<button class="ghost" id="deleteTermBtn">Delete Focus Term [[${esc(
        focusNode.term,
      )}]]</button>`;
    qs("#deleteTermBtn").onclick = () => deleteGraphTerm(focusNode.term);
  } else {
    qs("#graphActions").innerHTML = "";
  }

  // Build "main/sub articles" panel from selected node and its connected nodes.
  if (focusNode) {
    const noteList = notes.results || [];
    const hasTerm = (note, term) => (note.links || []).includes(term);
    const mainArticles = noteList.filter((n) => hasTerm(n, focusNode.term));
    const relatedTerms = [...focusNeighbors];
    const subGroups = relatedTerms
      .map((term) => ({
        term,
        notes: noteList.filter((n) => hasTerm(n, term)),
      }))
      .filter((g) => g.notes.length > 0)
      .sort((a, b) => b.notes.length - a.notes.length);
    const seenTerms = new Set();
    const uniqueSubGroups = subGroups.filter((g) => {
      if (seenTerms.has(g.term)) return false;
      seenTerms.add(g.term);
      return true;
    });

    qs("#graphLinkedArticles").innerHTML = `
      <div class="panel" style="margin-top:12px">
        <h3>Articles from Selected Node</h3>
        <p><strong>Main Article (<button type="button" class="chip graph-term-chip" data-graph-term="${esc(
          focusNode.term,
        )}">[[${esc(focusNode.term)}]]</button>)</strong></p>
        <div>
          ${
            mainArticles.length
              ? mainArticles
                  .map(
                    (n) =>
                      `<p><a href="#" data-graph-note="${n.id}">${esc(n.title)}</a></p>`,
                  )
                  .join("")
              : "<p>No direct article found.</p>"
          }
        </div>
        <hr/>
        <p><strong>Sub Articles by Connected Terms</strong></p>
        <div>
          ${
            uniqueSubGroups.length
              ? uniqueSubGroups
                  .map(
                    (g) => `
                    <div style="margin-bottom:10px">
                      <div><button type="button" class="chip graph-term-chip" data-graph-term="${esc(g.term)}">[[${esc(g.term)}]]</button></div>
                      ${g.notes
                        .map(
                          (n) =>
                            `<p><a href="#" data-graph-note="${n.id}">${esc(n.title)}</a></p>`,
                        )
                        .join("")}
                    </div>`,
                  )
                  .join("")
              : "<p>No related articles from connected terms.</p>"
          }
        </div>
      </div>
    `;
    app.querySelectorAll("[data-graph-note]").forEach((a) => {
      a.onclick = (e) => {
        e.preventDefault();
        openNote(a.dataset.graphNote, false);
      };
    });
    app.querySelectorAll("[data-graph-term]").forEach((a) => {
      a.onclick = async (e) => {
        e.preventDefault();
        await renderGraph(a.dataset.graphTerm || "");
      };
    });
  } else {
    qs("#graphLinkedArticles").innerHTML = "";
  }

  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let dragMoved = false;

  const redraw = () => {
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    ctx.strokeStyle = "#93c5fd";
    finalEdges.forEach(({ a, b, weight }) => {
      const isFocusEdge =
        focusNode && (a.term === focusNode.term || b.term === focusNode.term);
      if (focusNode && !isFocusEdge) {
        ctx.strokeStyle = "rgba(148,163,184,0.25)";
      } else {
        ctx.strokeStyle = isFocusEdge ? "#1d4ed8" : "#93c5fd";
      }
      ctx.beginPath();
      ctx.lineWidth = Math.min(0.8 + weight * 0.5, 3) / Math.max(scale, 0.6);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    });
    ctx.lineWidth = 1;
    nodes.forEach((n) => {
      const isFocus = focusNode && n.term === focusNode.term;
      const isNeighbor = focusNode && focusNeighbors.has(n.term);
      if (focusNode && !isFocus && !isNeighbor) {
        ctx.fillStyle = "rgba(59,130,246,0.35)";
      } else if (isFocus) {
        ctx.fillStyle = "#0f172a";
      } else {
        ctx.fillStyle = "#1d4ed8";
      }
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.size, 0, Math.PI * 2);
      ctx.fill();
      if (focusNode && !isFocus && !isNeighbor) {
        ctx.fillStyle = "rgba(51,65,85,0.45)";
      } else {
        ctx.fillStyle = "#0f172a";
      }
      ctx.font = "12px IBM Plex Sans, sans-serif";
      ctx.fillText(n.term.slice(0, 12), n.x + 20, n.y + 4);
    });
    ctx.restore();
  };

  canvas.style.cursor = "grab";
  canvas.onmousedown = (e) => {
    dragging = true;
    dragMoved = false;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.style.cursor = "grabbing";
  };
  window.onmouseup = () => {
    dragging = false;
    canvas.style.cursor = "grab";
  };
  canvas.onmousemove = (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    if (Math.abs(dx) + Math.abs(dy) > 2) dragMoved = true;
    lastX = e.clientX;
    lastY = e.clientY;
    offsetX += dx;
    offsetY += dy;
    redraw();
  };
  canvas.onclick = async (e) => {
    if (dragMoved) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const gx = (mx - offsetX) / scale;
    const gy = (my - offsetY) / scale;
    let hit = null;
    for (const n of nodes) {
      const r = n.size + 3;
      const dx = gx - n.x;
      const dy = gy - n.y;
      if (dx * dx + dy * dy <= r * r) {
        hit = n;
        break;
      }
    }
    if (hit?.term) {
      await renderGraph(hit.term);
    }
  };
  canvas.onwheel = (e) => {
    e.preventDefault();
    const prev = scale;
    const next = Math.min(
      2.6,
      Math.max(0.45, prev * (e.deltaY > 0 ? 0.92 : 1.08)),
    );
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    offsetX = mx - ((mx - offsetX) * next) / prev;
    offsetY = my - ((my - offsetY) * next) / prev;
    scale = next;
    redraw();
  };
  canvas.ondblclick = () => {
    scale = 1;
    offsetX = 0;
    offsetY = 0;
    redraw();
  };

  redraw();
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

function renderDraftEditor() {
  const draft = readDraft();
  if (!draft?.html) return renderHome();
  app.innerHTML = `<div class="container"><div class="grid">
    <aside class="panel toc">
      <h3>Table of Contents</h3>
      <div id="toc"></div>
      <hr/>
      <div><button class="ghost" id="toGraphFromDraft">Graph</button></div>
    </aside>
    <article class="panel doc">
      <div class="meta">Unsaved Draft <span class="chip">recoverable</span></div>
      <div id="live">${renderWikiLinks(draft.html)}</div>
      <div style="margin-top:12px;display:flex;gap:8px">
        <button id="saveDraftBtn">Save Note</button>
        <button class="ghost" id="discardDraftBtn2">Discard Draft</button>
      </div>
    </article>
  </div></div>`;
  qs("#toc").innerHTML = buildToc(qs("#live"));
  qs("#saveDraftBtn").onclick = () =>
    saveNote({
      title: draft.title || "",
      videoUrl: draft.videoUrl,
      html: draft.html,
    });
  qs("#discardDraftBtn2").onclick = () => {
    clearDraft();
    renderHome();
  };
  qs("#toGraphFromDraft").onclick = () => renderGraph("");
}

async function deleteNoteById(noteId) {
  if (!confirm("Move this note to Trash Bin? You can restore it later."))
    return;
  await api(`/api/notes/${noteId}`, { method: "DELETE" });
  renderHome();
}

async function restoreNoteById(noteId) {
  await api(`/api/notes/${noteId}/restore`, { method: "POST" });
  renderHome();
}

async function permanentlyDeleteNoteById(noteId) {
  if (
    !confirm("Permanently delete this note from Trash? This cannot be undone.")
  )
    return;
  await api(`/api/notes/${noteId}/permanent`, { method: "DELETE" });
  renderHome();
}

async function deleteGraphTerm(term) {
  if (
    !confirm(
      `Delete [[${term}]] from all your notes? This updates note content and graph links.`,
    )
  )
    return;
  const res = await api(`/api/graph/term?name=${encodeURIComponent(term)}`, {
    method: "DELETE",
  });
  const data = await res.json();
  alert(`Deleted term [[${term}]] from ${data.affectedNotes} notes.`);
  renderGraph();
}

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
