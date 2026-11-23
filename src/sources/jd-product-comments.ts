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

export function extractJdProductId(rawUrl: string): string | undefined {
  const url = new URL(rawUrl);
  if (!/(^|\.)jd\.(com|hk)$/i.test(url.hostname)) return undefined;
  const match =
    url.pathname.match(/\/product\/(\d+)\.html/) ??
    url.pathname.match(/\/(\d+)\.html/);
  return match?.[1];
}

function normalizeJdComment(
  value: unknown,
  productId: string,
  productUrl: string,
  productTitle: string,
  fetchedAt: string
): CommentRecord | null {
  const item = asRecord(value);
  const content = firstString(item, ["content", "commentContent", "comment"]);
  if (!content) return null;
  const user = asRecord(item.user);
  const images = stringArray(item.images ?? item.imagesList ?? item.imageList);
  return {
    source: "jd-product",
    itemId: productId,
    itemUrl: productUrl,
    itemTitle: productTitle,
    commentId: firstString(item, ["id", "guid", "commentId"]),
    author: firstString(item, ["nickname", "userNickName", "userName"]) ||
      firstString(user, ["nickname", "name"]),
    content,
    rating: firstNumber(item, ["score", "star", "rating"]),
    createdAt: firstString(item, [
      "creationTime",
      "created",
      "createTime",
      "commentTime"
    ]),
    location: firstString(item, [
      "userClientShow",
      "userLocation",
      "location",
      "productColor",
      "productSize"
    ]),
    likes: firstNumber(item, ["usefulVoteCount", "usefulVote", "likeCount"]),
    replyCount: firstNumber(item, ["replyCount", "replyNum"]),
    images,
    extraJson: JSON.stringify(item),
    fetchedAt
  };
}

export function parseJdCommentPayload(
  text: string,
  productId: string,
  productUrl: string,
  productTitle = "",
  fetchedAt = new Date().toISOString()
): CommentRecord[] {
  const root = asRecord(parseJsonPayload(text));
  const result = asRecord(root.result);
  const comments = Array.isArray(result.comments)
    ? result.comments
    : Array.isArray(root.comments)
      ? root.comments
      : [];
  return comments
    .map((item) =>
      normalizeJdComment(item, productId, productUrl, productTitle, fetchedAt)
    )
    .filter((item): item is CommentRecord => item !== null);
}

function parseTitle(html: string): string {
  const $ = cheerio.load(html);
  return (
    cheerio.load(html)("#itemName").first().text().trim() ||
    $("meta[property='og:title']").attr("content")?.trim() ||
    $("title").text().replace(/\s*-\s*京东.*$/i, "").trim()
  );
}

export function parseJdCommentDom(
  html: string,
  productId: string,
  productUrl: string,
  fetchedAt = new Date().toISOString()
): CommentRecord[] {
  const $ = cheerio.load(html);
  const productTitle = parseTitle(html);
  const comments: CommentRecord[] = [];
  $("#evalDet_main > li, #evalDet_summary > li, .cmt_list > li").each((_, element) => {
    const item = $(element);
    if (!item.attr("productid") && !item.find(".cmt_user, .cmt_cnt").length) return;
    const content = item
      .find(".cmt_content, .cmt_cnt .content, .cmt_cnt")
      .first()
      .clone()
      .find(".cmt_info, .cmt_star, .cmt_btns, .cmt_reply")
      .remove()
      .end()
      .text()
      .replace(/\s+/g, " ")
      .trim();
    if (!content) return;
    comments.push({
      source: "jd-product",
      itemId: productId,
      itemUrl: productUrl,
      itemTitle: productTitle,
      commentId:
        item.attr("guid") ||
        item.attr("data-guid") ||
        `${productId}-${comments.length + 1}`,
      author: item.find(".cmt_user .user, .cmt_user").first().text().trim(),
      content,
      rating: null,
      createdAt: item.find(".cmt_time, .time").first().text().trim(),
      location: item.find(".cmt_info").first().text().trim(),
      likes: null,
      replyCount: null,
      images: item
        .find("img")
        .map((__, image) => $(image).attr("src") ?? "")
        .get()
        .filter(Boolean),
      extraJson: JSON.stringify({ dom: item.text().replace(/\s+/g, " ").trim() }),
      fetchedAt
    });
  });
  return comments;
}

export function createJdProductCommentSource(
  rawUrl: string,
  productId: string
): CrawlSource<CommentRecord> {
  const browserUrl = /^https?:\/\/item\.jd\.com\/\d+\.html/i.test(rawUrl)
    ? rawUrl.replace(
        /^https?:\/\/item\.jd\.com\/(\d+)\.html/i,
        "https://item.m.jd.com/product/$1.html"
      )
    : rawUrl;
  return {
    name: "jd-product-comments",
    pageSize: 10,
    defaultPages: 3,
    maxPages: 30,
    defaultFileName: "jd-product-comments.csv",
    stopOnEmptyPage: true,
    buildPageUrl() {
      return rawUrl;
    },
    parsePage() {
      throw new Error("京东评论通过浏览器收集器解析");
    },
    async collect(options) {
      const cookie = process.env.JD_COOKIE;
      if (!cookie) {
        options.onProgress?.(
          "[jd] 未设置 JD_COOKIE，将先尝试公开页面；若触发登录/风控，请配置 Cookie"
        );
      }
      const captured = await captureBrowserResponses({
        url: browserUrl,
        responsePatterns: [
          /commodity\/comment\/getcommentlist/i,
          /productPageComments/i,
          /api\.m\.jd\.com.*comment/i
        ],
        pages: options.pages,
        delayMs: options.delayMs,
        cookie,
        storageState: process.env.JD_STORAGE_STATE,
        mobile: true,
        onProgress: options.onProgress,
        prepare: async (page) => {
          await page.evaluate(() => {
            const comment = document.querySelector("#commentFloor");
            if (comment instanceof HTMLElement) {
              comment.scrollIntoView({ block: "start" });
            } else {
              window.scrollTo(0, document.body.scrollHeight);
            }
          });
          await page.mouse.wheel(0, 900);
        }
      });

      const fetchedAt = new Date().toISOString();
      const productTitle = parseTitle(captured.html);
      const items: CommentRecord[] = [];
      let malformedRows = 0;
      for (const response of captured.responses) {
        try {
          const parsed = parseJdCommentPayload(
            response.body,
            productId,
            rawUrl,
            productTitle,
            fetchedAt
          );
          items.push(...parsed);
        } catch {
          malformedRows += 1;
        }
      }
      if (items.length === 0) {
        items.push(
          ...parseJdCommentDom(
            captured.html,
            productId,
            rawUrl,
            fetchedAt
          )
        );
      }
      if (items.length === 0) {
        let riskMessage = "";
        for (const response of captured.responses) {
          try {
            const payload = parseJsonPayload(response.body);
            const root = asRecord(payload);
            riskMessage =
              firstString(root, ["msg", "message"]) ||
              firstString(asRecord(root.result), ["msg", "message"]);
            if (riskMessage) break;
          } catch {
            // Keep the generic login/risk guidance.
          }
        }
        throw new Error(
          `京东评论未加载${riskMessage ? `（${riskMessage}）` : ""}。请在 .env 中设置 JD_COOKIE，或设置 JD_STORAGE_STATE 指向登录后的 Playwright storage state 文件。`
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
