import * as cheerio from "cheerio";
import { normalizeText } from "./normalize";
import type {
  RawWebPageRecord,
  WebHeading,
  WebImage,
  WebLink
} from "./web-page-types";

const MAX_CONTENT_CHARS = 120_000;
const MAX_HEADINGS = 120;
const MAX_LINKS = 300;
const MAX_IMAGES = 120;

export interface WebPageProfile {
  id: string;
  label: string;
  matches(url: URL): boolean;
  contentSelectors: readonly string[];
}

const CONTENT_PROFILES: readonly WebPageProfile[] = [
  {
    id: "wikipedia",
    label: "Wikipedia",
    matches: (url) => /(^|\.)wikipedia\.org$/i.test(url.hostname),
    contentSelectors: ["#mw-content-text", "main", "article"]
  },
  {
    id: "github",
    label: "GitHub",
    matches: (url) => url.hostname === "github.com" || url.hostname.endsWith(".github.com"),
    contentSelectors: ["#readme", "article", "main"]
  },
  {
    id: "generic",
    label: "通用网页",
    matches: () => true,
    contentSelectors: ["article", "main", "[role='main']", ".article-content", ".post-content"]
  }
];

export function detectWebPageProfile(url: URL): WebPageProfile {
  return CONTENT_PROFILES.find((profile) => profile.matches(url)) ?? CONTENT_PROFILES.at(-1)!;
}

function metaContent(
  $: cheerio.CheerioAPI,
  selectors: readonly string[]
): string {
  for (const selector of selectors) {
    const value = normalizeText($(selector).first().attr("content"));
    if (value) return value;
  }
  return "";
}

function absoluteUrl(value: string, baseUrl: string): string {
  if (!value) return "";
  try {
    const url = new URL(value, baseUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function extractContent(
  $: cheerio.CheerioAPI,
  profile: WebPageProfile
): string {
  let selected = $();
  for (const selector of [...profile.contentSelectors, "body"]) {
    const candidate = $(selector).first();
    if (candidate.length > 0) {
      selected = candidate;
      break;
    }
  }

  if (selected.length === 0) {
    return "";
  }

  const root = selected.clone();
  root
    .find("script, style, noscript, template, svg, canvas, iframe, form")
    .remove();
  root
    .find("nav, footer, aside, [aria-hidden='true'], .advertisement, .ads, .cookie, .sidebar")
    .remove();

  const blocks: string[] = [];
  const seen = new Set<string>();
  root.find("h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, td, th").each((_, element) => {
    const text = normalizeText($(element).text());
    if (text.length < 2 || seen.has(text)) return;
    seen.add(text);
    blocks.push(text);
  });

  let content = blocks.join("\n\n");
  if (!content) {
    content = normalizeText(root.text());
  }
  return content.slice(0, MAX_CONTENT_CHARS);
}

/**
 * Extract the fields needed by zws-Agent from an arbitrary HTML page.
 * Site-specific parsing can still be added as a CrawlSource when a page needs
 * a stricter schema or pagination contract.
 */
export function parseWebPage(
  html: string,
  requestedUrl: string,
  options: {
    finalUrl?: string;
    fetchedAt?: string;
    profile?: WebPageProfile;
  } = {}
): RawWebPageRecord {
  const finalUrl = options.finalUrl || requestedUrl;
  const $ = cheerio.load(html);
  const url = new URL(finalUrl);
  const profile = options.profile ?? detectWebPageProfile(url);
  const content = extractContent($, profile);

  const title =
    metaContent($, [
      "meta[property='og:title']",
      "meta[name='twitter:title']",
      "meta[name='title']"
    ]) ||
    normalizeText($("h1").first().text()) ||
    normalizeText($("title").text());
  const description = metaContent($, [
    "meta[property='og:description']",
    "meta[name='twitter:description']",
    "meta[name='description']"
  ]);
  const siteName =
    metaContent($, ["meta[property='og:site_name']", "meta[name='application-name']"]) ||
    url.hostname;
  const author = metaContent($, [
    "meta[name='author']",
    "meta[property='article:author']",
    "meta[name='byl']"
  ]);
  const publishedAt = metaContent($, [
    "meta[property='article:published_time']",
    "meta[name='date']",
    "meta[name='publishdate']",
    "meta[name='pubdate']"
  ]);
  const language =
    normalizeText($("html").attr("lang")) ||
    metaContent($, ["meta[property='og:locale']"]);
  const canonicalUrl = absoluteUrl(
    normalizeText($("link[rel='canonical']").first().attr("href")),
    finalUrl
  );

  const headings: WebHeading[] = [];
  $("h1, h2, h3, h4, h5, h6").each((_, element) => {
    if (headings.length >= MAX_HEADINGS) return;
    const text = normalizeText($(element).text());
    if (!text) return;
    headings.push({
      level: Number($(element).prop("tagName")?.slice(1) ?? 1),
      text
    });
  });

  const links: WebLink[] = [];
  const seenLinks = new Set<string>();
  $("a[href]").each((_, element) => {
    if (links.length >= MAX_LINKS) return;
    const resolved = absoluteUrl(normalizeText($(element).attr("href")), finalUrl);
    if (!resolved || seenLinks.has(resolved)) return;
    seenLinks.add(resolved);
    links.push({ text: normalizeText($(element).text()), url: resolved });
  });

  const images: WebImage[] = [];
  const seenImages = new Set<string>();
  $("img[src]").each((_, element) => {
    if (images.length >= MAX_IMAGES) return;
    const resolved = absoluteUrl(
      normalizeText($(element).attr("src") ?? $(element).attr("data-src")),
      finalUrl
    );
    if (!resolved || seenImages.has(resolved)) return;
    seenImages.add(resolved);
    images.push({ alt: normalizeText($(element).attr("alt")), url: resolved });
  });

  return {
    url: requestedUrl,
    finalUrl,
    title,
    description,
    siteName,
    author,
    publishedAt,
    language,
    canonicalUrl,
    content,
    headings,
    links,
    images,
    extractor: profile.id,
    fetchedAt: options.fetchedAt ?? new Date().toISOString()
  };
}
