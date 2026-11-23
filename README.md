# zws-Agent

**可交互的多类型内容采集 Agent**。输入一个 HTTP/HTTPS 网址，`zws-Agent` 会自动识别普通网页、图书榜单、京东商品评论、抖音视频评论或电影评论，并输出结构化 JSON/CSV；也保留原项目的豆瓣读书 Top250 与 Python/pandas 分析能力。

产品特点：

- 交互式终端：启动后直接粘贴网址即可采集。
- 一次任务抓取一个网址，输出独立文件，结果容易追溯。
- 多内容类型：普通网页正文、豆瓣图书、京东商品评论、抖音视频评论、豆瓣电影短评和其他电影评论页。
- 动态页面：京东与抖音通过 Playwright Core 驱动系统 Chromium，读取页面自身加载的评论响应。
- 可扩展来源注册表：新增站点时实现一个 `CrawlSource<T>` 即可，不修改爬虫主循环。
- Agent 可选：不需要 API Key 也能直接抓取；配置百炼或 DeepSeek 后可使用自然语言任务和 `crawl_url` 工具。
- 原有数据分析和看板流程继续可用。

## 环境要求

- Node.js >= 18.17（使用内置 `fetch`）
- Chromium 或 Google Chrome（京东、抖音动态评论；普通网页和豆瓣评论不需要）
- Python >= 3.10
- pandas、matplotlib、jieba、wordcloud、snownlp、scikit-learn

## 快速开始

```bash
cd 数据爬虫/zws-Agent

npm install

# 启动 zws-Agent 交互终端
npm start

# 或者直接抓取一个网址
npm run crawl -- https://example.com/article

# 京东商品评论
npm run crawl -- https://item.jd.com/100012043978.html --pages 3

# 抖音视频评论（建议配置 DOUYIN_COOKIE）
npm run crawl -- https://www.douyin.com/video/<视频ID> --pages 3

# 豆瓣电影短评
npm run crawl -- https://movie.douban.com/subject/1292052/ --pages 5

# Letterboxd / IMDb / Rotten Tomatoes 等评论页
npm run crawl -- https://letterboxd.com/film/example/reviews/

# 查看命令帮助
npm run crawl -- --help

# 不访问网络的完整测试
npm run test:all

# 豆瓣真实网页 fetch 测试
npm run fetch:test

# 创建 Python 虚拟环境并安装分析依赖
python3 -m venv --system-site-packages .venv
python -m pip install -r requirements.txt

# 兼容旧流程：抓取豆瓣 Top250 全部 10 页（共 250 条）
npm run crawl:douban

# 清洗数据、生成高级分析、图表和看板
npm run analyze
```

也可以一次执行抓取、清洗、高级分析和看板生成：

```bash
npm run pipeline
```

高级分析包含：

- 历史快照与评分/评价人数/排名趋势
- 短评中文分词、词云、情感分析和 LDA 主题模型
- 国家/地区、题材、作者、出版社多维统计
- 静态交互式 Web 看板
- 基于 TF-IDF 的相似高分书推荐

```bash
# 生成并刷新静态看板
npm run dashboard

# 启动本地看板服务
npm run dashboard:serve

# 查询相似高分书
npm run recommend -- 红楼梦 --top 5
```

趋势数据保存在 `data/snapshots/`，每次运行 `npm run analyze` 会保存当天快照。只有持续多天运行后，趋势图才会形成真正的长期曲线。

直接抓取单个网址时，默认输出到 `data/pages/`。也可以指定文件：

```bash
npm run crawl -- https://example.com/article --output data/pages/article.json
npm run crawl -- https://book.douban.com/top250 --output data/pages/douban.csv
```

豆瓣批量模式仍支持页数、请求间隔和输出位置：

```bash
npm run crawl:douban -- --pages 2 --delay-ms 2000
npm run crawl:douban -- --pages 10 --output data/raw_books.csv
```

## 单网址采集与多站点适配

一次命令只处理一个网址。来源注册表根据 URL 选择适配器：

| 来源 | 适用网址 | 输出 |
| --- | --- | --- |
| 豆瓣 Top250 专用适配器 | `book.douban.com/top250` | 结构化 CSV |
| 京东商品评论 | `item.jd.com/<商品ID>.html`、`item.m.jd.com/product/<商品ID>.html` | 评论 CSV |
| 抖音视频评论 | `douyin.com/video/<视频ID>`、`douyin.com/note/<ID>`、短链接 | 评论 CSV |
| 豆瓣电影短评 | `movie.douban.com/subject/<电影ID>/` | 评论 CSV |
| 第三方电影评论 | Letterboxd、IMDb、Rotten Tomatoes、豆瓣长评页 | 评论 CSV |
| 通用网页适配器 | 任意返回标准 HTML 的 HTTP/HTTPS 网址 | JSON |
| Wikipedia 页面配置 | `*.wikipedia.org` | 通用 JSON，优先提取正文内容 |
| GitHub 页面配置 | `github.com` | 通用 JSON，优先提取 README/主内容 |

通用 JSON 记录包括：

- `url` / `finalUrl`：请求网址和重定向后的最终网址
- `title` / `description` / `siteName`：页面标题、摘要和站点名
- `author` / `publishedAt` / `language`：可用时提取的作者、发布时间和语言
- `content`：去除导航、页脚、脚本、样式和表单后的可读正文
- `headings`：正文标题层级
- `links` / `images`：基于最终网址补全的链接和图片
- `extractor` / `fetchedAt`：使用的提取器和抓取时间

通用网页适配器不执行 JavaScript，也不绕过登录、验证码或访问控制。需要严格字段、分页或动态渲染时，应在 `src/sources/` 增加专用 `CrawlSource<T>`，底层 `crawlSource()` 无需改动。

## 评论采集

评论统一输出为 CSV，核心字段：

- `source`：`jd-product`、`douyin-video`、`douban-movie` 或 `movie-review`
- `item_id` / `item_url` / `item_title`：商品、视频或电影标识
- `comment_id` / `author` / `content`
- `rating` / `created_at` / `location`
- `likes` / `reply_count` / `images`
- `extra_json`：站点原始评论对象，便于后续深度分析
- `fetched_at`：采集时间

评论采集默认加载 3 批，每批大小受站点接口限制。可用 `--pages` 调整，最多由各适配器限制：

```bash
npm run crawl -- <网址> --pages 5 --delay-ms 2000 --output data/pages/comments.csv
```

### 京东与抖音登录态

京东和抖音会根据访问频率、地区和登录状态触发风控。`zws-Agent` 不生成或破解站点签名，也不绕过验证码，只复用正常浏览器页面和用户自己的登录状态。

```bash
# 从已登录浏览器的请求头复制 Cookie
export JD_COOKIE="pt_key=...; pt_pin=...;"
export DOUYIN_COOKIE="sessionid=...; ..."

# 或使用 Playwright storage state JSON
export JD_STORAGE_STATE="/absolute/path/jd-storage-state.json"
export DOUYIN_STORAGE_STATE="/absolute/path/douyin-storage-state.json"

# 系统 Chromium 不在默认位置时
export CHROMIUM_PATH="/usr/bin/chromium"
```

如果接口返回“活动太火爆”、登录页、验证码页或空评论列表，适配器会停止并提示配置登录状态，不会生成伪造结果。

## 交互终端

启动：

```bash
npm start
```

TUI 采用聊天式交互：

- 直接粘贴网址，立即执行单网址抓取，不需要模型 API Key
- 输入自然语言任务时，使用 `.env` 中的模型执行 research Agent
- `/crawl` 进入“等待网址”状态，下一条输入会被当作网址抓取
- `/crawl <网址>` 直接抓取指定网址
- `/sites` 查看内置来源适配器
- 实时显示 `web_search` 等工具调用 trace
- 显示最终回复、模型和 Session 路径
- `/search <关键词>` 直接搜索
- `/trace` 查看最新 trace 前 20 行
- `/summary`、`/analyze`、`/pipeline` 等旧数据命令继续保留
- `Esc` 清空输入，`Ctrl+C` 或 `/quit` 退出

```
zws-Agent  bailian/qwen-plus · 就绪 · 待处理 0
/help 帮助 · Esc 清空输入 · Ctrl+C 取消或退出
────────────────────────────────────────────
> https://example.com/article
[crawl] page 1/1: https://example.com/article
[crawl] parsed 1 rows
[crawl] wrote 1 rows to data/pages/example.com-...json
来源: generic-web-page (web-page)
标题: 示例文章
记录数: 1
抓取完成
────────────────────────────────────────────
> 
session: data/agent-sessions/<id>.jsonl
```

## Web Search

项目内置 Web Search 工具，默认使用可免费访问的 Bing HTML 搜索，也支持 DuckDuckGo 和 Tavily。

```bash
npm run search -- "豆瓣读书 Top250"
npm run trace
```

Provider 选择规则：

1. `WEB_SEARCH_PROVIDER` 显式指定
2. 存在 `TAVILY_API_KEY` 时使用 Tavily
3. 默认使用 Bing

```bash
export WEB_SEARCH_PROVIDER=bing
# 或
export WEB_SEARCH_PROVIDER=duckduckgo
# 或
export TAVILY_API_KEY="你的 Tavily Key"
```

Agent 的 `research` Preset 会自动挂载 `web_search` 工具：

```bash
npm run agent -- --preset research "搜索豆瓣读书 Top250 的现状并总结"
```

## Preset 插件管理

`src/core/presets/` 提供最小 Preset Registry。Preset 声明：

- system prompt
- 插件集合
- 插件注册的工具和 Hook

当前内置两个 Preset：

- `crawler`：抓取和分析，默认
- `research`：在爬虫工具之外挂载 `web_search`

```bash
npm run agent -- --preset crawler "抓取 https://example.com/article 并总结"
npm run agent -- --preset research "搜索 Top250 最新信息"
```

实例文档见 `src/core/presets/README.md` 和 `src/core/websearch/README.md`。

## 爬虫 Agent（DeepSeek Harness Core 精简版）

项目内新增了 `src/core/`，按 DeepSeek Harness 的 core 目录组织，并用最小实现移植其关键模式：

- `SessionLog`：append-only JSONL 事件日志
- `ToolRegistry`：工具注册、Schema 和统一错误处理
- `AgentLoop`：模型调用、工具调用、结果回填和最大步数限制
- `LlmProvider`：可替换的模型提供方接口
- 阿里云百炼 Provider：兼容 DashScope OpenAI Compatible API
- DeepSeek Provider：兼容 DeepSeek Chat Completions API
- `selectProvider()`：按环境变量或 `--provider` 自动选择模型
- 默认工具：`crawl_url`、`fetch_top250_page`、`crawl_top250`、`read_books_csv`、`analyze_books`
- 研究 Preset 工具：`web_search`

无 API Key 时运行离线演示（只读取豆瓣第一页，不修改数据）：

```bash
npm run agent:demo
```

使用阿里云百炼模型运行自然语言任务：

```bash
cp .env.example .env
# 编辑 .env，填写 DASHSCOPE_API_KEY
npm run agent -- "抓取 https://example.com/article 并总结正文"
```

也可以直接使用环境变量：

```bash
export DASHSCOPE_API_KEY="你的百炼 API Key"
npm run agent -- "抓取 https://example.com/article 并总结正文"
```

`.env` 已被 `.gitignore` 忽略，不会提交 API Key；`.env.example` 提供可提交的字段模板。

默认百炼模型是 `qwen-plus`，可以指定：

```bash
export DASHSCOPE_MODEL="qwen-plus"
npm run agent -- --provider bailian --model qwen-plus "抓取 https://example.com/article 并总结"
```

继续使用 DeepSeek：

```bash
export DEEPSEEK_API_KEY="你的 DeepSeek API Key"
npm run agent -- --provider deepseek "抓取 https://example.com/article 并总结"
```

无 API Key 时自动使用 Demo Provider；也可以显式指定：

```bash
npm run agent -- --provider demo "抓取第一页"
```

可选环境变量：

```bash
export DEEPSEEK_BASE_URL="https://api.deepseek.com"
export DEEPSEEK_MODEL="deepseek-chat"
```

每次 Agent 运行都会保存会话事件到 `data/agent-sessions/<session-id>.jsonl`。来源和许可证说明见 `src/core/NOTICE.md`。

## 模块文档

`docs/llm/` 提供 Core 各模块的最简使用示例：

- `docs/llm/agent.md`
- `docs/llm/agent-loop.md`
- `docs/llm/deepseek.md`
- `docs/llm/demo.md`
- `docs/llm/session.md`

## 输出文件

| 文件 | 说明 |
| --- | --- |
| `data/pages/*.json` | 单网址通用网页采集结果 |
| `data/pages/*.csv` | 单网址豆瓣 Top250 结构化结果 |
| `data/pages/*comments*.csv` | 京东、抖音、豆瓣电影或其他电影评论 |
| `data/raw_books.csv` | 原始抓取结果，保留评分和评价人数的网页原始文本 |
| `data/clean_books.csv` | pandas 清洗后的结构化数据 |
| `analysis/report.md` | 数据质量、总体统计、排名和分析结论 |
| `analysis/summary.json` | 机器可读的统计摘要 |
| `analysis/top_books.csv` | 评分最高的 20 本书 |
| `analysis/most_reviewed_books.csv` | 评价人数最多的 20 本书 |
| `analysis/rating_distribution.csv` | 评分区间分布 |
| `analysis/publisher_stats.csv` | 入榜图书最多的出版社 |
| `analysis/figures/rating_distribution.png` | 评分区间分布图，分析时自动刷新 |
| `analysis/figures/publisher_distribution.png` | 出版社分布图，分析时自动刷新 |
| `analysis/figures/rating_vs_reviews.png` | 评分与评价人数关系图，分析时自动刷新 |
| `analysis/books_enriched.csv` | 增加国家、题材和检索文本的增强数据 |
| `analysis/country_stats.csv` | 国家/地区统计 |
| `analysis/genre_stats.csv` | 题材规则分类统计 |
| `analysis/quote_word_freq.csv` | 短评高频词 |
| `analysis/quote_sentiment.csv` | 每条短评的情感得分 |
| `analysis/quote_topics.csv` | LDA 主题关键词 |
| `analysis/similar_books.csv` | 每本书的相似高分书推荐 |
| `data/snapshots/` | 每次分析保存的日期快照 |
| `dashboard/index.html` | 静态交互式数据看板 |

原始数据字段：

- `rank`：Top250 排名
- `title` / `subtitle`：书名 / 副标题
- `author_info`：页面中的作者、译者、出版社、日期、价格原文
- `rating_raw`：评分原文，例如 `9.7`
- `rating_count_raw`：评价人数原文，例如 `( 470903人评价 )`
- `quote`：页面短评
- `url` / `cover_url`：详情页 / 封面
- `fetched_at`：抓取时间（ISO 8601）

清洗后新增或规范化字段：

- `author`、`publisher`、`publish_date`、`price_cny`
- 数值型 `rating`、`rating_count`
- `data_quality_flags`：缺失填补或字段缺失标记

## 清洗规则

`analysis/clean_analyze.py` 使用 pandas 完成以下处理：

1. 去除首尾空白、合并连续空白、空字符串转换为缺失值。
2. 删除标题为空、完全重复和重复书名的记录；重复书名保留评价人数更多的一条。
3. 评分只接受 0-10 的数字；评价人数只保留数字并转换为整数。
4. 缺失或异常评分使用评分中位数填补；缺失或异常评价人数使用中位数填补。
5. 从 `author_info` 中解析作者、出版社、出版日期和人民币价格。
6. 在 `data_quality_flags` 中记录 `missing_price`、`invalid_rating_imputed` 等质量标记，避免静默修改数据。
7. 输出总体统计、评分区间分布、评分榜、评价人数榜和出版社榜。
8. 自动刷新 `analysis/figures/` 下的基础图表。
9. 生成国家、题材、作者、短评词频、情感、主题和相似推荐等高级结果。
10. 自动生成 `dashboard/index.html` 交互式看板。

## 测试

```bash
npm run test:all
```

- `npm test`：TypeScript 单元测试，覆盖通用网页提取、京东/抖音/豆瓣电影评论解析、电影评论 JSON-LD、URL 来源选择、CSV 输出和 Agent Core。
- `npm run test:python`：pandas 端到端清洗测试，覆盖空标题、内容重复、重复书名、异常评分/人数、缺失排名和报告输出。
- `npm run fetch:test`：独立的联网 smoke test，检查 HTTP 200、HTML 大小、解析条数和首条记录。

## 项目结构

```text
数据爬虫/zws-Agent/
├── src/
│   ├── sources/          # CrawlSource 数据源适配器
│   │   ├── jd-product-comments.ts
│   │   ├── douyin-video-comments.ts
│   │   ├── douban-movie-comments.ts
│   │   └── movie-review-pages.ts
│   ├── app/
│   │   ├── config.ts      # 应用配置
│   │   ├── presets.ts     # crawler / research Preset
│   │   ├── env.ts         # .env 读取
│   │   ├── index.ts       # 应用启动入口
│   │   ├── prompt.ts      # Agent 提示词
│   │   ├── runtime.ts     # 运行时控制
│   │   ├── trace.ts       # 运行追踪
│   │   └── tui/           # 终端 UI（TUI）
│   ├── agent-cli.ts      # 爬虫 Agent 命令行入口
│   ├── cli.ts            # zws-Agent 命令行与交互启动入口
│   ├── crawler.ts        # 通用抓取循环、单网址入口与文件写出
│   ├── fetch.ts          # fetch 超时、重试与退避
│   ├── parser.ts         # 豆瓣 Top250 页面解析
│   ├── comment-types.ts  # 统一评论记录模型
│   ├── comment-csv.ts    # 评论 CSV 输出
│   ├── comments/         # 浏览器采集与通用评论工具
│   ├── web-parser.ts     # 通用页面元数据与正文解析
│   ├── web-page-types.ts # 通用网页记录模型
│   ├── csv.ts            # CSV 序列化
│   ├── normalize.ts      # 文本与 URL 工具
│   ├── fetch-check.ts    # 联网 fetch 测试
│   ├── types.ts
│   └── core/             # DeepSeek Harness Core 最小适配层
│       ├── agent/        # Agent 契约与 ToolRegistry
│       ├── agent-loop/   # Agent 循环与爬虫工具
│       ├── llm/          # DeepSeek / Demo Provider
│       ├── plugins/
│       │   └── providers/deepseek/ # 插件、Hook 与生命周期管理
│       └── session/      # SessionLog 与事件日志
├── tests/
│   ├── web-page.test.ts  # 通用网页与单网址抓取测试
│   ├── comments.test.ts  # 评论适配器与评论输出测试
│   ├── parser.test.ts
│   └── harness.test.ts
├── analysis/
│   ├── clean_analyze.py   # 基础清洗与分析
│   ├── advanced_analysis.py # 趋势、文本、多维和推荐
│   ├── recommend.py       # 相似书查询
│   ├── run_analysis.sh    # 完整分析入口
│   ├── run_python.sh      # 自动使用 .venv
│   └── figures/           # 自动刷新图表
├── dashboard/
│   ├── generate_dashboard.py
│   ├── index.html
│   └── figures/
├── data/
│   ├── pages/             # 单网址采集结果
│   ├── raw_books.csv
│   ├── clean_books.csv
│   └── snapshots/         # 日期快照
├── package.json
├── tsconfig.json
└── requirements.txt
```

## 注意事项

- `zws-Agent` 用于课程学习和数据分析演示。抓取前请遵守目标网站的服务条款、robots.txt 和访问频率限制。
- 单网址模式使用超时与重试；豆瓣批量模式默认每页间隔 1.5 秒。
- 豆瓣页面结构可能变化；解析器测试和 `fetch:test` 可用于快速发现问题。
- 通用网页适配器只处理服务端返回的 HTML，不执行 JavaScript，不处理需要登录或验证码的页面。
- 京东与抖音评论需要 Chromium；登录态、地区、频率和站点策略都会影响可用性。
- 评论采集仅用于合法、低频的数据研究，不应用于绕过访问控制、验证码或站点限制。
- 原始数据中的 `rating_raw`、`rating_count_raw` 保留网页原文，清洗后的数值字段在 `data/clean_books.csv` 中。
