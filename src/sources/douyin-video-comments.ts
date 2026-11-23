import * as cheerio from "cheerio";
import { commentsToCsv } from "../comment-csv";
import type { CommentRecord } from "../comment-types";
import { captureBrowserResponses } from "../comments/browser";
import {
  asRecord,
  dedupeComments,
  firstNumber,
  firstString,
  parseJsonPayload,
  stringArray
} from "../comments/common";
import type { CrawlSource } from "./types";

export function extractDouyinVideoId(rawUrl: string): string | undefined {
  const url = new URL(rawUrl);
  if (!/(^|\.)douyin\.com$/i.test(url.hostname)) return undefined;
  const match = url.pathname.match(/\/(?:video|note|share\/video)\/(\d+)/);
  return match?.[1];
}

function normalizeTimestamp(value: unknown): string {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "";
  const milliseconds = number < 10_000_000_000 ? number * 1000 : number;
  return new Date(milliseconds).toISOString();
}

function parseDouyinComment(
  value: unknown,
  fallbackVideoId: string,
  videoUrl: string,
  videoTitle: string,
  fetchedAt: string
): CommentRecord | null {
  const item = asRecord(value);
  const content = firstString(item, ["text", "content"]);
  if (!content) return null;
  const user = asRecord(item.user);
  const images = Array.isArray(item.image_list)
    ? item.image_list
        .map((image) => {
          const record = asRecord(image);
          const urls = Array.isArray(record.url_list) ? record.url_list : [];
          return typeof urls[0] === "string" ? urls[0] : "";
        })
        .filter(Boolean)
    : stringArray(item.images);
  return {
    source: "douyin-video",
    itemId: firstString(item, ["aweme_id"]) || fallbackVideoId,
    itemUrl: videoUrl,
    itemTitle: videoTitle,
    commentId: firstString(item, ["cid", "comment_id"]),
    author:
      firstString(user, ["nickname", "unique_id", "short_id"]) ||
      firstString(item, ["user_nickname"]),
    content,
    rating: null,
    createdAt: normalizeTimestamp(
      item.create_time ?? item.createTime ?? item.publish_time
    ),
    location: firstString(item, ["ip_label", "ip_location", "location"]),
    likes: firstNumber(item, ["digg_count", "like_count", "likes"]),
    replyCount: firstNumber(item, [
      "reply_comment_total",
      "reply_count",
      "replyCount"
    ]),
    images,
    extraJson: JSON.stringify(item),
    fetchedAt
  };
}

export function parseDouyinCommentPayload(
  text: string,
  fallbackVideoId: string,
  videoUrl: string,
  videoTitle = "",
  fetchedAt = new Date().toISOString()
): CommentRecord[] {
  const root = asRecord(parseJsonPayload(text));
  const comments = Array.isArray(root.comments)
    ? root.comments
    : Array.isArray(asRecord(root.data).comments)
      ? (asRecord(root.data).comments as unknown[])
      : [];
  return comments
    .map((item) =>
      parseDouyinComment(
        item,
        fallbackVideoId,
        videoUrl,
        videoTitle,
        fetchedAt
      )
    )
    .filter((item): item is CommentRecord => item !== null);
}

function pageTitle(html: string): string {
  const $ = cheerio.load(html);
  return (
    $("meta[property='og:title']").attr("content")?.trim() ||
    $("title").text().replace(/\s*-\s*抖音.*$/i, "").trim()
  );
}

export function createDouyinVideoCommentSource(
  rawUrl: string,
  videoId: string | undefined
): CrawlSource<CommentRecord> {
  return {
    name: "douyin-video-comments",
    pageSize: 20,
    defaultPages: 3,
    maxPages: 30,
    defaultFileName: "douyin-video-comments.csv",
    stopOnEmptyPage: true,
    buildPageUrl() {
      return rawUrl;
    },
    parsePage() {
      throw new Error("抖音评论通过浏览器收集器解析");
    },
    async collect(options) {
      const cookie = process.env.DOUYIN_COOKIE;
      if (!cookie && !process.env.DOUYIN_STORAGE_STATE) {
        options.onProgress?.(
          "[douyin] 未设置登录状态；公开接口若触发风控，将无法返回评论"
        );
      }
      const captured = await captureBrowserResponses({
        url: rawUrl,
        responsePatterns: [/aweme\/v1\/web\/comment\/list/i],
        pages: options.pages,
        delayMs: options.delayMs,
        cookie,
        storageState: process.env.DOUYIN_STORAGE_STATE,
        mobile: false,
        onProgress: options.onProgress,
        prepare: async (page) => {
          await page
            .locator(
              '[data-e2e="comment-icon"], [data-e2e="feed-comment-icon"], [data-e2e="comment-btn"]'
            )
            .first()
            .click({ timeout: 1_000 })
            .catch(() => undefined);
          await page.evaluate(() => {
            const list = document.querySelector(
              '[data-e2e="comment-list"], [data-e2e="comment-list-container"]'
            );
            if (list instanceof HTMLElement) {
              list.scrollTop = list.scrollHeight;
            } else {
              window.scrollTo(0, document.body.scrollHeight);
            }
          });
          await page.mouse.wheel(0, 1_200);
        }
      });

      const fetchedAt = new Date().toISOString();
      const finalVideoId =
        extractDouyinVideoId(captured.finalUrl) ?? videoId ?? "";
      const title = pageTitle(captured.html);
      const items: CommentRecord[] = [];
      let malformedRows = 0;
      for (const response of captured.responses) {
        try {
          items.push(
            ...parseDouyinCommentPayload(
              response.body,
              finalVideoId,
              rawUrl,
              title,
              fetchedAt
            )
          );
        } catch {
          malformedRows += 1;
        }
      }
      if (items.length === 0) {
        let riskMessage = "";
        for (const response of captured.responses) {
          try {
            const root = asRecord(parseJsonPayload(response.body));
            riskMessage =
              firstString(root, ["status_msg", "message", "msg"]) ||
              firstString(asRecord(root.data), ["status_msg", "message", "msg"]);
            if (riskMessage) break;
          } catch {
            // Keep the generic login/risk guidance.
          }
        }
        throw new Error(
          `抖音评论未返回${riskMessage ? `（${riskMessage}）` : ""}。请设置 DOUYIN_COOKIE，或使用 DOUYIN_STORAGE_STATE 指向浏览器登录状态文件；不要使用过期视频或私密视频链接。`
        );
      }
      return {
        items: dedupeComments(items).slice(0, options.pages * options.pageSize),
        malformedRows,
        pagesFetched: Math.min(
          options.pages,
          Math.max(1, captured.responses.length)
        ),
        finalUrl: captured.finalUrl
      };
    },
    serialize(items) {
      return commentsToCsv(items);
    }
  };
}
