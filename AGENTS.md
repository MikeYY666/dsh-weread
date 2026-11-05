# AGENTS.md

给在本仓库工作的 AI 编码代理（以及新加入的人）的说明。**改代码前请读完「硬约束」一节**，
那里的几条都是踩过坑之后总结出来的，违反会静默失败或直接让插件激活不了。

## 这是什么

`dsh-weread` 是一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）的 Web 插件：
把微信读书的书架、划线笔记、阅读统计搬进 dsh 界面，并用 dsh 内置模型生成 AI 阅读总结。

它不是独立应用，**没有自己的服务端**：宿主侧是一个 Cordis 插件，向 dsh 的连接层注册
`/api/weread/*` 路由；浏览器侧是一个经典的 React bundle，注册进 dsh 的 sidebar/main 座位。

## 常用命令

```bash
npm install                 # 首次；全局 npm cache 属 root 时加 --cache ./.npm-cache
npm run build               # 产出 lib/index.js（宿主）+ lib/client.js（浏览器）
npm run dev                 # 监听 src，改动即重建
npm run typecheck           # tsc --noEmit —— 只覆盖宿主侧与 src/types.ts
npm test                    # node --test，解析器 / 配置 / 版本一致性
```

`lib/` 是构建产物且已被 `.gitignore` 忽略，**不要提交**。

## 架构

```
浏览器 (React 经典脚本 bundle)
  └─ sidebar.panellist 图标 + main 面板 ── fetch('/api/weread/*')
宿主 (Node ESM, Cordis plugin)
  ├─ routes.ts        路由表（返回 Response，不做 HTTP plumbing）
  ├─ weread/gateway   微信读书 Agent Gateway 客户端（Bearer Key · undici + 可选代理）
  ├─ weread/parse     原始响应 → DTO
  ├─ weread/paginate  /user/notebooks 的 lastSort 游标翻页
  ├─ store/cache      LRU + TTL + 请求单飞
  ├─ ai/              ctx.llm.stream 流式总结
  └─ config.ts        凭证与配置（$DSH_HOME/storages/dsh-weread/config.json，600）
```

**API Key 只活在宿主侧**：浏览器永远只拿到 `wrk-****1234` 这样的掩码和状态。
任何把 Key 塞进响应体、日志、或前端状态的改动都不可接受。

## 硬约束

1. **浏览器 bundle 只能 `require` 这 6 个模块**：`react`、`react/jsx-runtime`、`react-dom`、
   `react-dom/client`、`@deepseek-ai/cordis`、`zod`。其余一律要打包进来。
   `scripts/build.mjs` 会在包装 client bundle 时校验，出现别的裸 import 直接构建失败。
   **不要引入第三方 UI / 图表库**——图表都是内联 SVG 手写的。

2. **exact Fetch 路由表按 `path` 唯一索引**。同一路径注册两次会抛
   `exact Fetch route "..." is already registered`。需要多个方法就在**一条**路由里写
   `methods: ['GET', 'POST']`，在 handler 里按 `request.method` 分支。
   新增路由后建议自检一遍没有重复 path。

3. **样式标签按 id 去重**。`src/client/styles.ts` 的 `TAG_ID` 是
   `dsh-weread/styles.css?v=N`，`injectStyles()` 命中已存在的标签就直接 return。
   **改了 `styles.css` 必须把 `N` 加一**，否则热替换场景下新样式会静默不生效，
   表现为「改动没效果」而不是报错。

4. **DTO 只放在 `src/types.ts`**。两端共用、无运行时依赖，路由回包一律是
   `Envelope<T>`（`{ ok: true, value }` / `{ ok: false, error }`）。

5. **版本三处必须一致**：`package.json` 的 `version`、`VERSION` 文件、`CHANGELOG.md`
   里对应的 `## [x.y.z]` 小节。`tests/version.test.mjs` 会强制校验，
   不一致直接测试失败。发版时三处一起改。

6. **配置里不要凭空造字段**。`readConfig()` 只附加文件里真实存在的可选键
   （缺省即默认值，例如 `shelfMode` 缺省 = `bookshelf`），
   这样用户配置文件不会因为读一次就被写脏；已有单测锁定该行为。

7. **新增上游接口前先读 skill 文档**。微信读书接口的参数、字段含义、
   计数口径以 `weread-skills` skill 下的 `shelf.md` / `notes.md` / `readdata.md` 等为准，
   不要凭字段名猜。

## 双数据源的行为差异（改书架相关代码时注意）

| | 书架模式（默认，`/shelf/sync`） | 笔记模式（`/user/notebooks`） |
|---|---|---|
| 覆盖范围 | 书架上的全部书 + 文件夹 + 有声书 | 只有有笔记的书 |
| 笔记/想法数 | **没有** | 有 |
| 进度 | 只有 `finishReading`（二元），靠 `/progress-batch` 补齐 | 行内带 `readingProgress` |
| 最后阅读时间 | `readUpdateTime` | `sort` |

书架模式下 `books[]` **已包含**文件夹里的书，所以顶层只显示「未归入任何文件夹」的书，
文件夹页按 `bookIds` 取书——不要两边都列，会重复。

## 本地跑起来

```bash
npm run build
bash scripts/link-profile.sh web     # 等价 dsh plugin --profile web add --save-prod file:$PWD
```

安装结果是 **symlink**（`node_modules/dsh-weread -> 仓库目录`），所以改完只需 `npm run build`：

- **浏览器侧改动**：刷新 dsh 页面即可（配合上面的 `TAG_ID` 版本号）。
- **宿主侧改动**：运行中的进程已 import 旧模块。要么重启 dsh，要么触发一次 profile
  重算（例如在插件管理里把该行禁用再启用），重算会替换磁盘上已变化的链接包文件。

若 `dsh plugin add` 报 `ERR_PNPM_ADDING_TO_ROOT`，是 profile 的 `pnpm-workspace.yaml` 声明了
`packages: [.]` 而 pnpm 拒绝根级安装；在该 profile 目录建 `.npmrc` 写
`ignore-workspace-root-check=true` 即可（写进 `pnpm-workspace.yaml` 无效）。

## 代码约定

- 每个模块有 JSDoc 头部说明职责；注释解释**为什么**这样写（尤其是反直觉的兼容处理），
  不复述代码在做什么。
- 浏览器端 CSS 一律 `weread-` 前缀，颜色走 `--dsw-*` 主题变量以自动适配明暗主题。
- 界面文案用中文。
- 解析函数保持纯函数、可单测：拿原始 JSON 进，出 DTO 出。
- 新增解析/分页逻辑时补 `tests/` 用例，覆盖缺字段、空数组、类型不定（如 id 可能是数字）等边界。

## 目录速览

```
src/
├── types.ts        两端共享 DTO
├── cordis.ts       cordis 子集类型（含 LLM 服务）
├── host/           index（注册路由）/ routes / config / weread / ai / store
└── client/         index（座位注册）/ shelf / bookshelf / bookCard / bookDetail
                    bookwall / stats / settings / charts / styles
scripts/            build.mjs（双半侧打包）/ link-profile.sh / each.mjs
tests/              node --test 用例
```
