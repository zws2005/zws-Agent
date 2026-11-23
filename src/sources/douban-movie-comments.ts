import { commentsToCsv } from "../comment-csv";
import type { CommentRecord } from "../comment-types";
import { fetchPage } from "../fetch";
import {
  asRecord,
  dedupeComments,
  firstNumber,
  firstString
} from "../comments/common";
import type { CrawlSource, SourceCollectionOptions } from "./types";

const MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";

export function extractDoubanMovieId(rawUrl: string): string | undefined {
  const url = new URL(rawUrl);
  if (!/(^|\.)douban\.com$/i.test(url.hostname)) return undefined;
  const match = url.pathname.match(
    /^\/(?:movie\/)?subject\/(\d+)(?:\/comments)?\/?$/
  );
  return match?.[1];
}

function parseInterests(
  payload: unknown,
  itemId: string,
  itemUrl: string,
  itemTitle: string,
  fetchedAt: string
): CommentRecord[] {
  const root = asRecord(payload);
  const interests = Array.isArray(root.interests) ? root.interests : [];
  return interests
    .map((value) => {
      const item = asRecord(value);
      const user = asRecord(item.user);
      const rating = asRecord(item.rating);
      const location = asRecord(user.loc);
      return {
        source: "douban-movie" as const,
        itemId,
        itemUrl,
        itemTitle,
        commentId: firstString(item, ["id"]),
        author: firstString(user, ["name"]),
        content: firstString(item, ["comment"]),
        rating: firstNumber(rating, ["value", "star_count"]),
        createdAt: firstString(item, ["create_time"]),
        location: firstString(location, ["name"]),
        likes: firstNumber(item, ["vote_count"]),
        replyCount: null,
        images: [],
        extraJson: JSON.stringify(item),
        fetchedAt
      };
    })
    .filter((item) => Boolean(item.content));
}

export function parseDoubanMovieComments(
  payload: unknown,
  itemId: string,
  itemUrl: string,
  fetchedAt = new Date().toISOString(),
  itemTitle = ""
): CommentRecord[] {
  return parseInterests(payload, itemId, itemUrl, itemTitle, fetchedAt);
}

export function createDoubanMovieCommentSource(
  rawUrl: string,
  itemId: string
): CrawlSource<CommentRecord> {
  const headers = {
    "User-Agent": MOBILE_UA,
    Accept: "application/json, text/plain, */*",
    Referer: `https://m.douban.com/movie/subject/${itemId}/comments/`
  };
  return {
    name: "douban-movie-comments",
    pageSize: 20,
    defaultPages: 3,
    maxPages: 50,
    defaultFileName: "douban-movie-comments.csv",
    headers,
    stopOnEmptyPage: true,
    buildPageUrl() {
      return rawUrl;
    },
    parsePage() {
      throw new Error("豆瓣电影短评通过 API 收集器解析");
    },
    async collect(options: SourceCollectionOptions) {
      const fetchedAt = new Date().toISOString();
      let itemTitle = "";
      try {
        const abstract = await fetchPage(
          `https://movie.douban.com/j/subject_abstract?subject_id=${itemId}`,
          { headers }
        );
        itemTitle = firstString(asRecord(asRecord(JSON.parse(abstract.html)).subject), ["title"]);
      } catch {
        options.onProgress?.("[douban-movie] 电影标题读取失败，继续采集短评");
      }

      const items: CommentRecord[] = [];
      let pagesFetched = 0;
      let finalUrl = rawUrl;
      let malformedRows = 0;
      for (let pageIndex = 0; pageIndex < options.pages; pageIndex += 1) {
        const start = pageIndex * options.pageSize;
        const url =
          `https://m.douban.com/rexxar/api/v2/movie/${itemId}/interests` +
          `?count=${options.pageSize}&start=${start}&order_by=hot&for_mobile=1`;
        options.onProgress?.(
          `[douban-movie] 第 ${pageIndex + 1}/${options.pages} 页，start=${start}`
        );
        const fetched = await fetchPage(url, { headers });
        finalUrl = fetched.finalUrl;
        pagesFetched += 1;
        const payload = JSON.parse(fetched.html) as unknown;
        const pageItems = parseInterests(
          payload,
          itemId,
          rawUrl,
          itemTitle,
          fetchedAt
        );
        malformedRows += Math.max(
          0,
          (Array.isArray(asRecord(payload).interests)
            ? (asRecord(payload).interests as unknown[]).length
            : 0) - pageItems.length
        );
        if (pageItems.length === 0) break;
        items.push(...pageItems);
        if (pageIndex < options.pages - 1 && options.delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, options.delayMs));
        }
      }
      return {
        items: dedupeComments(items),
        malformedRows,
        pagesFetched,
        finalUrl
      };
    },
    serialize(items) {
      return commentsToCsv(items);
    }
  };
}
