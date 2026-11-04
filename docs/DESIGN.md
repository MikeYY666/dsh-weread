# dsh-weread 设计方案

> 一个 DeepSeek Harness（dsh）插件：在 dsh Web GUI 里管理微信读书书架、查看划线/笔记/书评、阅读统计，并调用 DeepSeek 做书籍 AI 分析与总结。
> 设计参考：[zhaohongxuan/obsidian-weread-plugin](https://github.com/zhaohongxuan/obsidian-weread-plugin)（V2.3.0，Agent API 架构）。架构模板参考本工作区 `aurora` 插件集。

- 状态：**设计方案（待评审）**
- 目标版本：`0.1.0`
- 作者：dsh agent
- 日期：2026-11-04

---

## 1. 背景与目标

### 1.1 为什么做
`obsidian-weread-plugin` 已经验证了微信读书数据可以通过 **Agent Gateway API**（`POST https://i.weread.qq.com/api/agent/gateway`，Bearer API Key）稳定获取，无需长期维护 Cookie。但它绑定 Obsidian（Markdown 落库、本地文件同步、Nunjucks 模板）。

本项目的目标是把"微信读书的数据能力 + AI 能力"搬进 **dsh Web GUI**，形态是一个**原生 dsh 插件**（宿主 Node 半侧 + 浏览器 React 半侧），而不是文件同步器。

### 1.2 目标（MVP 必达）
- **书架管理**：拉取完整书架 / 有笔记的书，展示封面、作者、阅读进度、笔记数，支持搜索、筛选、排序、分组。
- **书籍详情**：单本书的书籍信息、章节、划线（含颜色/共读人数）、个人想法/点评、热门划线、公开书评。
- **阅读统计**：周/月/年/总览的阅读时长、读天数、分类偏好、作者偏好、热力图。
- **AI 分析 / 总结**（核心差异化）：对单本书或整个书架，调用 dsh 内置 DeepSeek LLM 生成：
  - 单本：《内容摘要》《核心观点 / 金句提炼》《我的划线主题分析》
  - 跨书：《书架阅读画像》《主题聚类》《推荐下一步读什么》
- **凭证管理**：在插件设置里存 API Key（也支持 Cookie 回退），带有效性校验。

### 1.3 非目标（明确不做）
- ❌ 不做 Markdown 文件同步 / Nunjucks 模板渲染（obsidian 插件的核心，对 dsh 无意义）。
- ❌ 不做 CookieCloud 集成（第一版）。
- ❌ 不做微信公众号文章同步（第一版，后续可作为延伸）。
- ❌ 不落库到本地 Obsidian vault；数据缓存在 dsh home 的插件数据目录。

---

## 2. 参考项目能力映射

| obsidian-weread 能力 | dsh-weread 对应 | 备注 |
|---|---|---|
| `/shelf/sync`、`/user/notebooks` | 书架列表 RPC | 直接复用 V2 分页逻辑 |
| `/book/info`、`/book/chapterinfo`、`/book/getprogress` | 书籍详情 RPC | 复用 |
| `/book/bookmarklist`、`/review/list/mine` | 划线/想法 RPC | 复用解析（去 moment/CryptoJS 依赖） |
| `/book/bestbookmarks`、`/review/list` | 热门划线/公开书评 RPC | 复用 |
| `/readdata/detail` | 阅读统计 RPC | 复用 |
| V1 Cookie 接口 | Cookie 回退通道 | 降级方案 |
| Markdown 模板渲染 | — | **移除**（改为 Web 卡片 UI） |
| 本地文件管理器 | — | **移除** |
| — | **AI 分析 / 总结** | **新增（基于 dsh LLM 服务）** |

---

## 3. 整体架构

dsh 插件**双半侧**结构（与 `aurora-system-stats` 完全一致）：

```
┌────────────────────────────── dsh Web GUI (浏览器) ──────────────────────────────┐
│  dsh-weread client bundle (React, 经典脚本, window.__ModuleLoader__)              │
│  ├─ WereadShelfPanel    书架网格 + 搜索/筛选/排序 + 分组                          │
│  ├─ WereadBookDetail    书籍详情抽屉：划线 / 笔记 / 热门划线 / 书评 / AI          │
│  ├─ WereadStatsView     阅读统计仪表盘（时长、偏好、热力图）                      │
│  ├─ WereadSettings      设置面板：API Key / Cookie / AI 模型参数                 │
│  └─ WereadAiPanel       AI 总结卡片 + 流式输出                                   │
└───────────────────────────────────┬──────────────────────────────────────────────┘
                                     │ fetch('/api/weread/*')  （共享 connection 通道，认证由 dsh 负责）
┌───────────────────────────────────┴──────────────────────────────────────────────┐
│  dsh-weread host (Node ESM, Cordis plugin)                                        │
│  ├─ routes/        若干精确 Fetch 路由：shelf / book / highlights / reviews /      │
│  │                 stats / ai / auth                                            │
│  ├─ weread/        Agent Gateway 客户端 + 分页 + 缓存 + V1 Cookie 回退             │
│  ├─ ai/            调用 dsh 的 LLM 服务（inject ['llm'] 或等价），组 prompt、流式   │
│  ├─ store/         插件数据目录缓存（JSON），书架缓存 TTL                          │
│  └─ config/        API Key / 模型配置（走 dsh 凭证或插件数据目录）                 │
└──────────────────────────────────────────────────────────────────────────────────┘
         │ HTTPS Bearer                         │ 进程内 LLM 服务
         ▼                                      ▼
   微信读书 Agent Gateway                 DeepSeek（dsh 已配置的模型）
```

### 3.1 为什么宿主侧代理一切（不在浏览器直连微信读书）
1. **CORS / 凭证安全**：API Key 不能出现在浏览器里，也不能让页面直连 `i.weread.qq.com`。
2. **复用 dsh 的认证连接层**：`ctx.connection.fetch.register({ path, methods, fetch })`，路径挂在共享 `/api` 通道，Host/Origin 校验和浏览器凭证由 dsh 负责（aurora 已验证此模式）。
3. **缓存与限流**：书架/统计等重接口在宿主侧集中缓存，避免多标签页打爆。
4. **AI 调用**：dsh 的 LLM 只在宿主侧可用，浏览器半侧无法直接调模型。

---

## 4. 插件契约（dsh 侧）

> 严格遵循 `aurora/AGENTS.md` 记录的踩坑经验。

### 4.1 package.json 关键字段
```jsonc
{
  "name": "dsh-weread",
  "version": "0.1.0",
  "type": "module",
  "main": "lib/index.js",              // host 插件入口 (ESM)
  "exports": {
    ".": { "types": "./lib/index.d.ts", "default": "./lib/index.js" },
    "./client": "./lib/client.js",     // 浏览器 bundle
    "./package.json": "./package.json"
  },
  "files": ["lib/**/*.js", "lib/**/*.d.ts", "cordis.patch.yml", "README.md", "LICENSE"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web" }
  },
  "engines": { "node": "^22.19.0 || >=24.0.0", "dsh": ">=0.2.0-rc.2" },
  "peerDependencies": { "@deepseek-ai/cordis": "^4.0.4" }
}
```

### 4.2 cordis.patch.yml
```yaml
- insert:
    - id: dsh-weread
      name: dsh-weread
```

### 4.3 宿主入口 `src/host/index.ts`
- 导出 `name` / `inject` / `apply(ctx, config)`。
- `inject = ['connection']`（+ AI 时 `'llm'`）。所有路由在 `ctx.inject(['connection'], scope => …)` 里注册，用 `ctx.effect(...)` 包 detach。

### 4.4 浏览器入口 `src/client/index.ts`
- 导出 `name` / `inject = ['slots', ...]` / `register(ctx, config)`。
- 末尾必须 `module.exports.name/inject/apply = …`（经典脚本漏这步会报 "did not export the plugin apply"）。
- 只 `require` 共享模块表：`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、`zod`。UI 组件全部手写（`createElement` + `--dsw-*` 主题变量），零第三方 UI 依赖。

### 4.5 座位（slot）与入口
- 书架/详情/统计主界面挂在 **`shell.overlay`**（浮层）还是需要一个可导航的页面？
  - dsh 的 shell 座位实测只有 `shell.leading` / `shell.bottom` / `shell.overlay`。
  - **方案 A（推荐 MVP）**：`shell.leading` 放一个"微信读书"入口按钮（侧栏），点击用 `shell.overlay` 打开全屏抽屉式面板。抽屉内部用 tab 切换 书架 / 统计 / 设置。
  - **方案 B（后续）**：若 dsh 支持命令/页面路由，则注册一个独立命令 `weread` 打开面板。
- 单本书详情用抽屉内二级视图（overlay 内 navigate），不新增座位。

---

## 5. 数据流与 API 设计

### 5.1 宿主侧精确 Fetch 路由
统一前缀 `/api/weread`，全部 `GET`（AI 用 `POST`）：

| 路由 | 方法 | 说明 | 缓存 |
|---|---|---|---|
| `/api/weread/shelf` | GET | 书架（notebooks ∪ shelf/sync 合并） | 5 min |
| `/api/weread/book` | GET `?bookId=` | 书籍详情 | 1 h |
| `/api/weread/chapters` | GET `?bookId=` | 章节目录 | 1 h |
| `/api/weread/highlights` | GET `?bookId=` | 划线 | 10 min |
| `/api/weread/reviews` | GET `?bookId=` | 个人想法/点评 | 10 min |
| `/api/weread/popular` | GET `?bookId=` | 热门划线 TOP20 | 24 h |
| `/api/weread/public-reviews` | GET `?bookId=` | 公开书评 | 1 h |
| `/api/weread/progress` | GET `?bookId=` | 阅读进度 | 5 min |
| `/api/weread/stats` | GET `?mode=&baseTime=` | 阅读统计 | 10 min |
| `/api/weread/auth/status` | GET | 凭证状态、用户标识 | — |
| `/api/weread/auth/key` | POST | 保存/校验 API Key | — |
| `/api/weread/ai/summarize` | POST | 单本 AI 总结（流式） | — |
| `/api/weread/ai/profile` | POST | 书架 AI 阅读画像（流式） | — |

响应统一信封（沿用 aurora 风格，便于前端判定）：
```ts
type Envelope<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
```

### 5.2 微信读书客户端（`src/host/weread/`）
- `gateway.ts`：`callAgent(apiName, params)` → POST gateway，Bearer Key，`skill_version:"1.0.3"`，参数平铺顶层。`errcode!==0` 抛结构化错误。
- `paginate.ts`：`/user/notebooks` 游标分页（`count=300` + `lastSort`）；`/shelf/sync` 一次全量。
- `v1-cookie.ts`：V1 Cookie 回退（`/api/user/notebook`、`/web/book/*`），复用 obsidian 的 `getHeaders` 逻辑。第一版可仅留接口、默认只用 V2。
- `parse.ts`：把原始响应转成前端 DTO。**移植要点**：
  - 去掉 `window.moment` → 用 `Intl` / 手写日期格式化。
  - 去掉 `CryptoJS`（obsidian 用它算稳定 bookmarkId/文件名）→ 本插件不落文件，**不需要**；若需要稳定 id 用 Node `crypto`。
  - `cover.replace('/s_','/t7_')` 高清封面保留。
  - `NodeHtmlMarkdown`：公开书评/想法有 `htmlContent`，宿主侧可用轻量正则剥离 HTML 或引入 `node-html-markdown`（宿主侧可装 npm 依赖，不像浏览器 bundle 受限）。

### 5.3 数据 DTO（`src/types.ts`，两端共享）
关键类型（精简自 obsidian `models.ts`）：
```ts
interface BookshelfBook { bookId; title; author; cover?; noteCount; reviewCount;
  lastReadDate?; isArticle; progress: { state; readingProgress?; readingTime? } }
interface BookDetail { bookId; title; author; cover; intro; category; publisher;
  totalWords; rating; newRatingCount; ... }
interface Highlight { bookmarkId; chapterUid; chapterTitle; markText; colorStyle;
  createTime; reviewContent?; isPopular?; popularCount? }
interface Review { reviewId; chapterUid?; chapterTitle?; content; createTime; ... }
interface ReadingStats { totalReadTime; readDays; dayAverageReadTime; readStat[];
  readTimes; preferCategory[]; preferAuthor[]; preferTime[]; yearReport[]; ... }
```

### 5.4 缓存与限流
- 宿主内存 LRU + TTL（上面表）。书架/统计等重接口做单飞（in-flight 合并），防止多标签风暴（aurora 的 `MIN_INTERVAL_MS` 单飞模式）。
- 可选：持久化到 `ctx` 的插件数据目录（若 dsh 提供），cold-start 先用缓存再刷新。

---

## 6. AI 分析 / 总结设计（核心）

### 6.1 LLM 接入（已核实契约）
dsh 提供 provider 中立的模型调用服务 `ctx.llm`（包 `@deepseek-ai/dsh-llm`）。已核实的确切用法：

```ts
// host 插件 inject: ['connection', 'llm']
for await (const chunk of ctx.llm.stream({
  provider: 'magpie',                       // 本机 profile 当前默认 provider
  model: 'workbuddy/deepseek-v4.1-flash',   // 当前默认 model
  messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
})) {
  // chunk: block-start → text-delta* → usage → finish（总是以 finish 终态结束）
}
```

- provider/model 解析：`ctx.llm.listProviders()` 列出已注册 provider；默认模型来自 profile 的 `agent-default-model` 行（本机为 `magpie` / `workbuddy/deepseek-v4.1-flash`）。
- 设置里允许用户覆盖 provider/model；未指定时回落到 dsh 默认。
- **不再需要自建 key 或直连 magpie 网关** —— 直接复用 dsh 已注入的模型凭据（这是本设计的最大简化点）。

### 6.2 提示词与任务
| 任务 | 输入 | 输出 |
|---|---|---|
| 单本总结 | 书籍元数据 + 章节标题 + 用户划线全文 + 想法 + 热门划线 | 结构化 Markdown：一句话总结 / 核心观点 / 金句 TOP5 / 我的关注点 |
| 划线主题分析 | 用户全部划线 | 主题聚类 + 每类代表划线 |
| 书架阅读画像 | 跨书元数据 + 统计 + 划线摘要 | 阅读偏好画像 / 主题分布 / 下一步推荐 |
| 单条共读 | 某划线 + 公众想法 | 该划线观点聚合 |

### 6.3 流式输出
- 宿主 `POST /api/weread/ai/summarize` 返回 SSE / chunked 文本流；前端 `WereadAiPanel` 用 `ReadableStream` 增量渲染（打字机效果）。
- 长书内容超上下文时：先对章节做 map-reduce（章节摘要 → 全书汇总），控制 token。
- AI 结果缓存到书架缓存旁（按 bookId + prompt 版本），避免重复计费。

### 6.4 隐私与成本
- 只把**用户自己的**划线/笔记发往 LLM；不外传。
- 设置里可开关"AI 功能"、选择模型、限制单次最大 token。
- 展示"本次消耗 token / 估算成本"。

---

## 7. UI 设计（浏览器半侧）

零依赖手写 React（`createElement`），沿用 `--dsw-*` 主题变量，`weread-` 前缀类名。

- **入口**：`shell.leading` 一个书籍图标按钮（badge 显示待同步/在读数量）。
- **主面板**（`shell.overlay` 抽屉，右滑或居中）：
  - Header：用户标识 + 刷新 + 设置齿轮。
  - Tabs：`书架` / `统计` / `设置`。
- **书架**：网格卡片（封面、标题、作者、进度条、笔记数角标）。工具条：搜索框、筛选（在读/读完/有笔记）、排序（最近阅读/书名/进度）、分组（按年份/分类）。
- **书籍详情**（书架内二级）：封面 + 元数据；Tabs：`划线` / `笔记` / `热门划线` / `书评` / `AI 总结`。划线按章节分组、颜色边线。
- **统计**：时长卡片、日历热力图（`readTimes`）、分类/作者偏好条形图、年度对比。
- **设置**：API Key 输入 + "校验"按钮 + "扫码获取"引导（链接 `weread.qq.com/api/skills/apikeyGet`）；AI 开关/模型/最大 token；缓存清理。
- **响应式与主题**：跟随 dsh 明暗主题；面板宽度自适应。

> UI 不引入第三方图表库：热力图/条形图用 SVG 手绘（aurora 已有 Sparkline 可借鉴）。

---

## 8. 凭证与安全

- **API Key 存储**：优先 dsh 凭证系统（`@deepseek-ai/dsh-credentials-local` 的 refs）；否则写入插件数据目录文件（`chmod 600`），**绝不入库/入 git**。
- **不进浏览器**：Key 只在宿主侧使用；前端只看到 `masked` 前缀（`wrk-****1234`）和有效性。
- **Cookie 回退**：若用户坚持用 Cookie，存于宿主数据目录，`getHeaders` 组装；iOS URL 编码问题在 dsh 桌面场景可忽略。
- **网络**：宿主出站需能访问 `i.weread.qq.com`。本机被墙/需代理时，支持在插件设置里配置 `HTTPS_PROXY`（宿主 fetch 的 `dispatcher`/`undici ProxyAgent`），默认用本机 relay `127.0.0.1:7899`（与工作区其它服务一致）。

---

## 9. 目录结构（拟）

```
dsh-weread/
├── package.json
├── tsconfig.json
├── cordis.patch.yml
├── README.md
├── LICENSE
├── docs/DESIGN.md              # 本文件
├── scripts/build.mjs           # 复制 aurora 的 build.mjs（host ESM + client classic bundle）
├── src/
│   ├── types.ts                # 共享 DTO
│   ├── cordis.ts               # cordis 子集类型
│   ├── host/
│   │   ├── index.ts            # apply：注册所有路由
│   │   ├── routes.ts           # 路由表 + 单飞 + 缓存
│   │   ├── weread/
│   │   │   ├── gateway.ts      # Agent Gateway 客户端
│   │   │   ├── paginate.ts
│   │   │   ├── v1-cookie.ts    # 回退（可选）
│   │   │   └── parse.ts        # 原始 → DTO
│   │   ├── ai/
│   │   │   ├── llm.ts          # 调 dsh LLM 服务
│   │   │   ├── prompts.ts      # 各任务提示词
│   │   │   └── stream.ts       # SSE/stream 封装
│   │   ├── store/cache.ts      # LRU + TTL
│   │   └── config.ts           # 凭证/设置读取
│   └── client/
│       ├── index.ts            # 注册 slot + module.exports 插件面
│       ├── panel.tsx           # 主抽屉（tabs）
│       ├── shelf.tsx
│       ├── bookDetail.tsx
│       ├── stats.tsx
│       ├── aiPanel.tsx
│       ├── settings.tsx
│       ├── charts.tsx          # 热力图/条形图/SVG
│       ├── icons.tsx
│       ├── api.ts              # fetch 封装
│       └── styles.css
├── lib/                        # 构建产物（gitignore）
└── tests/                      # 解析器单测（vitest）
```

---

## 10. 开发与安装流程（本机环境）

沿用 aurora 已验证流程（DSH_HOME=`/volume2/docker/dsh/home`，profile=web）：

```bash
cd dsh-weread
npm install --cache ./.npm-cache     # 该机全局 npm cache 属 root，需换目录
node scripts/build.mjs               # 产出 lib/index.js + lib/client.js
bash scripts/link-profile.sh web     # 等价 dsh plugin --profile web add --save-prod file:$PWD
# 然后 dsh Web GUI → 设置 → 插件 → 开启 dsh-weread → 刷新页面
```

> ⚠️ **重启注意**：不要在本会话回合内 `systemctl --user restart dsh.service`（会把 agent 自己的 cgroup 杀掉，见工作区已知坑）。插件加载/热更新优先靠 dsh 的 loader / 页面刷新生效；必须重启时用 `setsid nohup sh -c 'sleep 2; systemctl --user restart dsh.service' &` 延迟到会话外。

### 开发里程碑（建议分期）
- **M1 骨架**：复制 aurora 结构，跑通 host 路由 `/api/weread/ping` + client 空面板，link + 页面可见。
- **M2 书架**：gateway 客户端 + `/shelf` + 书架网格 UI。
- **M3 详情**：book/chapters/highlights/reviews/popular/public-reviews + 详情抽屉。
- **M4 统计**：`/stats` + 仪表盘。
- **M5 设置与凭证**：Key 存储/校验、代理配置。
- **M6 AI**：LLM 接入 + 单本总结（流式）→ 书架画像。
- **M7 打磨**：缓存、错误态、空态、主题、测试。

---

## 11. 风险与待确认

| # | 风险 / 待确认 | 影响 | 应对 |
|---|---|---|---|
| 1 | ~~dsh LLM 服务契约不明~~ ✅ **已核实**：`ctx.llm.stream({provider,model,messages})`，默认 provider=magpie，model=workbuddy/deepseek-v4.1-flash | — | 已解决，见 §6.1 |
| 2 | 宿主出站访问 `i.weread.qq.com` 是否需代理 | 数据拉取失败 | 设置里配 `HTTPS_PROXY`，默认 127.0.0.1:7899 |
| 3 | API Key 获取需扫码登录（无头环境难自动化） | 首次配置 | 提供"手动访问 apiKeyGet 复制粘贴"路径 + 校验 |
| 4 | shell 座位只有 leading/bottom/overlay，无"页面路由" | UI 承载方式 | 用 leading 入口 + overlay 抽屉；确认是否有命令系统可开独立页 |
| 5 | 大量划线/长文本超上下文 | AI 总结质量/成本 | map-reduce 章节摘要 |
| 6 | dsh 插件 `files` 复制语义（非软链白名单） | 改代码要重 link | 沿用 aurora 流程 |
| 7 | API Key 明文存储安全 | 泄露风险 | 优先 dsh 凭证系统；文件 600；不进 git |

---

## 12. 验收标准（MVP）

1. 在 dsh 设置→插件里能开启 `dsh-weread`，刷新后侧栏出现入口。
2. 填入 API Key 并校验成功，书架正确展示（封面/作者/进度/笔记数），搜索筛选排序可用。
3. 点开书籍详情，划线/笔记/热门划线/书评四个 tab 有数据且分组正确。
4. 统计页展示时长、热力图、分类/作者偏好。
5. 对单本书生成 AI 总结（流式），并缓存；对书架生成阅读画像。
6. 断网/Key 失效有清晰错误态；缓存与单飞生效。
7. 构建 `node scripts/build.mjs` 零错误，`tsc --noEmit` 通过，解析器单测通过。

---

## 13. 附录：关键接口速查（来自参考仓库 docs）

- Gateway：`POST https://i.weread.qq.com/api/agent/gateway`，Bearer，body `{api_name, skill_version:"1.0.3", ...扁平参数}`。
- 接口：`/shelf/sync`、`/user/notebooks`（`count`+`lastSort` 游标）、`/book/info`、`/book/chapterinfo`、`/book/getprogress`、`/book/bookmarklist`、`/review/list/mine`（`bookid` 小写）、`/book/bestbookmarks`、`/book/underlines`、`/book/readreviews`、`/review/single`、`/review/list`、`/readdata/detail`、`/book/recommend`、`/book/similar`、`/store/search`、`/_list`。
- 获取 Key：`GET https://weread.qq.com/api/skills/apikeyGet`（扫码登录后返回 apikey）。

---

## 14. 实施状态（MVP 已完成）

已按本方案落地 MVP，并通过构建 / 类型检查 / 单测 / 配置装载验证：

| 模块 | 文件 | 状态 |
|---|---|---|
| 插件骨架（build / package / cordis.patch） | `scripts/build.mjs`, `package.json`, `cordis.patch.yml` | ✅ |
| 共享 DTO | `src/types.ts` | ✅ |
| 微信读书客户端（Agent Gateway + 分页，仅 API Key） | `src/host/weread/{gateway,paginate,parse}.ts` | ✅ |
| 缓存（LRU+TTL+单飞） / 凭证（600 权限文件） | `src/host/store/cache.ts`, `src/host/config.ts` | ✅ |
| 路由表（shelf/book/chapters/highlights/reviews/popular/public-reviews/stats/auth/ai） | `src/host/routes.ts` | ✅ |
| AI（`ctx.llm.stream` 流式，3 个任务） | `src/host/ai/{llm,prompts,handler}.ts` | ✅ |
| 书架 / 详情 / 统计 / 设置 / AI UI + 侧栏入口 + overlay 抽屉 | `src/client/*` | ✅ |
| 统计可视化组件（环形图 / 时段钟 / 热力图 / 年度条形，参考 dsh-context） | `src/client/charts.tsx`, `stats.tsx` | ✅ |
| 单测（解析器 + 配置，14 例） | `tests/*.test.mjs` | ✅ |

**验证结果**：`node scripts/build.mjs` → `built host + client`；`tsc --noEmit` 退出 0；`node --check lib/client.js` 通过；`node --test` 14/14；已 `link-profile.sh web` 装入 profile，`dsh --dump-config` 显示 `dsh-weread` 行无报错，运行时 import 成功。

**后续可选增强**：Cookie 回退通道、公众号文章同步、AI 章节 map-reduce（超长书）、导出 Markdown。
