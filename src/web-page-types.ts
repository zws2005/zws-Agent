export interface WebHeading {
  level: number;
  text: string;
}

export interface WebLink {
  text: string;
  url: string;
}

export interface WebImage {
  alt: string;
  url: string;
}

/**
 * Site-independent representation of one HTML page.
 *
 * Structured fields are extracted from metadata first and then fall back to
 * conventional HTML elements. `content` keeps readable text only; raw HTML is
 * deliberately not persisted by default.
 */
export interface RawWebPageRecord {
  url: string;
  finalUrl: string;
  title: string;
  description: string;
  siteName: string;
  author: string;
  publishedAt: string;
  language: string;
  canonicalUrl: string;
  content: string;
  headings: WebHeading[];
  links: WebLink[];
  images: WebImage[];
  extractor: string;
  fetchedAt: string;
}
