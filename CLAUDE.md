# agent-os

把飞书变成 AI 编程 CLI（Claude Code / Codex）的指挥台。
一个话题 = 一个任务；bot 之间可互相 @ 协作；cron 定时巡检。

## 运行

pnpm dev（tsx watch）/ pnpm start / pnpm build

## 约定

- ESM only，Node 22+，pnpm
- 凭证只放 .env（已 gitignore），绝不硬编码、绝不提交

## 错题本

> 踩坑后追加一行：现象 → 原因 → 正确做法。给未来的 AI 和人看。

- `pnpm build` 报 TS2591 找不到 `process`/`node:path`（@types/node 明明已装）→ TypeScript 7（tsgo）不再自动加载 `node_modules/@types`，与 pnpm 软链无关 → tsconfig 的 compilerOptions 显式声明 `"types": ["node"]`
