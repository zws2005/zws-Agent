import type { CommentRecord } from "../comment-types";

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function firstString(
  record: Record<string, unknown>,
  keys: readonly string[]
): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

export function firstNumber(
  record: Record<string, unknown>,
  keys: readonly string[]
): number | null {
  for (const key of keys) {
    const value = record[key];
    const number = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

export function stringArray(value: unknown): string[] {
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item.trim();
      const record = asRecord(item);
      return firstString(record, ["url", "src", "imageUrl", "image_url"]);
    })
    .filter(Boolean);
}

export function parseJsonPayload(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("empty response body");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("response is not JSON or JSONP");
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

export function dedupeComments(items: readonly CommentRecord[]): CommentRecord[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.commentId || `${item.author}\u0000${item.content}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return Boolean(item.content);
  });
}
