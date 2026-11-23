import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { commentsToCsv } from "../src/comment-csv";
import { crawlUrl } from "../src/crawler";
import {
  parseDoubanMovieComments,
  parseDouyinCommentPayload,
  parseJdCommentDom,
  parseJdCommentPayload,
  parseMovieReviews,
  resolveCrawlSource
} from "../src/sources";

const DOUBAN_PAYLOAD = {
  start: 0,
  count: 2,
  total: 100,
  interests: [
    {
      id: "c-1",
      comment: "经典电影，值得反复观看。",
      create_time: "2026-11-20 10:00:00",
      vote_count: 42,
      rating: { value: 5, star_count: 5 },
      user: { name: "影迷甲", loc: { name: "上海" } }
    },
    {
      id: "c-2",
      comment: "节奏很好。",
      create_time: "2026-11-21 11:00:00",
      vote_count: 8,
      rating: { value: 4, star_count: 4 },
      user: { name: "影迷乙", loc: { name: "北京" } }
    }
  ]
};

test("parses and serializes Douban movie comments", () => {
  const comments = parseDoubanMovieComments(
    DOUBAN_PAYLOAD,
    "1292052",
    "https://movie.douban.com/subject/1292052/",
    "2026-11-23T00:00:00.000Z",
    "肖申克的救赎"
  );
  assert.equal(comments.length, 2);
  assert.equal(comments[0]?.author, "影迷甲");
  assert.equal(comments[0]?.rating, 5);
  assert.equal(comments[0]?.location, "上海");

  const csv = commentsToCsv(comments);
  assert.match(csv, /^\ufeffsource,item_id/);
  assert.match(csv, /douban-movie/);
  assert.match(csv, /经典电影/);
});

test("parses JD JSONP and rendered DOM comment records", () => {
  const payload = {
    result: {
      maxPage: 3,
      comments: [
        {
          id: "jd-1",
          guid: "guid-1",
          content: "商品很好用，物流也快。",
          score: 5,
          creationTime: "2026-11-22 09:30:00",
          nickname: "京东用户",
          userClientShow: "广东",
          usefulVoteCount: 12,
          replyCount: 2,
          images: ["https://img.example/jd-1.jpg"]
        }
      ]
    }
  };
  const comments = parseJdCommentPayload(
    `skuJDEval(${JSON.stringify(payload)});`,
    "100012043978",
    "https://item.jd.com/100012043978.html",
    "测试商品",
    "2026-11-23T00:00:00.000Z"
  );
  assert.equal(comments.length, 1);
  assert.equal(comments[0]?.content, "商品很好用，物流也快。");
  assert.equal(comments[0]?.likes, 12);

  const domComments = parseJdCommentDom(
    `<div id="itemName">测试商品</div>
     <ul id="evalDet_main">
       <li productid="100012043978" guid="dom-1">
         <div class="cmt_user"><span class="user">页面用户</span></div>
         <div class="cmt_content">页面渲染评论</div>
         <div class="cmt_time">2026-11-22</div>
       </li>
     </ul>`,
    "100012043978",
    "https://item.jd.com/100012043978.html"
  );
  assert.equal(domComments.length, 1);
  assert.equal(domComments[0]?.author, "页面用户");
  assert.equal(domComments[0]?.itemTitle, "测试商品");
});

test("parses Douyin comment payload", () => {
  const comments = parseDouyinCommentPayload(
    JSON.stringify({
      status_code: 0,
      comments: [
        {
          cid: "dy-1",
          aweme_id: "7300000000000000001",
          text: "这个视频很有意思",
          create_time: 1_763_800_000,
          digg_count: 88,
          reply_comment_total: 3,
          ip_label: "浙江",
          user: { nickname: "抖音用户" },
          image_list: []
        }
      ]
    }),
    "7300000000000000001",
    "https://www.douyin.com/video/7300000000000000001",
    "测试视频"
  );
  assert.equal(comments.length, 1);
  assert.equal(comments[0]?.content, "这个视频很有意思");
  assert.equal(comments[0]?.likes, 88);
  assert.equal(comments[0]?.location, "浙江");
});

test("parses JSON-LD movie reviews from other review sites", () => {
  const html = `<html><head>
    <meta property="og:title" content="Example Movie">
    <script type="application/ld+json">
      {"@context":"https://schema.org","@type":"Review","author":{"@type":"Person","name":"Alice"},
       "reviewBody":"A thoughtful and entertaining film.","datePublished":"2026-11-20",
       "reviewRating":{"ratingValue":4.5,"bestRating":5},
       "url":"https://letterboxd.com/user/film/example/"}
    </script>
  </head><body></body></html>`;
  const comments = parseMovieReviews(
    html,
    "https://letterboxd.com/film/example/reviews/"
  );
  assert.equal(comments.length, 1);
  assert.equal(comments[0]?.author, "Alice");
  assert.equal(comments[0]?.rating, 4.5);
  assert.equal(comments[0]?.itemTitle, "Example Movie");
});

test("routes supported content sites to specialized adapters", () => {
  assert.equal(
    resolveCrawlSource("https://item.jd.com/100012043978.html").kind,
    "jd-product-comments"
  );
  assert.equal(
    resolveCrawlSource("https://www.douyin.com/video/7300000000000000001").kind,
    "douyin-video-comments"
  );
  assert.equal(
    resolveCrawlSource("https://movie.douban.com/subject/1292052/").kind,
    "douban-movie-comments"
  );
  assert.equal(
    resolveCrawlSource("https://letterboxd.com/film/example/reviews/").kind,
    "movie-review-page"
  );
  assert.equal(
    resolveCrawlSource("https://example.com/article").kind,
    "web-page"
  );
});

test("crawls and writes paginated Douban movie comments through the registry", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "zws-agent-comments-"));
  const originalFetch = globalThis.fetch;
  let commentRequests = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/j/subject_abstract")) {
      return new Response(
        JSON.stringify({ subject: { title: "肖申克的救赎" } }),
        { status: 200 }
      );
    }
    commentRequests += 1;
    return new Response(
      JSON.stringify({
        ...DOUBAN_PAYLOAD,
        interests: commentRequests === 1 ? DOUBAN_PAYLOAD.interests : []
      }),
      { status: 200 }
    );
  };

  try {
    const outputPath = path.join(directory, "douban-comments.csv");
    const result = await crawlUrl(
      "https://movie.douban.com/subject/1292052/",
      { pages: 3, pageSize: 20, delayMs: 0, outputPath }
    );
    assert.equal(result.kind, "douban-movie-comments");
    assert.equal(result.title, "肖申克的救赎");
    assert.equal(result.rowCount, 2);
    assert.equal(commentRequests, 2);
    const csv = await readFile(outputPath, "utf8");
    assert.match(csv, /肖申克的救赎/);
    assert.match(csv, /节奏很好/);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});
