# src/sources

数据源适配层负责隔离不同网站的差异。`zws-Agent` 的爬虫主体只依赖 `CrawlSource<T>`，不直接知道 URL、HTML 结构或输出格式。

## 接口

```ts
export interface CrawlSource<T> {
  readonly name: string;
  readonly pageSize: number;
  readonly maxPages: number;
  readonly defaultFileName?: string;
  buildPageUrl(pageIndex: number, pageSize?: number): string;
  parsePage(html: string, pageStart: number, context?: ParsePageContext): ParsedPage<T>;
  serialize(items: readonly T[]): string;
}
```

## 内置数据源

`registry.ts` 根据 URL 自动选择来源：

| URL | 来源 | 输出 |
| --- | --- | --- |
| `book.douban.com/top250` | 豆瓣 Top250 专用适配器 | CSV |
| `item.jd.com/<商品ID>.html` | 京东商品评论适配器 | 评论 CSV |
| `douyin.com/video/<视频ID>` | 抖音视频评论适配器 | 评论 CSV |
| `movie.douban.com/subject/<电影ID>/` | 豆瓣电影短评 API | 评论 CSV |
| Letterboxd / IMDb / Rotten Tomatoes 评论页 | 静态电影评论适配器 | 评论 CSV |
| 其他 HTTP/HTTPS 页面 | `web-page.ts` 通用网页适配器 | JSON |

`douban-books.ts` 实现豆瓣读书 Top250 批量抓取：

- 页大小：25
- 最大页数：10
- 分页参数：`?start=`
- 解析器：Cheerio 定位 `tr.item`
- 输出：`booksToCsv`

`web-page.ts` 实现单网址通用抓取：

- 页大小：1
- 最大页数：1
- 元数据和正文解析：`web-parser.ts`
- 输出：包含标题、正文、标题层级、链接和图片的 JSON
- 自动配置：Wikipedia、GitHub、通用文章页面

评论适配器：

- `jd-product-comments.ts`：Playwright 驱动系统 Chromium，滚动商品评论并解析页面自身接口响应。
- `douyin-video-comments.ts`：加载视频评论面板，截获页面自身评论响应；支持 Cookie 或 storage state。
- `douban-movie-comments.ts`：调用移动版公开短评 JSON API，支持分页。
- `movie-review-pages.ts`：解析电影评论页面中的 JSON-LD `Review` 与常见评论 DOM。

`CrawlSource<T>` 可选 `collect()` 用于动态页面或非 HTML 分页；普通来源继续使用
`buildPageUrl()` + `parsePage()`。

单网址入口是 `crawlUrl(rawUrl)`。它只抓取一个网址，并让来源注册表处理适配器选择。

## 添加新数据源

```ts
import type { CrawlSource } from "../../src/sources";

interface NewsItem {
  title: string;
  url: string;
}

export const newsSource: CrawlSource<NewsItem> = {
  name: "example-news",
  pageSize: 20,
  maxPages: 5,
  buildPageUrl(page, pageSize = 20) {
    return `https://example.com/news?page=${page + 1}&size=${pageSize}`;
  },
  parsePage(html, pageStart) {
    // 使用 Cheerio 或正则解析 html
    return { items: [], malformedRows: 0 };
  },
  serialize(items) {
    return items.map((item) => `${item.title},${item.url}`).join("\n");
  }
};
```

然后通过 `crawlSource(source, options)` 调用，而不用修改爬虫循环。
