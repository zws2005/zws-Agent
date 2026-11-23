import path from "node:path";
import { crawlDoubanTop250, crawlUrl } from "./crawler";

interface CliOptions {
  url?: string;
  douban: boolean;
  pages?: number;
  pageSize?: number;
  delayMs?: number;
  outputPath?: string;
  help: boolean;
}

const HELP = `zws-Agent 网页采集器

用法:
  npm start                         启动交互终端
  npm run crawl -- <网址>           抓取一个网址
  npm run crawl -- --douban         抓取豆瓣读书 Top250（兼容旧流程）

选项:
  --url <网址>                      要抓取的 HTTP/HTTPS 网址
  --output <path>                   输出文件路径
  --douban                          使用豆瓣 Top250 批量适配器
  --pages <n>                       抓取页数（评论来源默认 3，豆瓣 Top250 默认 10）
  --page-size <n>                   每页条目数（评论来源使用站点限制或默认值）
  --delay-ms <n>                    页面/滚动批次等待毫秒数，默认 1500
  -h, --help                        显示帮助

示例:
  npm run crawl -- https://example.com/article
  npm run crawl -- https://item.jd.com/100012043978.html --pages 5
  npm run crawl -- https://www.douyin.com/video/<视频ID>
  npm run crawl -- https://movie.douban.com/subject/1292052/
  npm run crawl -- https://book.douban.com/top250 --output data/pages/douban.csv
  npm run crawl -- --douban --pages 2
`;

function parsePositiveInteger(name: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got "${raw}"`);
  }
  return value;
}

function parseCliOptions(args: string[]): CliOptions {
  const values = new Map<string, string>();
  const positional: string[] = [];
  const valueOptions = new Set(["url", "output", "pages", "page-size", "delay-ms"]);
  let douban = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument) continue;
    if (argument === "--help" || argument === "-h") {
      return {
        douban: false,
        help: true
      };
    }
    if (argument === "--douban") {
      douban = true;
      continue;
    }
    if (!argument.startsWith("--")) {
      positional.push(argument);
      continue;
    }

    const equalsIndex = argument.indexOf("=");
    const optionName = argument.slice(2, equalsIndex > 0 ? equalsIndex : undefined);
    if (!valueOptions.has(optionName)) {
      throw new Error(`Unknown option: --${optionName}`);
    }
    if (equalsIndex > 0) {
      values.set(optionName, argument.slice(equalsIndex + 1));
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${argument}`);
    }
    values.set(optionName, value);
    index += 1;
  }

  const hasLegacyDoubanOption =
    values.has("pages") || values.has("page-size") || values.has("delay-ms");
  if (hasLegacyDoubanOption && !values.has("url") && positional.length === 0) {
    douban = true;
  }

  if (positional.length > 1) {
    throw new Error(`只支持一次抓取一个网址，收到 ${positional.length} 个参数`);
  }
  const url = values.get("url") ?? positional[0];
  if (douban && url) {
    throw new Error("--douban 与单网址模式不能同时使用");
  }
  return {
    url,
    douban,
    pages: values.has("pages")
      ? parsePositiveInteger("--pages", values.get("pages") as string)
      : undefined,
    pageSize: values.has("page-size")
      ? parsePositiveInteger("--page-size", values.get("page-size") as string)
      : undefined,
    delayMs: values.has("delay-ms")
      ? Math.max(0, Number(values.get("delay-ms")))
      : undefined,
    outputPath: values.has("output")
      ? path.resolve(values.get("output") as string)
      : undefined,
    help: false
  };
}

async function launchInteractive(): Promise<void> {
  const [{ loadEnvFile }, { AppRuntime }, { Tui }] = await Promise.all([
    import("./app/env.js"),
    import("./app/runtime.js"),
    import("./app/tui/index.js")
  ]);
  loadEnvFile();
  const runtime = new AppRuntime();
  await new Tui(runtime).start();
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
    return;
  }

  if (options.douban) {
    await crawlDoubanTop250({
      pages: options.pages,
      pageSize: options.pageSize,
      delayMs: options.delayMs,
      outputPath: options.outputPath
    });
    return;
  }

  if (options.url) {
    const result = await crawlUrl(options.url, {
      pages: options.pages,
      pageSize: options.pageSize,
      delayMs: options.delayMs,
      outputPath: options.outputPath
    });
    console.log("[zws-Agent] 抓取完成");
    console.log(`来源类型: ${result.kind}`);
    console.log(`适配器: ${result.sourceName}`);
    console.log(`网址: ${result.finalUrl ?? result.requestedUrl}`);
    if (result.title) console.log(`标题: ${result.title}`);
    console.log(`记录数: ${result.rowCount}`);
    console.log(`输出文件: ${result.outputPath}`);
    if (result.preview) {
      console.log("\n内容预览:");
      console.log(result.preview);
    }
    return;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log(HELP);
    return;
  }
  await launchInteractive();
}

main().catch((error: unknown) => {
  console.error(
    `[zws-Agent] failed: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exitCode = 1;
});
