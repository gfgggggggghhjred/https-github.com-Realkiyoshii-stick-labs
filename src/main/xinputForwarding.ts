import { installWindowsDriver } from './windowsSetup'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { app } from 'electron'
import { validPreview, type PreviewSettings } from '../shared/xinput'
import type { ForwardingStatus, XinputSource } from '../shared/xinputForwarding'

export class XinputForwarding {
  private proc: ChildProcessWithoutNullStreams | null = null
  private starting: Promise<void> | null = null
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private seq = 0
  private pending = new Map<number, { resolve: (data: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  private error: string | null = null
  private reset(error: Error, proc: ChildProcessWithoutNullStreams): void {
    if (this.proc !== proc) return
    this.proc = null
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = null
    this.error = error.message
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error) }
    this.pending.clear()
  }
  private async initialize(): Promise<void> {
    if (process.platform !== 'win32') throw new Error('Virtual Xbox forwarding requires Windows 10/11.')
    if (this.starting) return this.starting
    if (this.proc) return
    this.starting = new Promise<void>((resolve, reject) => {
      const helper = app.isPackaged
        ? join(process.resourcesPath, 'windows-runtime', 'xinputbridge', 'xinputbridge.exe')
        : join(app.getAppPath(), 'build', 'windows-runtime', 'xinputbridge', 'xinputbridge.exe')
      if (app.isPackaged && !existsSync(helper)) { reject(new Error('Bundled forwarding helper is missing. Reinstall Stick Labs.')); return }
      const executable = existsSync(helper) ? helper : process.env.STICKLABS_PYTHON || 'python'
      const args = existsSync(helper) ? [] : ['-u', join(app.getAppPath(), 'scripts', 'xinputbridge.py')]
      const proc = spawn(executable, args, { windowsHide: true, stdio: 'pipe' })
      this.proc = proc
      let ready = false
      const timer = setTimeout(() => { reject(new Error('XInput helper startup timed out')); proc.kill() }, 10000)
      const fail = (error: Error): void => { clearTimeout(timer); this.reset(error, proc); if (!ready) reject(error) }
      proc.on('error', fail)
      proc.on('exit', () => fail(new Error(this.error || 'XInput helper exited. Use Windows setup in the app to install the virtual controller driver.')))
      proc.stdin.on('error', fail)
      let stderr = ''
      proc.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-2000); this.error = stderr })
      const lines = createInterface({ input: proc.stdout })
      lines.on('line', line => {
        let message: any
        try { message = JSON.parse(line) } catch { return }
        if ('ready' in message) {
          clearTimeout(timer)
          if (!message.ready) { const error = new Error(message.error || 'XInput helper unavailable'); fail(error); proc.kill(); return }
          ready = true; this.error = null
          this.heartbeat = setInterval(() => { void this.request('heartbeat').catch(error => { this.error = error.message; proc.kill() }) }, 1000)
          resolve(); return
        }
        const entry = this.pending.get(message.id)
        if (!entry) return
        this.pending.delete(message.id); clearTimeout(entry.timer)
        if (message.ok) entry.resolve(message.data)
        else entry.reject(new Error(message.error || 'XInput helper command failed'))
      })
    }).finally(() => { this.starting = null })
    return this.starting
  }
  private async request(command: string, fields: Record<string, unknown> = {}): Promise<any> {
    await this.initialize()
    const proc = this.proc
    if (!proc) throw new Error('XInput helper unavailable')
    return new Promise((resolve, reject) => {
      const id = ++this.seq
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('XInput command timed out')); proc.kill() }, command === 'start' ? 15000 : 5000)
      this.pending.set(id, { resolve, reject, timer })
      proc.stdin.write(JSON.stringify({ id, command, ...fields }) + '\n', error => {
        if (!error) return
        clearTimeout(timer); this.pending.delete(id); reject(error); proc.kill()
      })
    })
  }
  async status(): Promise<ForwardingStatus> {
    if (process.platform !== 'win32') return { supported: false, running: false, sourceSlot: null, outputSlot: null, error: 'Forwarding requires Windows 10/11. Packaged Windows builds include the helper; use Windows setup to install drivers.' }
    if (!this.proc) return { supported: true, running: false, sourceSlot: null, outputSlot: null, error: this.error }
    return { supported: true, ...await this.request('status') }
  }
  async installDriver(): Promise<void> {
    const status = await this.status()
    if (status.running) throw new Error('Stop forwarding before installing a driver.')
    this.close()
    await installWindowsDriver('vigem')
  }
  async sources(): Promise<XinputSource[]> { return this.request('sources') }
  async start(source: number, settings: PreviewSettings): Promise<ForwardingStatus> {
    if (!Number.isInteger(source) || source < 0 || source > 3 || !validPreview(settings)) throw new Error('Invalid source or adjustments')
    await this.request('start', { source, settings }); return this.status()
  }
  async update(settings: PreviewSettings): Promise<void> {
    if (!validPreview(settings)) throw new Error('Invalid adjustments')
    await this.request('settings', { settings })
  }
  async stop(): Promise<ForwardingStatus> {
    if (this.proc) await this.request('stop')
    return this.status()
  }
  close(): void {
    const proc = this.proc
    if (!proc) return
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = null
    proc.stdin.end() // helper observes EOF, publishes neutral input and removes target
    const timer = setTimeout(() => proc.kill(), 2000)
    proc.once('exit', () => clearTimeout(timer))
  }
}
export const xinputForwarding = new XinputForwarding()
