export interface RoutingDevice { id: string; name: string; recommended: boolean }
export interface RoutingState {
  devices: RoutingDevice[]
  active: boolean
  hiddenCount: number
  configuredDevice: string | null
}
/** CLI output is a list of commands, not shell code: extract known quoted arguments only. */
export function cliEntries(text: string, command: 'app-reg' | 'dev-hide'): string[] {
  const pattern = new RegExp(`^--${command} "([^"\\r\\n]+)"$`)
  return text.split(/\r?\n/).map(line => line.trim().match(pattern)?.[1]).filter((v): v is string => !!v)
}
export function safeRoutingDevice(d: { id?: unknown; name?: unknown; service?: unknown; gaming?: unknown; parent?: unknown }): RoutingDevice | null {
  if (typeof d.id !== 'string' || !/^(USB|HID)\\[^\r\n"]+$/i.test(d.id)) return null
  if (typeof d.parent === 'string' && /VIGEM/i.test(d.parent)) return null
  if (!((typeof d.service === 'string' && /^xusb(?:21|22)?$/i.test(d.service)) || d.gaming === true)) return null
  const name = typeof d.name === 'string' && d.name.trim() ? d.name : 'Gamepad interface'
  return { id: d.id, name, recommended: /VID_046D&PID_C53B/i.test(d.id) }
}
