const enc = new TextEncoder();

export const sha256 = async (input) => {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

export const randomId = (prefix = "") => `${prefix}${crypto.randomUUID().replace(/-/g, "")}`;

export const requireUser = async (request, env) => {
  const token = request.headers.get("authorization")?.replace("Bearer ", "").trim();
  if (!token) return null;
  const row = await env.DB.prepare(
    "SELECT users.id, users.email FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token = ?"
  )
    .bind(token)
    .first();
  return row || null;
};

