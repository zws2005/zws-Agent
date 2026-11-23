import { booksToCsv } from "../csv";
import type { CommentRecord } from "../comment-types";
import type { RawBookRecord } from "../types";
import type { RawWebPageRecord } from "../web-page-types";
import {
  createDoubanMovieCommentSource,
  extractDoubanMovieId
} from "./douban-movie-comments";
import { doubanBooksSource } from "./douban-books";
import {
  createDouyinVideoCommentSource,
  extractDouyinVideoId
} from "./douyin-video-comments";
import {
  createJdProductCommentSource,
  extractJdProductId
} from "./jd-product-comments";
import {
  createMovieReviewPageSource,
  isSupportedMovieReviewUrl
} from "./movie-review-pages";
import { createWebPageSource } from "./web-page";
import type { CrawlSource } from "./types";

export type CrawlSourceKind =
  | "douban-books-top250"
  | "web-page"
  | "douban-movie-comments"
  | "jd-product-comments"
  | "douyin-video-comments"
  | "movie-review-page";

export type ResolvedCrawlSource =
  | {
      kind: "douban-books-top250";
      url: string;
      extension: "csv";
      source: CrawlSource<RawBookRecord>;
    }
  | {
      kind: "web-page";
      url: string;
      extension: "json";
      source: CrawlSource<RawWebPageRecord>;
    }
  | {
      kind:
        | "douban-movie-comments"
        | "jd-product-comments"
        | "douyin-video-comments"
        | "movie-review-page";
      url: string;
      extension: "csv";
      source: CrawlSource<CommentRecord>;
    };

export function normalizeCrawlUrl(raw: string): string {
  const value = raw.trim();
  if (!value) {
    throw new Error("网址不能为空");
  }

  const candidate = /^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(`无效网址: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`只支持 HTTP/HTTPS 网址，收到: ${url.protocol}`);
  }
  if (!url.hostname) {
    throw new Error(`网址缺少主机名: ${raw}`);
  }
  return url.toString();
}

function createDoubanPageSource(url: string): CrawlSource<RawBookRecord> {
  const parsedUrl = new URL(url);
  const pageStart = Math.max(0, Number(parsedUrl.searchParams.get("start") ?? 0) || 0);
  return {
    name: "douban-books-top250-page",
    pageSize: doubanBooksSource.pageSize,
    maxPages: 1,
    defaultFileName: "douban-top250.csv",
    buildPageUrl() {
      return parsedUrl.toString();
    },
    parsePage(html, _pageStart, context) {
      return doubanBooksSource.parsePage(html, pageStart, context);
    },
    serialize(items) {
      return booksToCsv(items);
    }
  };
}

export function resolveCrawlSource(rawUrl: string): ResolvedCrawlSource {
  const url = normalizeCrawlUrl(rawUrl);
  const parsed = new URL(url);
  if (
    parsed.hostname === "book.douban.com" &&
    /^\/top250\/?$/.test(parsed.pathname)
  ) {
    return {
      kind: "douban-books-top250",
      url,
      extension: "csv",
      source: createDoubanPageSource(url)
    };
  }
  if (isSupportedMovieReviewUrl(url)) {
    return {
      kind: "movie-review-page",
      url,
      extension: "csv",
      source: createMovieReviewPageSource(url)
    };
  }
  const doubanMovieId = extractDoubanMovieId(url);
  if (doubanMovieId) {
    return {
      kind: "douban-movie-comments",
      url,
      extension: "csv",
      source: createDoubanMovieCommentSource(url, doubanMovieId)
    };
  }
  const jdProductId = extractJdProductId(url);
  if (jdProductId) {
    return {
      kind: "jd-product-comments",
      url,
      extension: "csv",
      source: createJdProductCommentSource(url, jdProductId)
    };
  }
  const douyinVideoId = extractDouyinVideoId(url);
  if (douyinVideoId || parsed.hostname === "v.douyin.com") {
    return {
      kind: "douyin-video-comments",
      url,
      extension: "csv",
      source: createDouyinVideoCommentSource(url, douyinVideoId)
    };
  }
  return {
    kind: "web-page",
    url,
    extension: "json",
    source: createWebPageSource(url)
  };
}
