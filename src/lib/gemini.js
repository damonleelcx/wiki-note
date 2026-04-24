const PROMPT = `你是顶级中文科技记者与排版编辑。基于用户提供的 YouTube 字幕，生成一篇“对话整理文章”。
要求：
1) 必须输出中文。
2) 只输出可直接插入网页正文的 HTML 片段，不要输出 markdown，不要输出 \`\`\`。
3) 使用结构：
   - <h1>主标题</h1>
   - <div class="ai-quickview">...</div>
   - 多个 <h2>章节</h2>
   - 关键观点使用 <blockquote>...</blockquote>
   - 对话发言者使用 <p><strong>名字：</strong>内容</p>
4) 语言要凝练，有观点，避免口水话。
5) 自动提取并嵌入 8-16 个 [[双链词条]]（例如 [[AI基础设施]]）。
6) 文末追加一个 <h2>总结</h2>。
7) 仅输出 HTML 片段本身。`;

const splitForStreaming = (text, maxLen = 150) => {
  const out = [];
  let rest = String(text || "");
  while (rest.length > maxLen) {
    let idx = Math.max(
      rest.lastIndexOf("。", maxLen),
      rest.lastIndexOf("！", maxLen),
      rest.lastIndexOf("？", maxLen),
      rest.lastIndexOf("\n", maxLen),
      rest.lastIndexOf(" ", maxLen)
    );
    if (idx < 32) idx = maxLen;
    out.push(rest.slice(0, idx + 1));
    rest = rest.slice(idx + 1);
  }
  if (rest) out.push(rest);
  return out;
};

const bodyFor = (transcript) =>
  JSON.stringify({
    contents: [
      {
        role: "user",
        parts: [{ text: `${PROMPT}\n\n字幕如下：\n${transcript.slice(0, 120000)}` }]
      }
    ],
    generationConfig: { temperature: 0.7, topP: 0.9 }
  });

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const parseSseAndEmit = async ({ res, onChunk, firstTokenTimeoutMs = 4000, abortController }) => {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let emitted = 0;
  const startedAt = Date.now();

  while (true) {
    let readResult;
    if (emitted === 0) {
      const elapsed = Date.now() - startedAt;
      const left = firstTokenTimeoutMs - elapsed;
      if (left <= 0) {
        abortController?.abort("first_token_timeout");
        return { emitted, timeout: true };
      }
      readResult = await Promise.race([
        reader.read(),
        delay(left).then(() => ({ __timeout: true }))
      ]);
      if (readResult?.__timeout) {
        abortController?.abort("first_token_timeout");
        return { emitted, timeout: true };
      }
    } else {
      readResult = await reader.read();
    }
    const { value, done } = readResult;
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    let split = buf.indexOf("\n\n");
    while (split !== -1) {
      const packet = buf.slice(0, split);
      buf = buf.slice(split + 2);
      split = buf.indexOf("\n\n");

      const dataLines = packet
        .split("\n")
        .map((x) => x.trim())
        .filter((x) => x.startsWith("data:"))
        .map((x) => x.slice(5).trim());
      if (!dataLines.length) continue;
      const payload = dataLines.join("\n");
      if (!payload || payload === "[DONE]") continue;

      try {
        const parsed = JSON.parse(payload);
        const events = Array.isArray(parsed) ? parsed : [parsed];
        for (const ev of events) {
          const parts = ev?.candidates?.[0]?.content?.parts || [];
          const text = parts.map((p) => (typeof p?.text === "string" ? p.text : "")).join("");
          if (text) {
            emitted += text.length;
            onChunk(text);
          }
        }
      } catch {
        // ignore malformed packet
      }
    }
  }

  return { emitted, timeout: false };
};

export const streamGeminiHtml = async ({ apiKey, transcript, onChunk, model, onStage }) => {
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY.");

  const modelCandidates = [...new Set([model, "gemini-2.5-flash", "gemini-flash-latest"].filter(Boolean))];
  const reqBody = bodyFor(transcript);

  onStage?.({ stage: "planning", status: "start", detail: "Selecting model and streaming strategy." });

  let streamError = "";
  for (const m of modelCandidates) {
    onStage?.({ stage: "execution", status: "attempt", detail: `Trying streamGenerateContent with ${m}` });
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      m
    )}:streamGenerateContent?alt=sse`;
    const controller = new AbortController();
    const res = await fetch(`${endpoint}&key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: reqBody,
      signal: controller.signal
    });
    if (!res.ok || !res.body) {
      streamError = await res.text();
      onStage?.({ stage: "execution", status: "model_failed", detail: `${m} stream failed (${res.status})` });
      continue;
    }
    onStage?.({ stage: "execution", status: "start", detail: `Streaming started on ${m}` });
    const result = await parseSseAndEmit({
      res,
      onChunk,
      firstTokenTimeoutMs: 4000,
      abortController: controller
    });
    if (result.emitted > 0) {
      onStage?.({ stage: "execution", status: "done", detail: `Streaming completed on ${m}` });
      return;
    }
    onStage?.({
      stage: "execution",
      status: result.timeout ? "no_first_token_timeout" : "no_tokens",
      detail: result.timeout
        ? `${m} had no first token within 4s`
        : `${m} returned no stream tokens`
    });
  }

  onStage?.({ stage: "feedback_retry", status: "start", detail: "All streaming paths yielded no tokens. Switching to non-stream fallback." });

  let fallbackRes;
  let fallbackErr = streamError;
  for (const m of modelCandidates) {
    onStage?.({ stage: "feedback_retry", status: "attempt", detail: `Trying generateContent with ${m}` });
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`;
    fallbackRes = await fetch(`${endpoint}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: reqBody
    });
    if (fallbackRes.ok) break;
    fallbackErr = await fallbackRes.text();
  }

  if (!fallbackRes || !fallbackRes.ok) {
    throw new Error(`Gemini retry failed: ${fallbackRes?.status || 500} ${fallbackErr}`);
  }

  const j = await fallbackRes.json();
  const text = (j?.candidates?.[0]?.content?.parts || [])
    .map((p) => (typeof p?.text === "string" ? p.text : ""))
    .join("")
    .trim();
  if (!text) {
    const reason = j?.candidates?.[0]?.finishReason || "UNKNOWN";
    throw new Error(`Gemini returned empty content (finishReason=${reason}).`);
  }

  for (const part of splitForStreaming(text)) {
    onChunk(part);
    await new Promise((r) => setTimeout(r, 140));
  }
  onStage?.({ stage: "feedback_retry", status: "done", detail: "Fallback produced chunked output." });
};
