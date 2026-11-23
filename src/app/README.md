# src/app

应用层负责 `zws-Agent` 的终端交互、单网址页面/评论抓取控制、运行配置、Agent 提示词和追踪日志。

```text
src/app/
├── config.ts     # 环境变量与项目路径
├── env.ts        # .env 文件读取
├── index.ts      # 应用启动入口
├── prompt.ts     # Agent 系统提示词与默认任务
├── runtime.ts    # 摘要读取、npm 脚本执行、追踪
├── trace.ts      # JSONL 运行追踪
├── tui/          # 终端交互界面
└── README.md
```

运行：

```bash
npm start
```

应用层不直接实现页面或评论解析。`runtime.ts` 调用统一抓取服务、Agent 和项目脚本；评论类型由来源注册表自动选择，运行追踪保存到 `data/app-traces/`。
