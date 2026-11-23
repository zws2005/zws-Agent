import { csvEscape } from "./csv";
import { COMMENT_FIELDS, type CommentRecord } from "./comment-types";

function serializeValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(" | ");
  return value === null || value === undefined ? "" : String(value);
}

export function commentsToCsv(items: readonly CommentRecord[]): string {
  const header = COMMENT_FIELDS.map(({ header: name }) => name).join(",");
  const lines = items.map((item) =>
    COMMENT_FIELDS.map(({ key }) => csvEscape(serializeValue(item[key]))).join(",")
  );
  return `\ufeff${[header, ...lines].join("\n")}\n`;
}
