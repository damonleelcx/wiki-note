import { randomId } from "./lib/auth.js";

const now = () => new Date().toISOString();

export const createUser = async (env, email, passwordHash) => {
  const id = randomId("u_");
  await env.DB.prepare("INSERT INTO users (id,email,password_hash,created_at) VALUES (?,?,?,?)")
    .bind(id, email, passwordHash, now())
    .run();
  return { id, email };
};

export const getUserByEmail = (env, email) =>
  env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();

export const createSession = async (env, userId) => {
  const token = randomId("s_");
  await env.DB.prepare("INSERT INTO sessions (token,user_id,created_at) VALUES (?,?,?)")
    .bind(token, userId, now())
    .run();
  return token;
};

export const createNote = async (env, payload) => {
  const id = randomId("n_");
  await env.DB.prepare(
    "INSERT INTO notes (id,user_id,title,video_url,html,quickview,links_json,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,NULL)"
  )
    .bind(
      id,
      payload.userId,
      payload.title,
      payload.videoUrl,
      payload.html,
      payload.quickview,
      JSON.stringify(payload.links),
      now(),
      now()
    )
    .run();
  return id;
};

export const updateNote = async (env, noteId, userId, payload) => {
  await env.DB.prepare(
    "UPDATE notes SET title=?, html=?, quickview=?, links_json=?, updated_at=? WHERE id=? AND user_id=? AND deleted_at IS NULL"
  )
    .bind(payload.title, payload.html, payload.quickview, JSON.stringify(payload.links), now(), noteId, userId)
    .run();
};

export const getNote = (env, noteId) =>
  env.DB.prepare("SELECT * FROM notes WHERE id = ?").bind(noteId).first();

export const listMyNotes = (env, userId) =>
  env.DB.prepare(
    "SELECT id,title,video_url,links_json,updated_at FROM notes WHERE user_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC"
  )
    .bind(userId)
    .all();

export const deleteNote = async (env, noteId, userId) => {
  await env.DB.prepare("UPDATE notes SET deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL")
    .bind(now(), now(), noteId, userId)
    .run();
};

export const listNotesForTermMutation = (env, userId) =>
  env.DB.prepare("SELECT id, html, links_json, title FROM notes WHERE user_id = ? AND deleted_at IS NULL").bind(userId).all();

export const listTrashNotes = (env, userId) =>
  env.DB.prepare(
    "SELECT id,title,video_url,updated_at,deleted_at FROM notes WHERE user_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC"
  )
    .bind(userId)
    .all();

export const restoreNote = async (env, noteId, userId) => {
  await env.DB.prepare("UPDATE notes SET deleted_at = NULL, updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL")
    .bind(now(), noteId, userId)
    .run();
};

export const permanentlyDeleteNote = async (env, noteId, userId) => {
  await env.DB.prepare("DELETE FROM notes WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL")
    .bind(noteId, userId)
    .run();
};
