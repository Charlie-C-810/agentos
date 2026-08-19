import { killCli, spawnCli } from './spawn-cli.js'
import { promptInputForPlatform } from './types.js'
import { createInterface } from 'node:readline'
import type { CliAdapter, CliEvent, CliRunResult } from './types.js'

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000

export interface RunCliOptions {
  adapter: CliAdapter
  prompt: string
  cwd: string
  sessionId?: string
  signal?: AbortSignal
  timeoutMs?: number
  onEvent?: (event: CliEvent) => void
}

export function runCli(options: RunCliOptions): Promise<CliRunResult> {
  const {
    adapter,
    prompt,
    cwd,
    sessionId,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    onEvent,
  } = options
  // Windows 下 prompt 走 stdin（规避 cmd 转义/乱码），其他平台直接作为命令行参数。
  const promptInput = promptInputForPlatform(process.platform)
  const useStdin = promptInput === 'stdin'
  const args = sessionId
    ? adapter.buildResumeArgs(prompt, sessionId, promptInput)
    : adapter.buildArgs(prompt, promptInput)

  return new Promise((resolve, reject) => {
    // 固定用 `['pipe','pipe','pipe']`，让 stdin 始终可写（spawnCli 返回类型按字面量收窄）。
    const child = spawnCli(adapter.command, args, {
      cwd,
      signal,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    // stdin 模式下把 prompt 写入子进程；否则 prompt 已在命令行参数里，stdin 直接收口。
    if (child.stdin) {
      if (useStdin) child.stdin.end(prompt, 'utf8')
      else child.stdin.end()
    }
    // spawn 的 signal 选项只杀直接子进程（cmd 外壳），Windows 下 claude.exe/codex.exe 会变孤儿；
    // 额外监听 abort 用 killCli 连进程树一起清。
    signal?.addEventListener('abort', () => killCli(child), { once: true })
    const lines = createInterface({ input: child.stdout })
    let observedSessionId = sessionId
    let observedAnswer: string | undefined
    let observedStats: CliRunResult['stats']
    let finalResult: CliRunResult | undefined
    let resultError: Error | undefined
    let stderr = ''
    let settled = false
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      killCli(child)
    }, timeoutMs)

    const finish = () => clearTimeout(timer)
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      finish()
      reject(error)
    }

    lines.on('line', (line) => {
      for (const event of adapter.parseEvents(line)) {
        onEvent?.(event)
        if ('sessionId' in event && event.sessionId) {
          observedSessionId = event.sessionId
        }
        if (event.type === 'error') {
          resultError = new Error(event.message)
          continue
        }
        if (event.type === 'result') {
          if (event.answer) observedAnswer = event.answer
          if (event.stats) observedStats = event.stats
          if (!observedAnswer) continue
          finalResult = {
            answer: observedAnswer,
            sessionId: event.sessionId ?? observedSessionId,
            ...(observedStats ? { stats: observedStats } : {}),
          }
        }
      }
    })

    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString()
    })
    child.once('error', (error) => {
      if (timedOut) {
        fail(new Error(`${adapter.displayName} 执行超时`))
        return
      }
      if (signal?.aborted) {
        fail(new Error(`${adapter.displayName} 执行已取消`))
        return
      }
      fail(error)
    })
    child.once('close', (code) => {
      if (settled) return
      if (timedOut) {
        return fail(new Error(`${adapter.displayName} 执行超时`))
      }
      if (signal?.aborted) {
        return fail(new Error(`${adapter.displayName} 执行已取消`))
      }
      if (resultError) return fail(resultError)
      if (code !== 0) {
        return fail(
          new Error(
            stderr.trim() || `${adapter.displayName} 退出，状态码 ${code}`,
          ),
        )
      }
      if (!finalResult) {
        return fail(new Error(`${adapter.displayName} 没有返回最终结果`))
      }
      settled = true
      finish()
      resolve(finalResult)
    })
  })
}
