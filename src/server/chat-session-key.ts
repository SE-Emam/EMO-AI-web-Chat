/**
 * Client-side session identity for /v1/chat/completions (extracted verbatim
 * from app.ts in Task 4 — behavior unchanged).
 *
 * Priority: explicit client header `X-Chat-Session-ID`, then body
 * `metadata.session_id`, then a stable fingerprint of the task itself
 * (system prompt + first user message) so the same agent task keeps one web
 * conversation across requests without any client change.
 *
 * Corrected semantics (owner ruling #6): an explicit identifier ALWAYS wins —
 * two requests with DIFFERENT explicit headers are TWO DIFFERENT sessions
 * even when their messages are byte-identical.
 */
import { createHash } from 'node:crypto';

export function chatSessionKey(request: any, body: any, messages: any[]): string {
  const header = String(request?.headers?.['x-chat-session-id'] || '').trim();
  if (header) return header;
  const metaId = body?.metadata?.session_id;
  const meta = metaId != null ? String(metaId).trim() : '';
  if (meta) return meta;
  const sys = messages.find((m) => m?.role === 'system');
  const user = messages.find((m) => m?.role === 'user');
  const fingerprint = `${String(sys?.content ?? '').slice(0, 500)}\u0000${String(user?.content ?? '').slice(0, 500)}`;
  return 'task-' + createHash('sha1').update(fingerprint).digest('hex').slice(0, 16);
}
