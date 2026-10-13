import { execFile } from 'node:child_process'
import { win32 } from 'node:path'
import { promisify } from 'node:util'
const execute = promisify(execFile)

/** Fixed official layouts, including the bundled 1.5.230.0 installer. */
export function hidHideToolCandidates(roots: string[], tool: 'HidHideCLI' | 'HidHideClient'): string[] {
  return [...new Set(roots.filter(Boolean).flatMap(root => [
    win32.join(root, 'Nefarius Software Solutions', 'HidHide', 'x64', `${tool}.exe`),
    win32.join(root, 'Nefarius Software Solutions', 'HidHide', `${tool}.exe`),
    ...['Nefarius Software Solutions e.U.', 'Nefarius Software Solutions e.U', 'Nefarius'].flatMap(company => [
      win32.join(root, company, tool, `${tool}.exe`),
      win32.join(root, company, 'HidHide', 'x64', `${tool}.exe`)
    ])
  ]))]
}

export async function runSetupTool(file: string, args: string[], options: { timeout: number; maxBuffer: number; windowsHide: boolean }): Promise<{ stdout: string; stderr: string }> {
  const pending = execute(file, args, options)
  // HidHide enters script mode when stdin is a pipe. EOF is required even when
  // commands were passed as arguments; otherwise it waits until our timeout.
  pending.child.stdin?.end()
  try { return await pending } catch (error) {
    const failure = error as Error & { killed?: boolean; code?: string | number; stderr?: string }
    const name = win32.basename(file)
    if (failure.killed) throw new Error(`${name} timed out. Close other HidHide setup windows, restart Windows if a driver was just installed, and try again.`)
    throw new Error(`${name} failed (${failure.code ?? 'unknown error'}). ${failure.stderr?.trim().slice(0, 1200) || 'Check that Windows has finished installing the required tools, then try again.'}`)
  }
}
