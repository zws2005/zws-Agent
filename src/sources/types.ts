export interface ParsedPage<T> {
  items: T[];
  malformedRows: number;
}

export interface ParsePageContext {
  requestedUrl: string;
  finalUrl: string;
  status: number;
}

export interface SourceCollectionOptions {
  pages: number;
  pageSize: number;
  delayMs: number;
  onProgress?: (message: string) => void;
}

export interface SourceCollectionResult<T> {
  items: T[];
  malformedRows: number;
  pagesFetched: number;
  finalUrl?: string;
}

/**
 * A crawl source owns everything site-specific:
 * pagination, HTML parsing, page size, and output serialization.
 */
export interface CrawlSource<T> {
  readonly name: string;
  readonly pageSize: number;
  readonly maxPages: number;
  readonly defaultPages?: number;
  readonly defaultFileName?: string;
  readonly headers?: Record<string, string>;
  readonly stopOnEmptyPage?: boolean;
  readonly collect?: (
    options: SourceCollectionOptions
  ) => Promise<SourceCollectionResult<T>>;
  buildPageUrl(pageIndex: number, pageSize?: number): string;
  parsePage(html: string, pageStart: number, context?: ParsePageContext): ParsedPage<T>;
  serialize(items: readonly T[]): string;
}
