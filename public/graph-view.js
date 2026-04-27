export async function renderGraphView(focusTerm = "", ctx) {
  if (!ctx.getCurrentToken()) return ctx.renderAuth();
  ctx.setGraphFocusTerm(focusTerm);
  const notes = await (await ctx.api("/api/notes")).json();
  const draft = ctx.readDraft();
  ctx.app.innerHTML = `<div class="container panel"><h2>Knowledge Graph</h2><p id="graphMeta"></p><div id="graphActions"></div>${
    draft?.html
      ? `<p><button class="ghost" id="backToDraftBtn">Back to Unsaved Draft</button></p>`
      : ""
  }<canvas class="graph" id="g"></canvas><div id="graphLinkedArticles"></div></div>`;
  if (ctx.qs("#backToDraftBtn")) ctx.qs("#backToDraftBtn").onclick = () => ctx.renderDraftEditor();

  const canvas = ctx.qs("#g");
  const c2d = canvas.getContext("2d");
  const dpr = devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  c2d.scale(dpr, dpr);

  const linkFreq = new Map();
  const edgeFreq = new Map();
  for (const note of notes.results || []) {
    const uniq = [...new Set((note.links || []).map((x) => String(x || "").trim()).filter(Boolean))];
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
      const x = 520 + ring.r * Math.cos(theta);
      const y = 330 + ring.r * Math.sin(theta);
      const degree = degreeByTerm.get(t.term) || 0;
      const size = Math.min(8 + degree * 0.85, 26);
      const n = { id: `term:${t.term}`, term: t.term, x, y, size, freq: t.freq, degree };
      nodes.push(n);
      nodeByTerm.set(t.term, n);
    }
  }

  const finalEdges = edges
    .map((e) => ({ a: nodeByTerm.get(e.aTerm), b: nodeByTerm.get(e.bTerm), weight: e.weight }))
    .filter((e) => e.a && e.b);
  const focusNode = ctx.getGraphFocusTerm() ? nodeByTerm.get(ctx.getGraphFocusTerm()) : null;
  const focusNeighbors = new Set();
  if (focusNode) {
    for (const e of finalEdges) {
      if (e.a.term === focusNode.term) focusNeighbors.add(e.b.term);
      if (e.b.term === focusNode.term) focusNeighbors.add(e.a.term);
    }
  }

  ctx.qs("#graphMeta").textContent = focusNode
    ? `Focused: [[${focusNode.term}]] • ${focusNeighbors.size} related terms • ${
        finalEdges.filter((e) => e.a.term === focusNode.term || e.b.term === focusNode.term).length
      } highlighted links.`
    : `${nodes.length} wiki terms, ${finalEdges.length} co-occurrence links from ${notes.results?.length || 0} notes.`;

  if (focusNode) {
    ctx.qs("#graphActions").innerHTML = `<button class="ghost" id="deleteTermBtn">Delete Focus Term [[${ctx.esc(
      focusNode.term,
    )}]]</button>`;
    ctx.qs("#deleteTermBtn").onclick = () => deleteGraphTerm(focusNode.term, ctx);
  } else {
    ctx.qs("#graphActions").innerHTML = "";
  }

  renderGraphLinkedArticles({ notes, focusNode, focusNeighbors, ctx });
  bindGraphCanvas({ canvas, c2d, nodes, finalEdges, focusNode, focusNeighbors, ctx });
}

function renderGraphLinkedArticles({ notes, focusNode, focusNeighbors, ctx }) {
  if (!focusNode) {
    ctx.qs("#graphLinkedArticles").innerHTML = "";
    return;
  }

  const noteList = notes.results || [];
  const hasTerm = (note, term) => (note.links || []).includes(term);
  const mainArticles = noteList.filter((n) => hasTerm(n, focusNode.term));
  const subGroups = [...focusNeighbors]
    .map((term) => ({ term, notes: noteList.filter((n) => hasTerm(n, term)) }))
    .filter((g) => g.notes.length > 0)
    .sort((a, b) => b.notes.length - a.notes.length);

  const seenTerms = new Set();
  const uniqueSubGroups = subGroups.filter((g) => {
    if (seenTerms.has(g.term)) return false;
    seenTerms.add(g.term);
    return true;
  });

  ctx.qs("#graphLinkedArticles").innerHTML = `<div class="panel" style="margin-top:12px">
    <h3>Articles from Selected Node</h3>
    <p><strong>Main Article (<button type="button" class="chip graph-term-chip" data-graph-term="${ctx.esc(
      focusNode.term,
    )}">[[${ctx.esc(focusNode.term)}]]</button>)</strong></p>
    <div>${
      mainArticles.length
        ? mainArticles.map((n) => `<p><a href="#" data-graph-note="${n.id}">${ctx.esc(n.title)}</a></p>`).join("")
        : "<p>No direct article found.</p>"
    }</div><hr/>
    <p><strong>Sub Articles by Connected Terms</strong></p>
    <div>${
      uniqueSubGroups.length
        ? uniqueSubGroups
            .map(
              (g) => `<div style="margin-bottom:10px"><div><button type="button" class="chip graph-term-chip" data-graph-term="${ctx.esc(
                g.term,
              )}">[[${ctx.esc(g.term)}]]</button></div>${g.notes
                .map((n) => `<p><a href="#" data-graph-note="${n.id}">${ctx.esc(n.title)}</a></p>`)
                .join("")}</div>`,
            )
            .join("")
        : "<p>No related articles from connected terms.</p>"
    }</div>
  </div>`;

  ctx.app.querySelectorAll("[data-graph-note]").forEach((a) => {
    a.onclick = (e) => {
      e.preventDefault();
      ctx.openNote(a.dataset.graphNote, false);
    };
  });
  ctx.app.querySelectorAll("[data-graph-term]").forEach((a) => {
    a.onclick = async (e) => {
      e.preventDefault();
      await ctx.renderGraph(a.dataset.graphTerm || "");
    };
  });
}

function bindGraphCanvas({ canvas, c2d, nodes, finalEdges, focusNode, focusNeighbors, ctx }) {
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let dragMoved = false;
  let activeKind = null;
  let activeId = null;

  const redraw = () => {
    c2d.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    c2d.fillStyle = "#fff";
    c2d.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    c2d.save();
    c2d.translate(offsetX, offsetY);
    c2d.scale(scale, scale);

    finalEdges.forEach(({ a, b, weight }) => {
      const isFocusEdge = focusNode && (a.term === focusNode.term || b.term === focusNode.term);
      c2d.strokeStyle = focusNode && !isFocusEdge ? "rgba(148,163,184,0.25)" : isFocusEdge ? "#1d4ed8" : "#93c5fd";
      c2d.beginPath();
      c2d.lineWidth = Math.min(0.8 + weight * 0.5, 3) / Math.max(scale, 0.6);
      c2d.moveTo(a.x, a.y);
      c2d.lineTo(b.x, b.y);
      c2d.stroke();
    });

    nodes.forEach((n) => {
      const isFocus = focusNode && n.term === focusNode.term;
      const isNeighbor = focusNode && focusNeighbors.has(n.term);
      c2d.fillStyle = focusNode && !isFocus && !isNeighbor ? "rgba(59,130,246,0.35)" : isFocus ? "#0f172a" : "#1d4ed8";
      c2d.beginPath();
      c2d.arc(n.x, n.y, n.size, 0, Math.PI * 2);
      c2d.fill();
      c2d.fillStyle = focusNode && !isFocus && !isNeighbor ? "rgba(51,65,85,0.45)" : "#0f172a";
      c2d.font = "12px IBM Plex Sans, sans-serif";
      c2d.fillText(n.term.slice(0, 12), n.x + 20, n.y + 4);
    });

    c2d.restore();
  };

  const pointInCanvas = (x, y) => {
    const rect = canvas.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  };

  canvas.style.cursor = "grab";
  canvas.style.touchAction = "none";
  canvas.style.userSelect = "none";

  const findHitNode = (clientX, clientY) => {
    const rect = canvas.getBoundingClientRect();
    const gx = (clientX - rect.left - offsetX) / scale;
    const gy = (clientY - rect.top - offsetY) / scale;
    return nodes.find((n) => {
      const r = n.size + 3;
      const dx = gx - n.x;
      const dy = gy - n.y;
      return dx * dx + dy * dy <= r * r;
    });
  };

  const beginDrag = (kind, id, x, y) => {
    if (activeKind && (activeKind !== kind || activeId !== id)) return;
    activeKind = kind;
    activeId = id;
    dragging = true;
    dragMoved = false;
    lastX = x;
    lastY = y;
    canvas.style.cursor = "grabbing";
  };

  const moveDrag = (kind, id, x, y) => {
    if (!dragging || activeKind !== kind || activeId !== id) return;
    const dx = x - lastX;
    const dy = y - lastY;
    if (Math.abs(dx) + Math.abs(dy) > 4) dragMoved = true;
    lastX = x;
    lastY = y;
    offsetX += dx;
    offsetY += dy;
    redraw();
  };

  const endDrag = async (kind, id, x, y) => {
    if (!dragging || activeKind !== kind || activeId !== id) return;
    const moved = dragMoved;
    dragging = false;
    activeKind = null;
    activeId = null;
    canvas.style.cursor = "grab";
    if (moved) return;
    const hit = findHitNode(x, y);
    if (hit?.term) await ctx.renderGraph(hit.term);
  };

  const cancelDrag = (kind) => {
    if (activeKind !== kind) return;
    dragging = false;
    activeKind = null;
    activeId = null;
    canvas.style.cursor = "grab";
  };

  // Capture touch globally, then only engage when touch starts inside canvas bounds.
  let touchCaptured = false;

  const findTouchById = (list, id) => {
    for (let i = 0; i < list.length; i++) {
      if (list[i].identifier === id) return list[i];
    }
    return null;
  };

  document.addEventListener(
    "touchstart",
    (e) => {
      if (!e.changedTouches.length || activeKind) return;
      const t = e.changedTouches[0];
      if (!pointInCanvas(t.clientX, t.clientY)) return;
      touchCaptured = true;
      beginDrag("touch", t.identifier, t.clientX, t.clientY);
      e.preventDefault();
    },
    { passive: false, capture: true },
  );

  document.addEventListener(
    "touchmove",
    (e) => {
      if (!touchCaptured || activeKind !== "touch") return;
      const t = findTouchById(e.changedTouches, activeId) || findTouchById(e.touches, activeId);
      if (!t) {
        e.preventDefault();
        return;
      }
      moveDrag("touch", t.identifier, t.clientX, t.clientY);
      e.preventDefault();
    },
    { passive: false, capture: true },
  );

  document.addEventListener(
    "touchend",
    async (e) => {
      if (!touchCaptured || activeKind !== "touch") return;
      const t = findTouchById(e.changedTouches, activeId);
      if (t) {
        await endDrag("touch", t.identifier, t.clientX, t.clientY);
      }
      touchCaptured = false;
      e.preventDefault();
    },
    { passive: false, capture: true },
  );

  document.addEventListener(
    "touchcancel",
    () => {
      if (touchCaptured) {
        cancelDrag("touch");
        touchCaptured = false;
      }
    },
    { capture: true },
  );

  canvas.onpointerdown = (e) => {
    beginDrag("pointer", e.pointerId, e.clientX, e.clientY);
    canvas.setPointerCapture?.(e.pointerId);
  };
  canvas.onpointermove = (e) => {
    moveDrag("pointer", e.pointerId, e.clientX, e.clientY);
    if (activeKind === "pointer") e.preventDefault();
  };
  canvas.onpointerup = async (e) => {
    await endDrag("pointer", e.pointerId, e.clientX, e.clientY);
  };
  canvas.onpointercancel = () => cancelDrag("pointer");

  canvas.onmousedown = (e) => beginDrag("mouse", 0, e.clientX, e.clientY);
  window.onmousemove = (e) => moveDrag("mouse", 0, e.clientX, e.clientY);
  window.onmouseup = async (e) => {
    await endDrag("mouse", 0, e.clientX, e.clientY);
  };

  canvas.onwheel = (e) => {
    e.preventDefault();
    const prev = scale;
    const next = Math.min(2.6, Math.max(0.45, prev * (e.deltaY > 0 ? 0.92 : 1.08)));
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
async function deleteGraphTerm(term, ctx) {
  if (!confirm(`Delete [[${term}]] from all your notes? This updates note content and graph links.`)) return;
  const res = await ctx.api(`/api/graph/term?name=${encodeURIComponent(term)}`, {
    method: "DELETE",
  });
  const data = await res.json();
  alert(`Deleted term [[${term}]] from ${data.affectedNotes} notes.`);
  ctx.renderGraph();
}
