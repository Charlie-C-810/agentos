import {
  spawn,
  type ChildProcess,
  type ChildProcessByStdio,
  type SpawnOptions,
} from 'node:child_process'
import type { Readable, Writable } from 'node:stream'

/** 在 Windows 上把子进程连同进程树一起杀掉，避免 cmd 被杀后 claude.exe/codex.exe 变孤儿继续跑。 */
export function killCli(
  child: ChildProcess,
  signal: NodeJS.Signals = 'SIGTERM',
): void {
  if (!child.pid) {
    child.kill(signal)
    return
  }
  if (process.platform !== 'win32') {
    child.kill(signal)
    return
  }
  spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
    windowsHide: true,
    stdio: 'ignore',
  })
}

export function spawnCli(
  command: string,
  args: string[],
  options: SpawnOptions & { stdio: ['ignore', 'pipe', 'pipe'] },
): ChildProcessByStdio<null, Readable, Readable>
export function spawnCli(
  command: string,
  args: string[],
  options: SpawnOptions & { stdio: ['pipe', 'pipe', 'pipe'] },
): ChildProcessByStdio<Writable, Readable, Readable>
export function spawnCli(
  command: string,
  args: string[],
  options: SpawnOptions & { stdio: SpawnOptions['stdio'] },
): ChildProcessByStdio<any, any, any> {
  if (process.platform !== 'win32') {
    return spawn(command, args, options)
  }
  // Windows 下 claude/codex 常以 .cmd 批处理形式存在，必须走 shell（cmd）才能找到并启动。
  // prompt 已在适配器侧改为 stdin 传递，命令行里只剩无空格的标志参数，shell 拼接不会破坏它们。
  return spawn(command, args, {
    ...options,
    shell: true,
    windowsHide: true,
  })
}
