import * as cheerio from "cheerio";
import { commentsToCsv } from "../comment-csv";
import type { CommentRecord } from "../comment-types";
import {
  asRecord,
  dedupeComments,
  firstNumber,
  firstString
} from "../comments/common";
import type { CrawlSource } from "./types";

export function isSupportedMovieReviewUrl(rawUrl: string): boolean {
  const url = new URL(rawUrl);
  if (url.hostname === "letterboxd.com") return /\/reviews\/?/.test(url.pathname);
  if (url.hostname.endsWith("imdb.com")) return /\/reviews\/?/.test(url.pathname);
  if (url.hostname.endsWith("rottentomatoes.com")) {
    return /\/reviews\/?/.test(url.pathname);
  }
  if (url.hostname === "movie.douban.com") {
    return /\/subject\/\d+\/reviews\/?/.test(url.pathname);
  }
  return false;
}

function itemIdFromUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  const match =
    url.pathname.match(/\/title\/(tt\d+)/) ??
    url.pathname.match(/\/film\/([^/]+)/) ??
    url.pathname.match(/\/m\/([^/]+)/) ??
    url.pathname.match(/\/subject\/(\d+)/);
  return match?.[1] ?? url.pathname;
}

function ratingValue(value: unknown): number | null {
  const record = asRecord(value);
  return firstNumber(record, ["ratingValue", "value", "bestRating"]);
}

function findJsonLdReviews(value: unknown, results: unknown[], depth = 0): void {
  if (depth > 8 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const item of value) findJsonLdReviews(item, results, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  const record = asRecord(value);
  const type = record["@type"];
  const types = Array.isArray(type) ? type : [type];
  if (
    types.some((item) => String(item).toLowerCase() === "review") ||
    ("reviewBody" in record && "author" in record)
  ) {
    results.push(record);
  }
  for (const nested of Object.values(record)) {
    findJsonLdReviews(nested, results, depth + 1);
  }
}

function normalizeReview(
  value: unknown,
  rawUrl: string,
  title: string,
  fetchedAt: string,
  fallbackIndex: number
): CommentRecord | null {
  const item = asRecord(value);
  const authorValue = item.author;
  const author = typeof authorValue === "string"
    ? authorValue
    : firstString(asRecord(authorValue), ["name"]);
  const content =
    firstString(item, ["reviewBody", "reviewText", "text", "content", "description"]);
  if (!content) return null;
  return {
    source: "movie-review",
    itemId: itemIdFromUrl(rawUrl),
    itemUrl: rawUrl,
    itemTitle: title,
    commentId:
      firstString(item, ["@id", "url", "identifier"]) ||
      `${itemIdFromUrl(rawUrl)}-${fallbackIndex}`,
    author,
    content,
    rating: ratingValue(item.reviewRating),
    createdAt: firstString(item, ["datePublished", "dateCreated", "dateModified"]),
    location: "",
    likes: firstNumber(item, ["upvoteCount", "likeCount"]),
    replyCount: firstNumber(item, ["commentCount", "replyCount"]),
    images: [],
    extraJson: JSON.stringify(item),
    fetchedAt
  };
}

export function parseMovieReviews(
  html: string,
  rawUrl: string,
  fetchedAt = new Date().toISOString()
): CommentRecord[] {
  const $ = cheerio.load(html);
  const title =
    $("meta[property='og:title']").attr("content")?.trim() ||
    $("h1").first().text().trim() ||
    $("title").text().trim();
  const jsonLd: unknown[] = [];
  $("script[type='application/ld+json']").each((_, script) => {
    try {
      findJsonLdReviews(JSON.parse($(script).text()), jsonLd);
    } catch {
      // Ignore malformed JSON-LD and continue with DOM extraction.
    }
  });
  const comments = jsonLd
    .map((review, index) => normalizeReview(review, rawUrl, title, fetchedAt, index))
    .filter((item): item is CommentRecord => item !== null);

  $(
    "[itemprop='review'], article.review, .review-card, .review-item, .user-review, .comment-item"
  ).each((index, element) => {
    if (comments.length >= 300) return;
    const item = $(element);
    const content = item
      .find("[itemprop='reviewBody'], .review-body, .review-content, .comment-content, .text")
      .first()
      .text()
      .replace(/\s+/g, " ")
      .trim();
    if (!content) return;
    comments.push({
      source: "movie-review",
      itemId: itemIdFromUrl(rawUrl),
      itemUrl: rawUrl,
      itemTitle: title,
      commentId: `${itemIdFromUrl(rawUrl)}-dom-${index + 1}`,
      author: item
        .find("[itemprop='author'], .review-author, .author, .username")
        .first()
        .text()
        .trim(),
      content,
      rating: null,
      createdAt: item.find("time, .review-date, .date").first().text().trim(),
      location: "",
      likes: null,
      replyCount: null,
      images: [],
      extraJson: "{}",
      fetchedAt
    });
  });
  return dedupeComments(comments);
}

export function createMovieReviewPageSource(
  rawUrl: string
): CrawlSource<CommentRecord> {
  return {
    name: "movie-review-page",
    pageSize: 20,
    defaultPages: 1,
    maxPages: 1,
    defaultFileName: "movie-reviews.csv",
    buildPageUrl() {
      return rawUrl;
    },
    parsePage(html) {
      const items = parseMovieReviews(html, rawUrl);
      return {
        items,
        malformedRows: items.length === 0 ? 1 : 0
      };
    },
    serialize(items) {
      return commentsToCsv(items);
    }
  };
}
