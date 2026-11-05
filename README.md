<div align="center">

# 📚 dsh-weread

**在 DeepSeek Harness 里看今日阅读 · 重逢旧句 · 回顾笔记 · 管理书架 · AI 总结**

[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-dsh-1b88ee)](https://github.com/deepseek-ai/deepseek-harness)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![Version](https://img.shields.io/badge/version-0.2.0-blue.svg)](./package.json)
[![Changelog](https://img.shields.io/badge/changelog-0.2.0-informational.svg)](./CHANGELOG.md)

一个原生 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）Web 插件：
把你的**微信读书**书架、划线笔记、阅读统计搬进 dsh 界面，并用 dsh 内置模型生成 **AI 阅读总结与画像**。

</div>

---

## ✨ 功能

| | 功能 | 说明 |
|---|---|---|
| ☀️ | **今日** | 今日阅读／收听时长、今天读过的电子书、当日划线与想法、旧句重逢 |
| 🗓️ | **回顾** | 笔记日历、按日期回看划线与想法、那年今日；支持搜索与内容筛选 |
| 📚 | **书架** | 封面网格；搜索、筛选、排序；真实阅读进度；**按分类 / 阅读年份分组**（笔记模式） |
| 📖 | **阅读与原文跳转** | 书籍详情「去阅读」打开微信读书；个人划线和热门划线可点击正文或「回到原文」定位对应段落，缺少位置时打开书籍 |
| 🗂️ | **书架双数据源** | 一键切换**微信读书书架接口**与**笔记接口**；书架模式下**文件夹与书混排**，文件夹用内部封面拼贴成缩略图，支持文件夹页、有声书（专辑） |
| 🖼️ | **年度书墙** | 按**月份**拼封面墙，一年一张海报；年份切换；点封面进详情 |
| 📊 | **阅读统计** | 全年**日常热力图**（可切年份）、分类环形图、24 小时时段钟、偏爱作者/出版社、阅读最多、年度趋势 |
| 🤖 | **AI 总结** | 单本总结、划线主题分析、书架阅读画像，走 dsh 的 `ctx.llm` **流式**输出 |
| 💾 | **每日增量缓存** | 按账号隔离的 JSON 缓存；默认 24 小时同步一次；只更新笔记数量或时间有变化的书 |
| 🔑 | **API Key 管理** | 仅在 dsh 全局设置里配置，Key 只存宿主侧、浏览器只见掩码 |

## 📷 截图

<div align="center">

**今日** — 当日阅读／收听 · 今天翻开的书 · 旧句重逢 · 换一句／换一本

<img src="./docs/images/today.webp" alt="今日：阅读时长、今天读过的书与个人划线回顾" width="86%">

**书架（书架模式）** — 文件夹与书混排 · 文件夹用内部封面拼成缩略图 · 数量角标 · 真实阅读进度 · 筛选 / 排序

<img src="./docs/images/shelf.webp" alt="书架：文件夹与书混排" width="86%">

**统计** — 全年热力图（可切年份）· 分类环形图 · 时段钟 · 偏好排行

<img src="./docs/images/stats.webp" alt="阅读统计" width="86%">

**年度书墙** — 按月拼封面墙 · 年份切换

<img src="./docs/images/wall.webp" alt="年度书墙" width="86%">

</div>

## 🏗️ 架构

dsh 插件是**双半侧**结构（与 `aurora` 插件模板一致）：

```
浏览器 (React 经典脚本 bundle)
  └─ sidebar.panellist 图标 + main 面板  ── fetch('/api/weread/*')
宿主 (Node ESM, Cordis plugin)
  ├─ routes.ts       /shelf /bookshelf /book /chapters /highlights /reviews
  │                  /journal-cache /journal-notes /stats /heatmap /settings /auth /ai
  ├─ weread/gateway  微信读书 Agent Gateway 客户端（Bearer Key · undici + 可选代理）
  ├─ weread/parse    原始响应 → DTO
  ├─ store/cache     LRU + TTL + 请求单飞
  ├─ store/journalCache  按账号 JSON 缓存 + 24 小时增量同步 + 断点恢复
  └─ ai/             ctx.llm.stream 流式总结
```

- **认证**：仅 API Key（不依赖 Cookie）。Key 只存 `$DSH_HOME/storages/dsh-weread/config.json`（权限 600），浏览器只见 `wrk-****1234` 掩码。
- **数据代理**：所有微信读书请求都在宿主侧发出，浏览器只访问同源 `/api/weread/*`（认证/路由由 dsh 连接层负责）。
- **AI**：复用 dsh 已配置的模型（默认 `provider=magpie`、`model=workbuddy/deepseek-v4.1-flash`），无需额外密钥。

## 🚀 安装

前提：`DSH_HOME` 已配置（如 `/volume2/docker/dsh/home`），profile 为 `web`。

```bash
git clone https://github.com/zhaohongxuan/dsh-weread.git
cd dsh-weread
npm install --cache ./.npm-cache      # 本机全局 npm cache 属 root 时需换目录
npm run build                         # 产出 lib/index.js + lib/client.js
bash scripts/link-profile.sh web      # 等价 dsh plugin --profile web add --save-prod file:$PWD
```

然后：**dsh Web GUI → 设置 → 插件 → 打开 `dsh-weread` → 刷新页面**。左侧栏会出现「微信读书」入口。

## 🔑 配置 API Key

1. 打开 **dsh 全局设置 → 微信读书**。
2. 访问 <https://weread.qq.com/api/skills/apikeyGet>（已登录微信读书时直接返回 apikey），复制粘贴到输入框。
3. 点「保存并校验」，显示已授权即可。

> 💡 若提示「网络出口被风控拦截（403）」而 Key 本身有效，是当前出口 IP 被微信读书限制，配置可访问微信读书的代理即可（`config.json` 的 `proxy` 字段）。

## 🗂️ 书架数据源

设置页的「书架数据源」开关决定书架标签页读哪一份数据（**默认书架模式**）：

| 模式 | 接口 | 内容 |
|---|---|---|
| **书架模式**（默认） | `/shelf/sync` | 书架上的全部书、你的**文件夹（书单）**、**有声书（专辑）**；文件夹与书混排，文件夹卡片显示内部封面拼贴 |
| 笔记模式 | `/user/notebooks` | 只列出**有笔记的书**，带笔记/想法数量，可按分类与阅读年份分组 |

- 书架模式下点文件夹进入**文件夹页**（面包屑 + 返回），页内保持微信读书 App 里的原始顺序。
- 切换后点面板右上角 **⟳ 刷新** 生效；选择会持久化在 `$DSH_HOME/storages/dsh-weread/config.json`。
- 「有笔记」筛选与笔记角标只在笔记模式出现——书架接口不返回每本书的笔记数。
- 有声书卡片不可点击：`albumId` 与 `bookId` 是两个 id 空间，书籍详情页取不到专辑数据。

## ☀️ 今日与回顾

打开插件默认进入「今日」。阅读／收听时长取当月统计的日级数据，今天读过的电子书取真实书架的最近阅读时间；点击书名查看详情，也可以跳回微信读书继续阅读。

当天有划线时优先展示「今日划下的一句」，否则以「旧句重逢」回看过去的个人划线。每次打开或刷新今日都会**先随机选书、再随机选句**；选中后保持稳定，后台同步不会自动换句。**「换一句」在当前书内切换，「换一本」从全部缓存划线中切到不同的书**，选句本身不触发同步。句子本身和「回到原文」均可点击，在微信读书中定位对应划线；旧缓存缺少位置时仅按需补查这本书，无法定位的内容退回打开书籍。

「回顾」按**划线和个人想法的创建日期**展示笔记日历。可直跳月份、定位最近笔记日、选择日期、搜索书名／作者／内容、筛选划线／想法；「那年今日」回看往年同一天的笔记，无匹配时以「旧句重逢」呈现过去的划线。阅读卡片使用**左侧封面、右侧正文顶对齐**布局，窄面板下自动缩小封面。

- **无需数据库**：笔记以按账号隔离的 JSON 缓存在宿主插件数据目录，刷新页面和重启 dsh 后都能复用，API Key 仍只在宿主侧。
- **默认每 24 小时自动同步一次**：进入页面直接读缓存；过期后保留旧内容并后台同步。「今日／回顾」共享同一次同步，只有首次无缓存时展示扫描进度，也可主动点击同步。
- 首次跨书笔记每批扫描 6 本书，逐批显示结果与进度。退出页面不会中断宿主同步；失败保留已缓存内容并支持重试。
- 每日同步只先读一次笔记本概览，比较各书的划线数、想法／评论数及笔记更新时间：未变化的书直接复用缓存，只查询新增或变化书籍的内容。
- 回顾笔记、那年今日和旧句均展示书籍封面、书名、作者与章节；点击封面进入详情。封面使用缓存中已有地址，缺失或加载失败时显示占位。
- 当日数字在首次整理完成前属于已加载部分；回顾日历表示有笔记的日期，**不代表这些日期的完整阅读流水**。
- 今日书单只覆盖当前书架可识别的电子书；阅读／收听时长可能还包含听书，因此不能据此推算每本书当天的阅读时长。
- 日期跟随浏览器本地时区，阅读时长跟随微信读书上游的日级统计分桶；跨时区使用时，两者的日期边界可能不同。

## 🧑‍💻 开发

```bash
npm run build        # 构建 host + client
npm run dev          # 监听 src，改动即重建
npm run typecheck    # tsc --noEmit（host 侧）
npm test             # 解析器/配置/版本单测（node --test）
```

发版时同步三处：`package.json` 的 `version`、`VERSION` 文件、`CHANGELOG.md` 的版本小节。
`npm test` 会校验三者一致（`tests/version.test.mjs`），不一致直接失败。

浏览器 bundle 只能 `require` dsh 共享模块表的 6 个模块（`react` / `react/jsx-runtime` / `react-dom` / `react-dom/client` / `@deepseek-ai/cordis` / `zod`），图表全部用内联 SVG 手绘，无第三方 UI 依赖。

### 目录结构

```
src/
├── types.ts          两端共享 DTO
├── cordis.ts         cordis 子集类型（含 LLM 服务）
├── host/
│   ├── index.ts       apply：注册所有路由
│   ├── routes.ts      路由表 + 缓存 + 单飞
│   ├── weread/        gateway（Agent API）/ paginate / parse
│   ├── ai/            llm / prompts / handler（流式）
│   ├── store/cache.ts LRU+TTL
│   └── config.ts      凭证与配置（600 文件）
└── client/
    ├── index.ts       注册 sidebar.panellist + main 座位
    ├── shelf.tsx      书架入口：按设置分发到下面两个视图
    ├── bookshelf.tsx  书架模式（文件夹拼贴 + 文件夹页 + 有声书）
    ├── bookCard.tsx   两种数据源共用的书卡
    ├── bookDetail.tsx / bookwall.tsx / stats.tsx / settings.tsx
    ├── charts.tsx     环形图 / 热力图 / 时段钟 / 年度条形（内联 SVG）
    └── styles.css     weread- 前缀，--dsw-* 主题变量
```

## 📄 更新日志

见 [CHANGELOG.md](./CHANGELOG.md)。

## 📄 License

[MIT](./LICENSE)

<div align="center"><sub>Powered by <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a></sub></div>
