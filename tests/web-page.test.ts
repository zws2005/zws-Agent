import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { crawlUrl } from "../src/crawler";
import {
  normalizeCrawlUrl,
  resolveCrawlSource
} from "../src/sources";
import { detectWebPageProfile, parseWebPage } from "../src/web-parser";

const ARTICLE_HTML = `<!doctype html>
<html lang="zh-CN">
  <head>
    <title>页面标题 - 示例站</title>
    <meta property="og:title" content="zws-Agent 示例文章">
    <meta property="og:description" content="用于测试通用网页提取。">
    <meta property="og:site_name" content="示例站">
    <meta name="author" content="zws">
    <meta property="article:published_time" content="2026-11-23T08:00:00+08:00">
    <link rel="canonical" href="/articles/1">
  </head>
  <body>
    <nav>导航不应进入正文</nav>
    <article>
      <h1>zws-Agent 示例文章</h1>
      <p>第一段正文。</p>
      <p>第二段正文。</p>
      <a href="/next">下一页</a>
      <img src="../images/cover.jpg" alt="封面">
      <script>throw new Error("not content")</script>
    </article>
  </body>
</html>`;

test("parses metadata, readable content, links and images from a generic page", () => {
  const page = parseWebPage(
    ARTICLE_HTML,
    "https://example.com/start",
    {
      finalUrl: "https://example.com/articles/1",
      fetchedAt: "2026-11-23T00:00:00.000Z"
    }
  );

  assert.equal(page.title, "zws-Agent 示例文章");
  assert.equal(page.description, "用于测试通用网页提取。");
  assert.equal(page.siteName, "示例站");
  assert.equal(page.author, "zws");
  assert.equal(page.language, "zh-CN");
  assert.equal(page.canonicalUrl, "https://example.com/articles/1");
  assert.match(page.content, /第一段正文/);
  assert.match(page.content, /第二段正文/);
  assert.doesNotMatch(page.content, /导航不应进入正文/);
  assert.doesNotMatch(page.content, /not content/);
  assert.deepEqual(page.links, [
    { text: "下一页", url: "https://example.com/next" }
  ]);
  assert.deepEqual(page.images, [
    { alt: "封面", url: "https://example.com/images/cover.jpg" }
  ]);
  assert.equal(page.extractor, "generic");
});

test("recognizes supported page profiles without coupling them to the crawler loop", () => {
  assert.equal(
    detectWebPageProfile(new URL("https://zh.wikipedia.org/wiki/Test")).id,
    "wikipedia"
  );
  assert.equal(
    detectWebPageProfile(new URL("https://github.com/example/project")).id,
    "github"
  );
});

test("normalizes and validates a single HTTP URL", () => {
  assert.equal(normalizeCrawlUrl("example.com/news"), "https://example.com/news");
  assert.equal(normalizeCrawlUrl("https://example.com"), "https://example.com/");
  assert.throws(() => normalizeCrawlUrl("ftp://example.com/file"), /HTTP\/HTTPS/);
  assert.throws(() => normalizeCrawlUrl("http://"), /无效网址/);
});

test("resolves known and generic sources through the source registry", () => {
  const douban = resolveCrawlSource("https://book.douban.com/top250?start=25");
  assert.equal(douban.kind, "douban-books-top250");
  assert.equal(douban.extension, "csv");
  assert.equal(douban.source.buildPageUrl(0), "https://book.douban.com/top250?start=25");

  const generic = resolveCrawlSource("https://example.com/article");
  assert.equal(generic.kind, "web-page");
  assert.equal(generic.extension, "json");
});

test("crawls exactly one URL and writes JSON through the generic source", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "zws-agent-page-"));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(ARTICLE_HTML, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" }
    });

  try {
    const url = "https://example.com/article";
    const outputPath = path.join(directory, "page.json");
    const result = await crawlUrl(url, { outputPath });
    assert.equal(result.kind, "web-page");
    assert.equal(result.rowCount, 1);
    assert.equal(result.title, "zws-Agent 示例文章");

    const pages = JSON.parse(await readFile(outputPath, "utf8")) as Array<{
      finalUrl: string;
      content: string;
    }>;
    assert.equal(pages.length, 1);
    assert.equal(pages[0]?.finalUrl, url);
    assert.match(pages[0]?.content ?? "", /第一段正文/);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});
