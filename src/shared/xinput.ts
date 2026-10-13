/** Standard Gamepad API data is processed controller output, not raw sensor data. */
export interface PreviewSettings {
  inner: number
  outer: number
  exponent: number
  invertX: boolean
  invertY: boolean
  centerX?: number
  centerY?: number
  rangeX?: number
  rangeY?: number
  variation?: number
  variationSpeed?: number
  rightVariation?: number
  leftJitterAlways?: boolean
  rightJitterAlways?: boolean
}
export const DEFAULT_PREVIEW: PreviewSettings = { inner: 0, outer: 100, exponent: 1, invertX: false, invertY: false }
export function validPreview(value: unknown): value is PreviewSettings {
  if (!value || typeof value !== 'object') return false
  const s = value as PreviewSettings
  return Number.isFinite(s.inner) && Number.isFinite(s.outer) && Number.isFinite(s.exponent) &&
    s.inner >= 0 && s.inner <= 50 && s.outer > s.inner && s.outer <= 100 &&
    s.exponent >= 0.2 && s.exponent <= 5 && typeof s.invertX === 'boolean' && typeof s.invertY === 'boolean' &&
    (s.leftJitterAlways === undefined || typeof s.leftJitterAlways === 'boolean') &&
    (s.rightJitterAlways === undefined || typeof s.rightJitterAlways === 'boolean') &&
    [['centerX', -.25, .25], ['centerY', -.25, .25], ['rangeX', .25, 1.5], ['rangeY', .25, 1.5], ['variation', 0, 5], ['rightVariation', 0, 5], ['variationSpeed', .2, 60]].every(([key, min, max]) => {
      const v = s[key as keyof PreviewSettings]; return v === undefined || typeof v === 'number' && Number.isFinite(v) && v >= Number(min) && v <= Number(max)
    })
}
export function previewStick(x: number, y: number, s: PreviewSettings): [number, number] {
  if (!validPreview(s) || !Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Invalid preview settings or axes')
  x = Math.max(-1, Math.min(1, x)); y = Math.max(-1, Math.min(1, y))
  x = Math.max(-1, Math.min(1, (x - (s.centerX ?? 0)) / (s.rangeX ?? 1)))
  y = Math.max(-1, Math.min(1, (y - (s.centerY ?? 0)) / (s.rangeY ?? 1)))
  const length = Math.hypot(x, y)
  if (length <= s.inner / 100 || length === 0) return [0, 0]
  const magnitude = Math.min(1, (length - s.inner / 100) / ((s.outer - s.inner) / 100)) ** s.exponent
  return [x / length * magnitude * (s.invertX ? -1 : 1), y / length * magnitude * (s.invertY ? -1 : 1)]
}
export interface StandardPadLike {
  connected: boolean
  mapping: string
  axes: readonly number[]
  buttons: readonly { value: number; pressed: boolean }[]
}
export function readStandardPad(pad: StandardPadLike) {
  if (!pad.connected || pad.mapping !== 'standard' || pad.axes.length < 4 || pad.buttons.length < 17) return null
  const axes = pad.axes.slice(0, 4)
  if (axes.some(v => !Number.isFinite(v)) || pad.buttons.some(b => !Number.isFinite(b.value))) return null
  return {
    axes: axes.map(v => Math.max(-1, Math.min(1, v))),
    triggers: [pad.buttons[6].value, pad.buttons[7].value].map(v => Math.max(0, Math.min(1, v))),
    buttons: pad.buttons.map(b => b.pressed)
  }
}
