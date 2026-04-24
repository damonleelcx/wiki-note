export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });

export const html = (content, status = 200) =>
  new Response(content, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" }
  });

export const text = (content, status = 200, contentType = "text/plain; charset=utf-8") =>
  new Response(content, { status, headers: { "content-type": contentType } });

