export type CommentSource = "jd-product" | "douyin-video" | "douban-movie" | "movie-review";

export interface CommentRecord {
  source: CommentSource;
  itemId: string;
  itemUrl: string;
  itemTitle: string;
  commentId: string;
  author: string;
  content: string;
  rating: number | null;
  createdAt: string;
  location: string;
  likes: number | null;
  replyCount: number | null;
  images: string[];
  extraJson: string;
  fetchedAt: string;
}

export const COMMENT_FIELDS = [
  { key: "source", header: "source" },
  { key: "itemId", header: "item_id" },
  { key: "itemUrl", header: "item_url" },
  { key: "itemTitle", header: "item_title" },
  { key: "commentId", header: "comment_id" },
  { key: "author", header: "author" },
  { key: "content", header: "content" },
  { key: "rating", header: "rating" },
  { key: "createdAt", header: "created_at" },
  { key: "location", header: "location" },
  { key: "likes", header: "likes" },
  { key: "replyCount", header: "reply_count" },
  { key: "images", header: "images" },
  { key: "extraJson", header: "extra_json" },
  { key: "fetchedAt", header: "fetched_at" }
] as const satisfies ReadonlyArray<{
  key: keyof CommentRecord;
  header: string;
}>;
