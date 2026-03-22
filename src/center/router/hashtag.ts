/**
 * Parse a #hashtag at the beginning of a message.
 * Supports Unicode (Chinese, etc.) agent names.
 *
 * Examples:
 *   "#claude hello world"  → { agentId: "claude", body: "hello world" }
 *   "#助手 你好"            → { agentId: "助手", body: "你好" }
 *   "hello world"          → null (no hashtag)
 */

const HASHTAG_RE = /^#([\p{L}\p{N}_-]+)\s*/u;

export interface HashtagResult {
  agentId: string;
  body: string;
}

export function parseHashtag(text: string): HashtagResult | null {
  const trimmed = text.trim();
  const match = trimmed.match(HASHTAG_RE);
  if (!match) return null;

  return {
    agentId: match[1],
    body: trimmed.slice(match[0].length),
  };
}
