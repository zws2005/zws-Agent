import { parseWebPage } from "../web-parser";
import type { RawWebPageRecord } from "../web-page-types";
import type { CrawlSource } from "./types";

export function createWebPageSource(
  url: string,
  fetchedAt = new Date().toISOString()
): CrawlSource<RawWebPageRecord> {
  return {
    name: "generic-web-page",
    pageSize: 1,
    maxPages: 1,
    defaultFileName: "page.json",
    buildPageUrl() {
      return url;
    },
    parsePage(html, _pageStart, context) {
      return {
        items: [
          parseWebPage(html, context?.requestedUrl ?? url, {
            finalUrl: context?.finalUrl ?? url,
            fetchedAt
          })
        ],
        malformedRows: 0
      };
    },
    serialize(items) {
      return `${JSON.stringify(items, null, 2)}\n`;
    }
  };
}
