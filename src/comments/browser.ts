import { existsSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright-core";

export interface BrowserResponseCapture {
  url: string;
  body: string;
}

export interface BrowserCaptureOptions {
  url: string;
  responsePatterns: readonly RegExp[];
  pages: number;
  delayMs: number;
  cookie?: string;
  storageState?: string;
  mobile?: boolean;
  onProgress?: (message: string) => void;
  prepare?: (page: Page, pageIndex: number) => Promise<void>;
}

export interface BrowserCaptureResult {
  finalUrl: string;
  html: string;
  responses: BrowserResponseCapture[];
}

const DESKTOP_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";

export function findBrowserExecutable(): string {
  const configured = process.env.CHROMIUM_PATH ?? process.env.BROWSER_EXECUTABLE;
  if (configured) {
    if (!existsSync(configured)) {
      throw new Error(`浏览器路径不存在: ${configured}`);
    }
    return configured;
  }
  const candidates = [
    "/snap/bin/chromium",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/microsoft-edge"
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      "未找到 Chromium/Chrome。请安装浏览器，或通过 CHROMIUM_PATH 指定可执行文件。"
    );
  }
  return found;
}

function parseCookieHeader(cookie: string, url: string): Array<{
  name: string;
  value: string;
  domain: string;
  path: string;
}> {
  const hostname = new URL(url).hostname;
  const hostParts = hostname.split(".");
  const domain =
    hostParts.length >= 2 ? `.${hostParts.slice(-2).join(".")}` : hostname;
  return cookie
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separator = part.indexOf("=");
      return separator > 0
        ? { name: part.slice(0, separator).trim(), value: part.slice(separator + 1) }
        : { name: part, value: "" };
    })
    .filter(({ name }) => name)
    .map(({ name, value }) => ({ name, value, domain, path: "/" }));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function captureBrowserResponses(
  options: BrowserCaptureOptions
): Promise<BrowserCaptureResult> {
  let browser: Browser | undefined;
  try {
    options.onProgress?.("[browser] 启动 Chromium");
    browser = await chromium.launch({
      headless: true,
      executablePath: findBrowserExecutable(),
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--js-flags=--max-old-space-size=384"
      ]
    });
    const context = await browser.newContext({
      userAgent: options.mobile ? MOBILE_UA : DESKTOP_UA,
      viewport: options.mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
      locale: "zh-CN",
      ...(options.storageState ? { storageState: options.storageState } : {})
    });
    if (options.cookie) {
      await context.addCookies(parseCookieHeader(options.cookie, options.url));
    }
    const page = await context.newPage();
    const responses: BrowserResponseCapture[] = [];
    const pending = new Set<Promise<void>>();

    page.on("response", (response) => {
      const responseUrl = response.url();
      if (!options.responsePatterns.some((pattern) => pattern.test(responseUrl))) return;
      const task = response
        .text()
        .then((body) => {
          if (body.trim()) responses.push({ url: responseUrl, body });
        })
        .catch(() => undefined)
        .finally(() => pending.delete(task));
      pending.add(task);
    });

    options.onProgress?.(`[browser] 打开 ${options.url}`);
    try {
      await page.goto(options.url, {
        waitUntil: "domcontentloaded",
        timeout: 45_000
      });
    } catch (error) {
      if (page.url() === "about:blank") throw error;
      options.onProgress?.(
        `[browser] 页面加载超时，继续读取已渲染内容: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    await sleep(Math.max(800, options.delayMs));

    for (let pageIndex = 0; pageIndex < options.pages; pageIndex += 1) {
      options.onProgress?.(`[browser] 加载第 ${pageIndex + 1}/${options.pages} 批评论`);
      if (options.prepare) {
        await options.prepare(page, pageIndex);
      } else {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      }
      await sleep(Math.max(500, options.delayMs));
    }
    await Promise.allSettled([...pending]);

    return {
      finalUrl: page.url(),
      html: await page.content(),
      responses
    };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
