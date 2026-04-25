export async function openNoteView(id, shared, ctx) {
  const res = await fetch(shared ? `/api/share/${id}` : `/api/notes/${id}`, {
    headers: ctx.getCurrentToken()
      ? { authorization: `Bearer ${ctx.getCurrentToken()}` }
      : {},
  });
  if (!res.ok) return alert(await res.text());
  const n = await res.json();
  const links = n.links || [];
  ctx.app.innerHTML = `<div class="container"><div class="grid">
    <aside class="panel toc">
      <h3>Table of Contents</h3>
      <div id="toc"></div>
      <hr/>
      <div class="links">${links.map((x) => `<a href="#" class="chip wikilink" data-wikilink="${ctx.esc(x)}">[[${ctx.esc(x)}]]</a>`).join("")}</div>
    </aside>
    <article class="panel doc">
      <div class="meta">AI QuickView <span class="chip">shareable</span> <a href="/share/${n.id}" target="_blank">Public Link</a> ${
        shared
          ? ""
          : `<button class="ghost" id="updateBtnTop">Update</button> <button class="ghost" id="copyShareBtn">Copy Share Link</button> <button class="ghost" id="deleteNoteBtn">Delete Note</button>`
      }</div>
      ${
        shared
          ? `<h1>${ctx.esc(n.title || "")}</h1>`
          : `<input id="titleInput" value="${ctx.esc(n.title || "")}" placeholder="Note title" style="margin-bottom:12px;font-size:20px;font-weight:700" />`
      }
      ${
        shared
          ? ""
          : `<div style="margin:0 0 12px;display:flex;gap:8px;align-items:center"><button id="updateBtnTopBar">Update Note</button></div>`
      }
      <div id="docRoot" contenteditable="${shared ? "false" : "true"}">${ctx.renderWikiLinks(n.html)}</div>
      ${shared ? "" : '<div style="margin-top:12px"><button id="updateBtn">Update</button></div>'}
    </article>
  </div></div>`;

  ctx.qs("#toc").innerHTML = ctx.buildToc(ctx.qs("#docRoot"));
  if (!shared) {
    const autoTitle =
      (n.title || "").trim() === "AI ????"
        ? ctx.extractTitleFromHtml(n.html)
        : "";
    if (autoTitle && ctx.qs("#titleInput")) ctx.qs("#titleInput").value = autoTitle;

    const doUpdate = async () => {
      const html = ctx.stripRenderedWikiLinks(ctx.qs("#docRoot").innerHTML);
      let title = (ctx.qs("#titleInput")?.value || "").trim();
      if (!title) title = ctx.extractTitleFromHtml(html);
      await ctx.api(`/api/notes/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, html }),
      });
      alert("Updated");
      ctx.renderHome();
    };
    ctx.qs("#copyShareBtn").onclick = () => ctx.copyShareLink(n.id);
    ctx.qs("#deleteNoteBtn").onclick = () => ctx.deleteNoteById(n.id);
    ctx.qs("#updateBtnTop").onclick = doUpdate;
    ctx.qs("#updateBtnTopBar").onclick = doUpdate;
    ctx.qs("#updateBtn").onclick = doUpdate;
  }
}
