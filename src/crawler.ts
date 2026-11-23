import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fetchPage } from "./fetch";
import {
  doubanBooksSource,
  normalizeCrawlUrl,
  resolveCrawlSource,
  type ResolvedCrawlSource,
  type CrawlSource,
  type CrawlSourceKind
} from "./sources";
import type { CommentRecord } from "./comment-types";
import type { RawBookRecord } from "./types";
import type { RawWebPageRecord } from "./web-page-types";

export interface CrawlOptions {
  pages?: number;
  pageSize?: number;
  delayMs?: number;
  outputPath?: string;
  onProgress?: (message: string) => void;
}

export interface CrawlResult<T> {
  items: T[];
  outputPath: string;
  malformedRows: number;
  sourceName: string;
  finalUrl?: string;
  pagesFetched: number;
}

export interface UrlCrawlResult {
  kind: CrawlSourceKind;
  requestedUrl: string;
  finalUrl?: string;
  title?: string;
  outputPath: string;
  rowCount: number;
  malformedRows: number;
  sourceName: string;
  preview?: string;
}

function report(options: CrawlOptions, message: string): void {
  if (options.onProgress) {
    options.onProgress(message);
  } else {
    console.log(message);
  }
}

async function writeCrawlOutput<T>(
  source: CrawlSource<T>,
  items: readonly T[],
  outputPath: string
): Promise<void> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.tmp`;
  await writeFile(temporaryPath, source.serialize(items), "utf8");
  await rename(temporaryPath, outputPath);
}

export function createPageOutputPath(
  rawUrl: string,
  extension: "csv" | "json"
): string {
  const url = new URL(normalizeCrawlUrl(rawUrl));
  const timestamp = new Date().toISOString().replace(/[-:.]/g, "");
  const stem = `${url.hostname}${url.pathname}`
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  return path.join(process.cwd(), "data", "pages", `${stem || "page"}-${timestamp}.${extension}`);
}

export async function crawlSource<T>(
  source: CrawlSource<T>,
  options: CrawlOptions = {}
): Promise<CrawlResult<T>> {
  const pages = Math.min(
    source.maxPages,
    Math.max(1, options.pages ?? source.defaultPages ?? source.maxPages)
  );
  const pageSize = Math.max(1, options.pageSize ?? source.pageSize);
  const delayMs = Math.max(0, options.delayMs ?? 1_500);
  const defaultOutput = path.join(
    process.cwd(),
    "data",
    source.defaultFileName ?? "crawl-output.txt"
  );
  const outputPath = path.resolve(options.outputPath ?? defaultOutput);

  if (source.collect) {
    report(options, `[crawl] source: ${source.name} (browser/API collector)`);
    const collected = await source.collect({
      pages,
      pageSize,
      delayMs,
      onProgress: (message) => report(options, message)
    });
    if (collected.items.length === 0) {
      throw new Error(
        `No rows found by source "${source.name}"; the page may be blocked, require login, or its layout changed`
      );
    }
    await writeCrawlOutput(source, collected.items, outputPath);
    report(options, `[crawl] wrote ${collected.items.length} rows to ${outputPath}`);
    return {
      items: collected.items,
      outputPath,
      malformedRows: collected.malformedRows,
      sourceName: source.name,
      finalUrl: collected.finalUrl,
      pagesFetched: collected.pagesFetched
    };
  }

  if (!source.buildPageUrl || !source.parsePage) {
    throw new Error(`source "${source.name}" has no paged parser or collector`);
  }

  const items: T[] = [];
  let malformedRows = 0;
  let finalUrl: string | undefined;
  let pagesFetched = 0;

  report(options, `[crawl] source: ${source.name} (${pages} pages, ${pageSize}/page)`);

  for (let pageIndex = 0; pageIndex < pages; pageIndex += 1) {
    const url = source.buildPageUrl(pageIndex, pageSize);
    report(options, `[crawl] page ${pageIndex + 1}/${pages}: ${url}`);

    const fetched = await fetchPage(url, { headers: source.headers });
    finalUrl ??= fetched.finalUrl;
    pagesFetched += 1;
    const parsed = source.parsePage(fetched.html, pageIndex * pageSize, {
      requestedUrl: url,
      finalUrl: fetched.finalUrl,
      status: fetched.status
    });
    malformedRows += parsed.malformedRows;

    if (parsed.items.length === 0) {
      if (source.stopOnEmptyPage) {
        report(options, `[crawl] page ${pageIndex + 1} is empty; stopping pagination`);
        break;
      }
      throw new Error(
        `No rows found by source "${source.name}" on page ${pageIndex + 1}; the page may be blocked or its layout changed`
      );
    }

    items.push(...parsed.items);
    report(options, `[crawl] parsed ${parsed.items.length} rows`);

    if (pageIndex < pages - 1 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  await writeCrawlOutput(source, items, outputPath);

  report(
    options,
    `[crawl] wrote ${items.length} rows to ${outputPath}` +
      (malformedRows > 0 ? ` (${malformedRows} malformed rows skipped)` : "")
  );

  return {
    items,
    outputPath,
    malformedRows,
    sourceName: source.name,
    finalUrl,
    pagesFetched
  };
}

function firstPagePreview(items: readonly unknown[]): { title?: string; preview?: string } {
  const first = items[0];
  if (!first || typeof first !== "object") return {};
  const record = first as Partial<RawWebPageRecord> &
    Partial<RawBookRecord> &
    Partial<CommentRecord>;
  const previewSource =
    record.content || record.description || record.authorInfo || "";
  return {
    title: record.title || record.itemTitle,
    preview: previewSource ? previewSource.slice(0, 500) : undefined
  };
}

async function collectResolvedSource(
  resolved: ResolvedCrawlSource,
  options: CrawlOptions
): Promise<CrawlResult<unknown>> {
  switch (resolved.kind) {
    case "douban-books-top250":
      return crawlSource(resolved.source, options);
    case "web-page":
      return crawlSource(resolved.source, options);
    case "douban-movie-comments":
      return crawlSource(resolved.source, options);
    case "jd-product-comments":
      return crawlSource(resolved.source, options);
    case "douyin-video-comments":
      return crawlSource(resolved.source, options);
    case "movie-review-page":
      return crawlSource(resolved.source, options);
  }
}

/**
 * Crawl exactly one user-supplied URL. The source registry decides whether a
 * known site adapter or the generic page extractor should handle it.
 */
export async function crawlUrl(
  rawUrl: string,
  options: CrawlOptions = {}
): Promise<UrlCrawlResult> {
  const resolved = resolveCrawlSource(rawUrl);
  const outputPath =
    options.outputPath ??
    createPageOutputPath(resolved.url, resolved.extension);
  const result = await collectResolvedSource(resolved, {
    ...options,
    outputPath
  });
  const page = firstPagePreview(result.items);
  return {
    kind: resolved.kind,
    requestedUrl: resolved.url,
    finalUrl: result.finalUrl,
    title: page.title,
    outputPath: result.outputPath,
    rowCount: result.items.length,
    malformedRows: result.malformedRows,
    sourceName: result.sourceName,
    preview: page.preview
  };
}

export async function crawlDoubanTop250(
  options: CrawlOptions = {}
): Promise<CrawlResult<RawBookRecord>> {
  return crawlSource(doubanBooksSource, options);
}
