/**
 * Prompt templates for the AI tasks.
 *
 * Prompts are kept here, together with the version string used to key the AI
 * cache, so a wording change bumps the cache key instead of serving stale text.
 * @module dsh-weread/src/host/ai/prompts
 */

/** Bump when the prompt wording changes materially. */
export const PROMPT_VERSION = 'v1'

/** System preamble shared by every task. */
const SYSTEM =
  '你是微信读书的阅读助理。基于用户提供的书籍与划线数据，用简体中文输出结构化、克制、可执行的洞察。' +
  '不要编造数据里没有的内容；无法判断时明确说明。使用 Markdown 小标题与要点列表。'

export interface PromptParts {
  readonly system: string
  readonly user: string
}

/** Single-book summary from metadata + highlights + reviews. */
export function summaryPrompt(input: {
  title: string
  author: string
  intro: string
  highlights: readonly string[]
  reviews: readonly string[]
}): PromptParts {
  const highlights = input.highlights.slice(0, 120).map((h, i) => `${i + 1}. ${h}`).join('\n')
  const reviews = input.reviews.slice(0, 40).map((r, i) => `${i + 1}. ${r}`).join('\n')
  const user =
    `请为下面这本书生成阅读总结。\n\n` +
    `《${input.title}》 作者：${input.author}\n` +
    `简介：${input.intro || '（无）'}\n\n` +
    `## 用户划线（共 ${input.highlights.length} 条）\n${highlights || '（无）'}\n\n` +
    `## 用户笔记/想法（共 ${input.reviews.length} 条）\n${reviews || '（无）'}\n\n` +
    `输出要求（Markdown）：\n` +
    `### 一句话总结\n### 核心观点（3-6 条）\n### 金句提炼（从我划线的角度提炼 3-5 句）\n### 我的关注点分析（基于划线/笔记推测用户最在意的主题）`
  return { system: SYSTEM, user }
}

/** Theme clustering over the user's highlights in one book. */
export function highlightsThemesPrompt(input: {
  title: string
  highlights: readonly string[]
}): PromptParts {
  const highlights = input.highlights.slice(0, 150).map((h, i) => `${i + 1}. ${h}`).join('\n')
  const user =
    `下面是用户在《${input.title}》中的划线。请把划线聚类成若干主题，并说明每个主题的含义。\n\n` +
    `${highlights || '（无）'}\n\n` +
    `输出（Markdown）：每个主题一个 ### 小标题，下面用要点列出该主题的代表划线（可引用原文），最后给一段「整体阅读关注点」小结。`
  return { system: SYSTEM, user }
}

/** Whole-shelf reading profile. */
export function shelfProfilePrompt(input: {
  bookCount: number
  totalReadHours: number
  readDays: number
  categories: readonly string[]
  authors: readonly string[]
  titles: readonly string[]
}): PromptParts {
  const user =
    `以下是用户的微信读书书架概况，请生成阅读画像。\n\n` +
    `书籍数：${input.bookCount}\n累计阅读：${input.totalReadHours.toFixed(1)} 小时，共 ${input.readDays} 天\n\n` +
    `## 偏好分类\n${input.categories.slice(0, 15).join('、') || '（无）'}\n\n` +
    `## 常读作者\n${input.authors.slice(0, 15).join('、') || '（无）'}\n\n` +
    `## 书架书目（节选）\n${input.titles.slice(0, 60).join('、')}\n\n` +
    `输出（Markdown）：\n### 阅读偏好画像\n### 主题分布\n### 阅读习惯观察\n### 下一步阅读建议（3-5 本方向或书目）`
  return { system: SYSTEM, user }
}
