import XinputPanel from './XinputPanel'
import { useContext, useEffect, useRef, useState } from 'react'
import { api, b64ToBytes, bytesToB64, type Candidate, type DeviceInfo, type DeviceStats, type LiveSample, type PingResult } from './api'
import { parseProfile, serializeProfile, fun, stick, LINEAR_CURVE, looksLikeCEProfile, type Packet, type Profile } from '@shared/profile'
import { PROFILE_LENGTH, REPORT_RATE_OPTIONS, STICK_RESOLUTION_OPTIONS } from '@shared/protocol'
import { identifyModel, MODELS, type ControllerModel } from '@shared/models'
import {
  describeRawResolution,
  bitsToLevels,
  bitsToWireRaw,
  EXTENDED_BITS,
  resampleCurve,
  resampleSpline,
  traceSpline,
  addDesignPoint,
  DESIGN_MIN_POINTS,
  DESIGN_MAX_POINTS,
  outerBufferFromBytes,
  isOuterUnlimited
} from '@shared/sticklab'
import { LANGS, LangContext, tr, useLangState, useT } from './i18n'
import type { MariusConfig, MariusIdentity } from '@shared/marius'
import { mariusDisplayName } from '@shared/marius'
import { flyTransport, type FlyIdentity } from './flydigiUsb'
import { flyTypeName } from '@shared/flydigi'
import { axisToByte, useFlyLive } from './flydigiLive'


function Slider(props: {  label: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
  onChange: (v: number) => void
  format?: (v: number) => string
}): JSX.Element {
  return (
    <label style={{ display: 'block' }}>
      <div className="row spread">
        <span className="label">{props.label}</span>
        <span className="mono">{props.format ? props.format(props.value) : `${props.value}${props.unit ?? ''}`}</span>
      </div>
      <input
        type="range"
        className="input"
        style={{ width: '100%' }}
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  )
}

function CurvePlot({ points, onChange, overlay, smooth }: { points: Array<{ x: number; y: number }>; onChange?: (next: Array<{ x: number; y: number }>) => void; overlay?: Array<{ x: number; y: number }>; smooth?: boolean }): JSX.Element {
  const ref = useRef<HTMLCanvasElement | null>(null)
  const drag = useRef<number | null>(null)

  function toPx(w: number, h: number): { toX: (v: number) => number; toY: (v: number) => number } {
    const pad = 10
    return {
      toX: (v: number): number => pad + (v / 255) * (w - pad * 2),
      toY: (v: number): number => h - pad - (v / 255) * (h - pad * 2)
    }
  }

  function pointAt(e: React.PointerEvent, w: number, h: number): number | null {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    const { toX, toY } = toPx(w, h)
    let best: number | null = null
    let bestD = 14
    points.forEach((p, i) => {
      const d = Math.hypot(toX(p.x) - px, toY(p.y) - py)
      if (d < bestD) {
        bestD = d
        best = i
      }
    })
    return best
  }

  function movePoint(e: React.PointerEvent, i: number): void {
    const canvas = ref.current
    if (!canvas || !onChange) return
    const rect = canvas.getBoundingClientRect()
    const w = canvas.clientWidth
    const h = 200
    const pad = 10
    const x = Math.max(0, Math.min(255, Math.round(((e.clientX - rect.left - pad) / (w - pad * 2)) * 255)))
    const y = Math.max(0, Math.min(255, Math.round((1 - (e.clientY - rect.top - pad) / (h - pad * 2)) * 255)))
    const next = points.map((p) => ({ ...p }))
    next[i] = { x, y }
    onChange(next)
  }
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    const w = c.clientWidth
    const h = 200
    c.width = w * dpr
    c.height = h * dpr
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    const pad = 10
    const toX = (v: number): number => pad + (v / 255) * (w - pad * 2)
    const toY = (v: number): number => h - pad - (v / 255) * (h - pad * 2)
    ctx.strokeStyle = '#3a2230'
    for (let i = 0; i <= 4; i++) {
      const t = (i / 4) * (w - pad * 2) + pad
      ctx.beginPath()
      ctx.moveTo(t, pad)
      ctx.lineTo(t, h - pad)
      ctx.stroke()
    }
    ctx.strokeStyle = '#552c38'
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.moveTo(toX(0), toY(0))
    ctx.lineTo(toX(255), toY(255))
    ctx.stroke()
    ctx.setLineDash([])
    // Max X / Y boundary lines (255 edges) with labels.
    ctx.strokeStyle = 'rgba(62,207,142,0.55)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(toX(255), pad)
    ctx.lineTo(toX(255), h - pad)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(pad, toY(255))
    ctx.lineTo(w - pad, toY(255))
    ctx.stroke()
    ctx.fillStyle = '#3ecf8e'
    ctx.font = '10px system-ui'
    ctx.fillText('X max 255', toX(255) - 52, pad + 11)
    ctx.fillText('Y max 255', pad + 4, toY(255) + 13)
    // Endpoint projections: actual max X / max Y reached by the design.
    if (points.length > 0) {
      const maxX = Math.max(...points.map((p) => p.x))
      const maxY = Math.max(...points.map((p) => p.y))
      ctx.strokeStyle = 'rgba(245,181,68,0.8)'
      ctx.setLineDash([5, 4])
      ctx.beginPath()
      ctx.moveTo(toX(maxX), toY(0))
      ctx.lineTo(toX(maxX), toY(255))
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(toX(0), toY(maxY))
      ctx.lineTo(toX(255), toY(maxY))
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = '#f5b544'
      ctx.fillText(`max X ${maxX}`, Math.min(toX(maxX) + 5, w - 52), h - pad - 5)
      ctx.fillText(`max Y ${maxY}`, pad + 4, toY(maxY) - 5)
    }
    ctx.strokeStyle = '#f43f52'
    ctx.lineWidth = 2
    ctx.beginPath()
    const line = smooth ? traceSpline(points) : points
    line.forEach((p, i) => {
      if (i === 0) ctx.moveTo(toX(p.x), toY(p.y))
      else ctx.lineTo(toX(p.x), toY(p.y))
    })
    ctx.stroke()
    if (overlay) {
      ctx.strokeStyle = 'rgba(245,181,68,0.85)'
      ctx.setLineDash([5, 4])
      ctx.beginPath()
      overlay.forEach((p, i) => {
        if (i === 0) ctx.moveTo(toX(p.x), toY(p.y))
        else ctx.lineTo(toX(p.x), toY(p.y))
      })
      ctx.stroke()
      ctx.setLineDash([])
      overlay.forEach((p) => {
        ctx.strokeStyle = 'rgba(245,181,68,0.9)'
        ctx.lineWidth = 1.5
        ctx.strokeRect(toX(p.x) - 3.5, toY(p.y) - 3.5, 7, 7)
      })
      ctx.lineWidth = 2
    }
    points.forEach((p) => {
      ctx.fillStyle = drag.current !== null ? '#f5b544' : '#ff8fa0'
      ctx.beginPath()
      ctx.arc(toX(p.x), toY(p.y), 5, 0, Math.PI * 2)
      ctx.fill()
    })
  }, [points, overlay, smooth])
  return (
    <canvas
      ref={ref}
      className="plot"
      style={{ height: 200, cursor: onChange ? 'grab' : 'default', touchAction: 'none' }}
      onPointerDown={(e) => {
        if (!onChange || !ref.current) return
        const i = pointAt(e, ref.current.clientWidth, 200)
        if (i !== null) {
          drag.current = i
          ;(e.target as HTMLCanvasElement).setPointerCapture(e.pointerId)
        }
      }}
      onPointerMove={(e) => {
        if (drag.current !== null) movePoint(e, drag.current)
      }}
      onPointerUp={() => {
        drag.current = null
      }}
    />
  )
}

/**
 * FPS curve pack — static 5-point dual-zone approximations of a "dynamic"
 * response (fine centre for micro-aim, hot edge for flicks). The pad has no
 * speed-sensing, so true velocity-dynamic curves are impossible; these bend
 * the same LUT a dynamic curve would average out to. All verified byte-safe:
 * curve bytes only, +14..+23.
 */
const AIM_CURVES: Record<string, { label: string; hint: string; pts: Array<{ x: number; y: number }> }> = {
  linear: { label: 'Linear', hint: '1:1 raw', pts: [...LINEAR_CURVE] },
  fpsAim: {
    label: 'Kiyoshi Curve',
    hint: 'calm centre, hot edge',
    pts: [{ x: 0, y: 0 }, { x: 64, y: 38 }, { x: 128, y: 100 }, { x: 191, y: 185 }, { x: 255, y: 255 }]
  },
  micro: {
    label: 'Micro-aim',
    hint: 'extra-fine centre for tracking',
    pts: [{ x: 0, y: 0 }, { x: 64, y: 28 }, { x: 128, y: 80 }, { x: 191, y: 170 }, { x: 255, y: 255 }]
  },
  flick: {
    label: 'Flick/Snap',
    hint: 'fast start for 180s',
    pts: [{ x: 0, y: 0 }, { x: 64, y: 100 }, { x: 128, y: 160 }, { x: 191, y: 215 }, { x: 255, y: 255 }]
  },
  snappy: {
    label: 'Snappy mid',
    hint: 'COD-style boosted mid',
    pts: [{ x: 0, y: 0 }, { x: 64, y: 78 }, { x: 128, y: 140 }, { x: 191, y: 200 }, { x: 255, y: 255 }]
  },
  steady: {
    label: 'Steady track',
    hint: 'Apex-style even pull',
    pts: [{ x: 0, y: 0 }, { x: 64, y: 52 }, { x: 128, y: 112 }, { x: 191, y: 188 }, { x: 255, y: 255 }]
  },  expo: {
    label: 'Expo',
    hint: 'late surge',
    pts: [{ x: 0, y: 0 }, { x: 64, y: 16 }, { x: 128, y: 70 }, { x: 191, y: 158 }, { x: 255, y: 255 }]
  },
  sacreds: {    label: 'Sacreds',
    hint: 'Hyperstrike-style smooth fast start, 10 points',
    pts: [
      { x: 0, y: 0 },
      { x: 26, y: 41 },
      { x: 49, y: 72 },
      { x: 76, y: 107 },
      { x: 102, y: 140 },
      { x: 133, y: 157 },
      { x: 153, y: 177 },
      { x: 168, y: 197 },
      { x: 191, y: 223 },
      { x: 229, y: 255 }
    ]
  },
  machixo: {
    label: 'Machixo',
    hint: 'Slow-start desensitized, tops at 94%',
    pts: [
      { x: 0, y: 0 },
      { x: 20, y: 15 },
      { x: 82, y: 61 },
      { x: 133, y: 99 },
      { x: 184, y: 138 },
      { x: 235, y: 176 },
      { x: 255, y: 240 }
    ]
  }
}


function AnalyticsPanel({ context }: { context: string }): JSX.Element {  const t = useT()
  const [rate, setRate] = useState(0)
  const [frames, setFrames] = useState(0)
  const [history, setHistory] = useState<number[]>([])
  const [paused, setPaused] = useState(false)
  const [ping, setPing] = useState<PingResult | null>(null)
  const [pinging, setPinging] = useState(false)
  const [pingError, setPingError] = useState<string | null>(null)
  const [extents, setExtents] = useState<{ min: number[]; max: number[]; n: number } | null>(null)
  const chartRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    if (paused) return
    const off = api().on('device:stats', (s) => {
      const stats = s as unknown as DeviceStats
      setRate(stats.rateHz)
      setFrames(stats.inputFrames)
      setHistory((prev) => [...prev.slice(-59), stats.rateHz])
    })
    return off
  }, [paused])

  useEffect(() => {
    const off = api().on('input:sample', (s) => {
      const v = s as unknown as LiveSample
      const axes = [v.lx, v.ly, v.rx, v.ry]
      setExtents((prev) => {
        if (!prev) return { min: [...axes], max: [...axes], n: 1 }
        return {
          min: prev.min.map((m, i) => Math.min(m, axes[i])),
          max: prev.max.map((m, i) => Math.max(m, axes[i])),
          n: prev.n + 1
        }
      })
    })
    return off
  }, [])

  useEffect(() => {
    const c = chartRef.current
    if (!c) return
    let raf = 0
    const draw = (): void => {
      const dpr = window.devicePixelRatio || 1
      const w = c.clientWidth
      const h = 120
      if (c.width !== w * dpr || c.height !== h * dpr) {
        c.width = w * dpr
        c.height = h * dpr
      }
      const ctx = c.getContext('2d')
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.clearRect(0, 0, w, h)
        const max = Math.max(100, ...history) * 1.15
        const bars = Math.max(history.length, 30)
        const bw = w / bars
        ctx.strokeStyle = '#3a2230'
        for (let i = 1; i <= 3; i++) {
          const y = h - (i / 3) * h
          ctx.beginPath()
          ctx.moveTo(0, y)
          ctx.lineTo(w, y)
          ctx.stroke()
        }
        history.forEach((v, i) => {
          const bh = (v / max) * h
          ctx.fillStyle = v >= 480 ? '#3ecf8e' : v >= 200 ? '#f43f52' : '#f5b544'
          ctx.fillRect(i * bw + 1, h - bh, Math.max(1, bw - 2), bh)
        })
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [history])

  async function runPing(): Promise<void> {
    setPinging(true)
    setPingError(null)
    try {
      setPing(await api().ping(15))
    } catch (e) {
      setPingError((e as Error).message)
    } finally {
      setPinging(false)
    }
  }

  const avg = history.length ? Math.round(history.reduce((a, b) => a + b, 0) / history.length) : 0
  const names = ['LX', 'LY', 'RX', 'RY']

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3>{t('lab.title')}</h3>
      <div className="hint">{context}</div>
      <div className="two" style={{ alignItems: 'start', marginTop: 10 }}>
        <div className="stack" style={{ gap: 10 }}>
          <div className="row" style={{ gap: 8 }}>
            <span className={`pill${rate >= 480 ? ' good' : rate > 0 ? ' warn' : ''}`}>{rate || '—'} {t('lab.hzNow')}</span>
            <span className="pill">{avg || '—'} {t('lab.hzAvg')}</span>
            <span className="pill">{frames.toLocaleString()} {t('lab.frames')}</span>
            <div style={{ flex: 1 }} />
            <button className="btn sm ghost" onClick={() => setPaused((p) => !p)}>{paused ? t('lab.resume') : t('lab.pause')}</button>
          </div>
          <canvas ref={chartRef} className="plot" style={{ height: 120 }} />
          <div className="note">{t('lab.streamNote')}</div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn sm primary" disabled={pinging} onClick={() => void runPing()}>{pinging ? t('lab.measuring') : t('lab.runPing')}</button>
            {pingError && <span style={{ color: 'var(--bad)', fontSize: 12 }}>{pingError}</span>}
            {ping && <span className="mono">median {ping.median.toFixed(1)} ms · mean {ping.mean.toFixed(1)} ms · min {ping.min.toFixed(1)} · max {ping.max.toFixed(1)}</span>}
          </div>
          <div className="note">{t('lab.pingNote')}</div>
        </div>
        <div className="stack" style={{ gap: 10 }}>
          <div className="row spread">
            <span className="label">{t('lab.range')}</span>
            <button className="btn sm ghost" onClick={() => setExtents(null)}>{t('lab.reset')}</button>
          </div>
          <table className="tbl">
            <thead><tr><th>{t('lab.thAxis')}</th><th>{t('lab.thMin')}</th><th>{t('lab.thMax')}</th><th>{t('lab.thSpan')}</th></tr></thead>
            <tbody>
              {names.map((n, i) => (
                <tr key={n}>
                  <td className="mono">{n}</td>
                  <td className="mono">{extents ? extents.min[i] : '—'}</td>
                  <td className="mono">{extents ? extents.max[i] : '—'}</td>
                  <td className="mono">{extents ? extents.max[i] - extents.min[i] : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="note">
            {extents ? t('lab.samples').replace('{n}', extents.n.toLocaleString()) : t('lab.samplesEmpty')}
          </div>
        </div>
      </div>
    </div>
  )
}

interface SlotEntry {
  index: number
  name: string | null
  bytes: Uint8Array | null
  loading: boolean
  error: string | null
}

function download(filename: string, data: Uint8Array | string): void {
  const blob =
    typeof data === 'string'
      ? new Blob([data], { type: 'application/json' })
      : new Blob([data.buffer as ArrayBuffer], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function LockedDump({ modelId, modelName, defaultLength }: { modelId: string; modelName: string | null; defaultLength: number }): JSX.Element {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [length, setLength] = useState(defaultLength)

  async function run(): Promise<void> {
    const len = Math.max(100, Math.min(4096, Math.round(Number(length) || 0)))
    if (!len) {
      setMessage('Enter a byte length first (try 680, 1070 or 1935).')
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const dump: Record<string, { name: string; bytes: string }> = {}
      let allZero = true
      for (const s of [1, 2, 3, 4]) {
        const res = await api().readProfile(s, len)
        const bytes = b64ToBytes(res.bytes)
        if (bytes.some((b) => b !== 0)) allZero = false
        let name = ''
        try {
          name = parseProfile(bytes, modelId).name
        } catch {
          name = ''
        }
        dump[String(s)] = { name, bytes: bytesToB64(bytes) }
      }
      if (allZero) {
        setMessage('All slots read back empty — wrong length, or the pad is not answering. Try 680 / 1070 / 1935.')
        return
      }
      download(
        `sticklabs-dump-${modelId}-${new Date().toISOString().slice(0, 10)}.json`,
        JSON.stringify({ version: 1, app: 'stick-labs-dump', model: modelId, length: len, profiles: dump }, null, 2)
      )
      setMessage('Dump downloaded — send it to RealKiyoshi to unlock this model.')
    } catch (e) {
      setMessage(`Dump failed: ${(e as Error).message} — try another length (680 / 1070 / 1935).`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3>Locked — {modelName ?? t('msg.unknownModel')}</h3>
      <div className="hint">Profile backup is disabled for this model — its profile layout is unverified, so reads and writes stay off. A read-only dump helps unlock it.</div>
      <div className="row" style={{ gap: 8, marginTop: 10 }}>
        <input
          className="input"
          style={{ width: 110 }}
          type="number"
          min={100}
          max={4096}
          value={length}
          onChange={(e) => setLength(Number(e.target.value))}
        />
        <button
          className="btn sm"
          disabled={busy}
          title="Read-only: dumps all 4 slots for support analysis. Writes nothing."
          onClick={() => void run()}
        >
          {busy ? 'Reading…' : 'Export raw dump for support'}
        </button>
        {message && <span className="pill">{message}</span>}
      </div>
    </div>
  )
}

const CAL_STEPS = ['cal.stepReady', 'cal.stepOpen', 'cal.stepS1', 'cal.stepS2', 'cal.done']

function StickDial({ x, y, label }: { x: number; y: number; label: string }): JSX.Element {
  const ref = useRef<HTMLCanvasElement | null>(null)
  const trail = useRef<Array<{ x: number; y: number }>>([])
  const nx = (x - 128) / 128
  const ny = (y - 128) / 128
  trail.current.push({ x: nx, y: ny })
  if (trail.current.length > 90) trail.current.splice(0, trail.current.length - 90)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    const S = 120
    c.width = S * dpr
    c.height = S * dpr
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, S, S)
    const cx = S / 2
    const cy = S / 2
    const R = S / 2 - 8
    ctx.lineWidth = 1.5
    ctx.strokeStyle = '#3a2230'
    ctx.beginPath()
    ctx.arc(cx, cy, R, 0, Math.PI * 2)
    ctx.stroke()
    ctx.strokeStyle = '#552c38'
    ctx.beginPath()
    ctx.moveTo(cx - R, cy)
    ctx.lineTo(cx + R, cy)
    ctx.moveTo(cx, cy - R)
    ctx.lineTo(cx, cy + R)
    ctx.stroke()
    // ±2-step rest zone
    ctx.strokeStyle = '#3fa46a'
    ctx.beginPath()
    ctx.arc(cx, cy, Math.max(2, (2 / 128) * R), 0, Math.PI * 2)
    ctx.stroke()
    const pts = trail.current
    if (pts.length > 1) {
      ctx.strokeStyle = '#f0a030'
      ctx.beginPath()
      pts.forEach((p, i) => {
        const px = cx + Math.max(-1, Math.min(1, p.x)) * R
        const py = cy + Math.max(-1, Math.min(1, p.y)) * R
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      })
      ctx.stroke()
    }
    ctx.fillStyle = '#ff8fa0'
    ctx.beginPath()
    ctx.arc(cx + Math.max(-1, Math.min(1, nx)) * R, cy + Math.max(-1, Math.min(1, ny)) * R, 4, 0, Math.PI * 2)
    ctx.fill()
  })
  const fmt = (v: number): string => `${v > 0 ? `+${v}` : `${v}`}`
  return (
    <div style={{ textAlign: 'center' }}>
      <div className="label">{label}</div>
      <canvas ref={ref} style={{ width: 120, height: 120 }} />
      <div className="mono" style={{ fontSize: 11 }}>x {fmt(x - 128)} · y {fmt(y - 128)}</div>
    </div>
  )
}

function CalibrationPanel(): JSX.Element {
  const t = useT()
  const [live, setLive] = useState<LiveSample | null>(null)
  const liveRef = useRef<LiveSample | null>(null)
  const [before, setBefore] = useState<number[] | null>(null)
  const [after, setAfter] = useState<number[] | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [flow, setFlow] = useState<null | { kind: 'quick' | 'step'; step: number; label: string; progress: number }>(null)
  const flowId = useRef(0)
  const stillRef = useRef<Array<{ t: number; dev: number }>>([])

  useEffect(() => () => { flowId.current++ }, [])

  useEffect(() => {
    const off = api().on('input:sample', (s) => {
      const v = s as unknown as LiveSample
      liveRef.current = v
      setLive(v)
      const dev = Math.max(Math.abs(v.lx - 128), Math.abs(v.ly - 128), Math.abs(v.rx - 128), Math.abs(v.ry - 128))
      const now = Date.now()
      stillRef.current.push({ t: now, dev })
      while (stillRef.current.length > 0 && now - stillRef.current[0].t > 4000) stillRef.current.shift()
    })
    return off
  }, [])

  const rest = live ? [live.lx - 128, live.ly - 128, live.rx - 128, live.ry - 128] : null
  const maxDev = rest ? Math.max(...rest.map((v) => Math.abs(v))) : 0
  const centered = maxDev <= 4
  const inCal = (live?.calTarget ?? 0) !== 0

  async function enter(): Promise<void> {
    setErr(null)
    setAfter(null)
    if (live) setBefore([live.lx, live.ly, live.rx, live.ry].map((v) => v - 128))
    setBusy(true)
    try {
      await api().calibration(0)
      setNote('Calibration open — hands off, sticks centered. Commit writes this rest position as the new centre.')
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function commit(): Promise<void> {
    setErr(null)
    if (!centered) {
      setErr(`Sticks are ${maxDev} steps off centre — re-centre them first. Commit is blocked to protect your calibration.`)
      return
    }
    if (!window.confirm('Commit calibration? The current rest position becomes the new centre. This cannot be undone from a file.')) return
    setBusy(true)
    try {
      await api().calibration(1)
      setNote('Committed — sampling the new rest position…')
      window.setTimeout(() => {
        const v = liveRef.current
        if (v) setAfter([v.lx, v.ly, v.rx, v.ry].map((x) => x - 128))
        setNote('Committed. Compare before/after below — both should sit near 0.')
      }, 1500)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function cancel(): Promise<void> {
    setErr(null)
    try {
      await api().calibration(2)
      setNote('Calibration cancelled — nothing was written.')
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  /** Uninterrupted stillness span (ms) at the trailing edge, threshold in steps. */
  function stillSpan(threshold: number): number {
    const samples = stillRef.current
    if (samples.length === 0) return 0
    const newest = samples[samples.length - 1]
    if (newest.dev > threshold) return 0
    let first = newest.t
    for (let i = samples.length - 2; i >= 0; i--) {
      if (samples[i].dev > threshold) break
      first = samples[i].t
    }
    return newest.t - first
  }

  /** DualShock-style stability gate: resolve once still enough, timeout at 20 s. */
  function gateStill(threshold: number, needMs: number, myId: number, onProgress: (p: number) => void): Promise<'ok' | 'timeout' | 'cancelled'> {
    return new Promise((resolve) => {
      const deadline = Date.now() + 20000
      const tick = (): void => {
        if (flowId.current !== myId) { resolve('cancelled'); return }
        if (Date.now() > deadline) { resolve('timeout'); return }
        const span = stillSpan(threshold)
        onProgress(Math.min(1, span / needMs))
        if (span >= needMs) { resolve('ok'); return }
        window.setTimeout(tick, 100)
      }
      tick()
    })
  }

  function sampleAfter(): void {
    window.setTimeout(() => {
      const v = liveRef.current
      if (v) setAfter([v.lx, v.ly, v.rx, v.ry].map((x) => x - 128))
      setNote('Committed. Compare before/after below — both should sit near 0.')
    }, 1500)
  }

  /** Fully automatic center calibration: open, stillness-gated, commit. */
  async function quickCalibrate(): Promise<void> {
    if (busy || flow) return
    setErr(null)
    const v0 = liveRef.current
    if (!v0) { setErr('No live input — connect the pad first.'); return }
    flowId.current++
    const myId = flowId.current
    setAfter(null)
    setBefore([v0.lx, v0.ly, v0.rx, v0.ry].map((v) => v - 128))
    setBusy(true)
    setFlow({ kind: 'quick', step: 0, label: 'Opening session…', progress: 0 })
    try {
      await api().calibration(0)
      if (flowId.current !== myId) return
      setNote('Session open — hands off. Sampling stillness…')
      const r = await gateStill(2, 2500, myId, (p) => {
        if (flowId.current === myId) setFlow({ kind: 'quick', step: 0, label: 'Hold still — sampling centre…', progress: p })
      })
      if (flowId.current !== myId) return
      if (r !== 'ok') {
        if (r === 'timeout') {
          try { await api().calibration(2) } catch { /* already closed */ }
          if (flowId.current === myId) {
            setErr('Could not hold still for 2.5 s — session cancelled, nothing written.')
            setFlow(null)
          }
        }
        return
      }
      setFlow({ kind: 'quick', step: 0, label: 'Committing…', progress: 1 })
      await api().calibration(1)
      if (flowId.current !== myId) return
      setNote('Committed — sampling the new rest position…')
      sampleAfter()
      setFlow(null)
    } catch (e) {
      if (flowId.current === myId) {
        setErr((e as Error).message)
        setFlow(null)
      }
      try { await api().calibration(2) } catch { /* ignore */ }
    } finally {
      setBusy(false)
    }
  }

  function startSteps(): void {
    if (busy || flow) return
    setErr(null)
    if (!liveRef.current) { setErr('No live input — connect the pad first.'); return }
    flowId.current++
    setFlow({ kind: 'step', step: 0, label: 'Ready — set the pad down, hands off', progress: 0 })
  }

  async function exitFlow(): Promise<void> {
    flowId.current++
    setFlow(null)
    if (inCal) await cancel()
  }

  async function stepNext(): Promise<void> {
    if (busy || !flow || flow.kind !== 'step') return
    const myId = flowId.current
    const s = flow.step
    const setStep = (step: number, label: string, progress?: number): void => {
      if (flowId.current === myId) setFlow({ kind: 'step', step, label, progress: progress ?? step / 4 })
    }
    setErr(null)
    if (s === 0) {
      setAfter(null)
      const v = liveRef.current
      if (!v) { setErr('No live input — connect the pad first.'); return }
      setBefore([v.lx, v.ly, v.rx, v.ry].map((x) => x - 128))
      setBusy(true)
      try {
        await api().calibration(0)
        if (flowId.current !== myId) return
        setNote('Session open — hands off, sticks centered.')
        setStep(1, 'Session open — hands off')
      } catch (e) {
        if (flowId.current === myId) setErr((e as Error).message)
      } finally {
        setBusy(false)
      }
      return
    }
    if (s === 1 || s === 2) {
      setBusy(true)
      try {
        const r = await gateStill(2, 2000, myId, (p) => {
          if (flowId.current === myId) setFlow({ kind: 'step', step: s, label: 'Hold still — sampling…', progress: s / 4 + p / 4 })
        })
        if (flowId.current !== myId) return
        if (r !== 'ok') {
          if (r === 'timeout') setErr('Sticks moved during sampling — nothing written. Wait for stillness and press Next to retry.')
          return
        }
        setStep(s + 1, s + 1 === 3 ? 'Samples good — ready to commit' : 'Sample 1 of 2 good')
      } finally {
        setBusy(false)
      }
      return
    }
    if (s === 3) {
      if (!window.confirm('Commit calibration? The current rest position becomes the new centre. This cannot be undone from a file.')) return
      setBusy(true)
      try {
        await api().calibration(1)
        if (flowId.current !== myId) return
        setNote('Committed — sampling the new rest position…')
        sampleAfter()
        setStep(4, 'Done')
      } catch (e) {
        if (flowId.current === myId) setErr((e as Error).message)
      } finally {
        setBusy(false)
      }
    }
  }

  const names = ['LX', 'LY', 'RX', 'RY']
  const verdict = !rest ? null : maxDev <= 2 ? t('cal.centered') : maxDev <= 6 ? t('cal.mild') : t('cal.drifting')

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3>{t('cal.bench')}</h3>
      <div className="hint">{t('cal.intro')}</div>
      <div className="row" style={{ gap: 20, justifyContent: 'center', margin: '12px 0' }}>
        {live ? (
          <>
            <StickDial x={live.lx} y={live.ly} label={t('cal.left')} />
            <StickDial x={live.rx} y={live.ry} label={t('cal.right')} />
          </>
        ) : (
          <div className="hint">{t('cal.waiting')}</div>
        )}
      </div>
      <div className="row wrap" style={{ gap: 8, margin: '10px 0' }}>
        <span className={`pill${inCal ? ' warn' : ''}`}>{inCal ? `${t('cal.inCal')} (target ${live?.calTarget})` : t('cal.idle')}</span>
        {rest && <span className={`pill${maxDev <= 2 ? ' good' : maxDev <= 6 ? ' warn' : ' bad'}`}>{verdict} · ±{maxDev}</span>}
        <div style={{ flex: 1 }} />
        <button className="btn sm primary" disabled={busy || !!flow || !live} onClick={() => void quickCalibrate()}>{t('cal.quick')}</button>
        <button className="btn sm" disabled={busy || !!flow || !live} onClick={() => startSteps()}>{t('cal.step')}</button>
      </div>
      {flow && flow.kind === 'step' && (
        <div className="row wrap" style={{ gap: 6, margin: '10px 0', alignItems: 'center' }}>
          {CAL_STEPS.map((key, i) => (
            <span key={key} className={`pill${flow.step === i ? ' warn' : flow.step > i ? ' good' : ''}`}>{i + 1} · {t(key)}</span>
          ))}
          <div style={{ flex: 1 }} />
          <button className="btn sm primary" disabled={busy} onClick={() => void stepNext()}>{flow.step === 0 ? t('cal.open') : flow.step < 3 ? t('cal.sample') : flow.step === 3 ? t('cal.commit') : t('cal.done')}</button>
          <button className="btn sm ghost" disabled={busy && !inCal} onClick={() => void exitFlow()}>{t('cal.exit')}</button>
        </div>
      )}
      {flow && (
        <div style={{ margin: '10px 0' }}>
          <div className="row spread">
            <span className="label">{flow.label}</span>
            <span className="mono">{Math.round(flow.progress * 100)}%</span>
          </div>
          <div style={{ height: 8, borderRadius: 4, background: '#3a2230', overflow: 'hidden', marginTop: 4 }}>
            <div style={{ height: '100%', width: `${Math.round(flow.progress * 100)}%`, background: '#f0a030', transition: 'width 120ms linear' }} />
          </div>
        </div>
      )}
      {flow && flow.kind === 'quick' && (
        <div className="row wrap" style={{ gap: 8, margin: '0 0 10px' }}>
          <button className="btn sm ghost" onClick={() => void exitFlow()}>{t('cal.abort')}</button>
        </div>
      )}
      <div className="row wrap" style={{ gap: 8, margin: '10px 0' }}>
        <span className="label">{t('cal.manual')}</span>
        <button className="btn sm" disabled={busy || !!flow || inCal} onClick={() => void enter()}>1 · {t('cal.open')}</button>
        <button className="btn sm primary" disabled={busy || !!flow || !inCal} onClick={() => void commit()}>2 · {t('cal.commit')}</button>
        <button className="btn sm ghost" disabled={busy || !!flow || !inCal} onClick={() => void cancel()}>{t('cal.cancel')}</button>
      </div>
      {note && <div className="note" style={{ marginBottom: 8 }}>{note}</div>}
      {err && <div className="note bad" style={{ marginBottom: 8 }}>{err}</div>}
      <table className="tbl">
        <thead><tr><th>{t('cal.tableAxis')}</th><th>{t('cal.tableLive')}</th><th>{t('cal.tableBefore')}</th><th>{t('cal.tableAfter')}</th></tr></thead>
        <tbody>
          {names.map((n, i) => (
            <tr key={n}>
              <td className="mono">{n}</td>
              <td className="mono">{rest ? (rest[i] > 0 ? `+${rest[i]}` : `${rest[i]}`) : '—'}</td>
              <td className="mono">{before ? (before[i] > 0 ? `+${before[i]}` : `${before[i]}`) : '—'}</td>
              <td className="mono">{after ? (after[i] > 0 ? `+${after[i]}` : `${after[i]}`) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="note" style={{ marginTop: 8 }}>{t('cal.tipRest')}</div>
      <div className="note warn" style={{ marginTop: 8 }}>{t('cal.driftWarn')} {t('cal.driftWarn2')}</div>
    </div>
  )
}

function MariusPanel(): JSX.Element {
  const [cands, setCands] = useState<Array<{ path: string; productId: number; product: string | undefined; manufacturer: string | undefined }>>([])
  const [session, setSession] = useState<{ identity: MariusIdentity; bInterval: number; pollHz: number } | null>(null)
  const [config, setConfig] = useState<MariusConfig | null>(null)
  const [raw, setRaw] = useState<{ left: { x: number; y: number }; right: { x: number; y: number } } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  async function scan(): Promise<void> {
    setErr(null)
    setBusy(true)
    try {
      const list = await api().mariusDiscover()
      setCands(list)
      setMsg(`Found ${list.length} 0x054C:0x05C4 interface(s). This ID is shared with real DualShock 4 — the family gate applies on connect.`)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function connect(path: string): Promise<void> {
    setErr(null)
    setMsg(null)
    setBusy(true)
    try {
      const s = await api().mariusConnect(path)
      setSession(s)
      setConfig(null)
      setRaw(null)
      setMsg(`Connected — ${mariusDisplayName(s.identity)}.`)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function read(): Promise<void> {
    setErr(null)
    setBusy(true)
    try {
      const res = await api().mariusReadConfig()
      setConfig(res.parsed)
      setMsg('Config read (256 B). Display only — nothing was written.')
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function sample(): Promise<void> {
    setErr(null)
    setBusy(true)
    try {
      setRaw(await api().mariusReadRaw())
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function disc(): Promise<void> {
    setErr(null)
    try {
      await api().mariusDisconnect()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSession(null)
      setConfig(null)
      setRaw(null)
    }
  }

  const id = session?.identity ?? null
  const fullScale = id ? 2 ** id.family.bits : 4096
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="card" style={{ borderColor: 'var(--warn)' }}>
        <h3>Marius board — read-only preview</h3>
        <div className="hint">Reverse-engineered from the public setup web app — <strong>unverified against hardware</strong>. This build has no write path: connect, identity and config reads only. Setup mode: hold PS while plugging USB.</div>
        <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
          <button className="btn sm" disabled={busy} onClick={() => void scan()}>Scan USB</button>
          {session && (
            <>
              <button className="btn sm" disabled={busy} onClick={() => void read()}>Read config</button>
              <button className="btn sm" disabled={busy} onClick={() => void sample()}>Sample sticks</button>
              <button className="btn sm ghost" disabled={busy} onClick={() => void disc()}>Disconnect</button>
            </>
          )}
        </div>
        {msg && <div className="note" style={{ marginTop: 8 }}>{msg}</div>}
        {err && <div className="note bad" style={{ marginTop: 8 }}>{err}</div>}
        {!session && cands.length > 0 && (
          <table className="tbl" style={{ marginTop: 8 }}>
            <thead><tr><th>Product</th><th>PID</th><th></th></tr></thead>
            <tbody>
              {cands.map((c) => (
                <tr key={c.path}>
                  <td>{c.product ?? '?'}</td>
                  <td className="mono">0x{c.productId.toString(16)}</td>
                  <td><button className="btn sm" disabled={busy} onClick={() => void connect(c.path)}>Connect</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {id && session && (
        <div className="card">
          <h3>{mariusDisplayName(id)}</h3>
          <div className="mono" style={{ fontSize: 11, marginBottom: 4 }}>firmware string: {id.name || '?'}</div>
          <div className="row wrap" style={{ gap: 6, margin: '8px 0' }}>
            <span className="pill good">{id.family.line} / {id.family.variant}</span>
            <span className="pill">{id.family.bits}-bit raw</span>
            <span className="pill">fw {id.versionMajor}.{id.versionMinor}</span>
            <span className="pill">rev {id.hwRev}</span>
            <span className="pill">{session.pollHz.toLocaleString()} Hz</span>
          </div>
          <div className="mono" style={{ fontSize: 11 }}>uid {id.uid} · build {id.buildDate || '?'}</div>
        </div>
      )}
      {config && (
        <div className="card">
          <h3>Config — 256 B</h3>
          <div className="row wrap" style={{ gap: 6, margin: '8px 0' }}>
            <span className={`pill${config.valid ? ' good' : ' bad'}`}>{config.valid ? 'valid (v2 + marker)' : 'INVALID — do not trust'}</span>
            {config.curvesPresent && <span className="pill">curves blob ({config.curvesLength} B)</span>}
            {config.rightEffectiveBitsPresent && <span className="pill">per-stick bits</span>}
          </div>
          <table className="tbl">
            <tbody>
              <tr><td className="mono">center L/R</td><td className="mono">({config.center.lx}, {config.center.ly}) · ({config.center.rx}, {config.center.ry})</td></tr>
              <tr><td className="mono">range L</td><td className="mono">x {config.rangeLeft.xMin}–{config.rangeLeft.xMax} · y {config.rangeLeft.yMin}–{config.rangeLeft.yMax}</td></tr>
              <tr><td className="mono">range R</td><td className="mono">x {config.rangeRight.xMin}–{config.rangeRight.xMax} · y {config.rangeRight.yMin}–{config.rangeRight.yMax}</td></tr>
              <tr><td className="mono">deadzone L/R</td><td className="mono">{config.deadzone.leftIn}%/{config.deadzone.leftOut}% · {config.deadzone.rightIn}%/{config.deadzone.rightOut}%</td></tr>
              {config.extDeadzone && <tr><td className="mono">ext dz L/R</td><td className="mono">{config.extDeadzone.leftIn}%/{config.extDeadzone.leftOut}% · {config.extDeadzone.rightIn}%/{config.extDeadzone.rightOut}%</td></tr>}
              <tr><td className="mono">triggers</td><td className="mono">L2 {config.triggers.l2Start}/{config.triggers.l2End} · R2 {config.triggers.r2Start}/{config.triggers.r2End} · hair {config.hairPct}%</td></tr>
              <tr><td className="mono">out bits L/R</td><td className="mono">{config.leftEffectiveBits === 0 || config.leftEffectiveBits === 0xff ? 'full' : config.leftEffectiveBits} · {config.rightEffectiveBits === 0 || config.rightEffectiveBits === 0xff ? 'full' : config.rightEffectiveBits}</td></tr>
              <tr><td className="mono">invert</td><td className="mono">LX{config.invert.lx ? '±' : ''} LY{config.invert.ly ? '±' : ''} RX{config.invert.rx ? '±' : ''} RY{config.invert.ry ? '±' : ''}</td></tr>
            </tbody>
          </table>
        </div>
      )}
      {raw && (
        <div className="card">
          <h3>Raw sticks — full scale {fullScale.toLocaleString()}</h3>
          <div className="mono">L ({raw.left.x}, {raw.left.y}) · R ({raw.right.x}, {raw.right.y})</div>
        </div>
      )}
    </div>
  )
}

function ApexCalibrate(): JSX.Element {
  const t = useT()
  const feed = useFlyLive(true)
  const [peak, setPeak] = useState(0)
  const dev = feed.present ? Math.max(Math.abs(feed.lx), Math.abs(feed.ly), Math.abs(feed.rx), Math.abs(feed.ry)) : 0
  const steps = Math.round(dev * 128)
  useEffect(() => {
    if (feed.present) setPeak((p) => Math.max(p, steps))
  }, [feed.present, steps])
  const verdict = !feed.present ? null : steps <= 2 ? 'Centered' : steps <= 6 ? 'Mild drift — deadzone covers it' : 'Drifting'
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3>{t('cal.bench')} — Apex 5</h3>
      <div className="hint">Live center check off the standard gamepad stream. Firmware center-write is unmapped for this pad — tune the curve heads in Sticks instead. Leave the pad untouched on a table.</div>
      <div className="row" style={{ gap: 20, justifyContent: 'center', margin: '12px 0' }}>
        {feed.present ? (
          <>
            <StickDial x={axisToByte(feed.lx)} y={axisToByte(feed.ly)} label="Left" />
            <StickDial x={axisToByte(feed.rx)} y={axisToByte(feed.ry)} label="Right" />
          </>
        ) : (
          <div className="hint">Waiting for live input — press a button on the pad.</div>
        )}
      </div>
      <div className="row wrap" style={{ gap: 8, margin: '10px 0', alignItems: 'center' }}>
        {verdict && <span className={`pill${steps <= 2 ? ' good' : steps <= 6 ? ' warn' : ' bad'}`}>{verdict} · ±{steps}</span>}
        <span className="pill">peak ±{peak}</span>
        <div style={{ flex: 1 }} />
        <button className="btn sm ghost" onClick={() => setPeak(0)}>Reset peak</button>
      </div>
      <div className="note warn" style={{ marginTop: 8 }}>This bench re-centers GameSir sticks — it cannot fix drift, and it cannot write to the Apex. Drift is worn hardware; replace the sticks, then calibrate.</div>
    </div>
  )
}

function ApexDevice({ flyId, rates }: { flyId: FlyIdentity | null; rates: ReadonlyArray<{ gear: number; hz: number; confirmed: boolean }> }): JSX.Element {
  const t = useT()
  const [bright, setBright] = useState(40)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function write(): Promise<void> {
    setErr(null)
    setMsg(null)
    if (!flyTransport.connected) {
      setErr('Apex 5 not connected — connect it from the sidebar first, and close Space Station.')
      return
    }
    if (!window.confirm(`Set LED brightness to ${bright}%? This sends Default-mode constants — another active LED mode resets to Default.`)) return
    setBusy(true)
    try {
      const res = await flyTransport.writeLed(bright)
      setMsg(`Brightness ${bright}% written + saved (stamp ${res.stamp}) — visible on the pad itself.`)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="card">
        <h3>{t('nav.device')} — Apex 5</h3>
        <div className="hint">1000 Hz max on this pad — nothing faster is offered. Polling-rate switching, bit depth (precision) and shapes are GameSir-only or unmapped, so those cards stay off here. Curves live in Sticks.</div>
        {flyId && <div className="mono" style={{ fontSize: 11, marginTop: 6 }}>uid {flyId.uid}</div>}
      </div>
      <div className="card">
        <h3>{t('device.polling')} - {rates.map((o) => (o.hz >= 1000 ? `${o.hz / 1000}K` : `${o.hz}`)).join(' / ')}</h3>
        <div className="hint">Report-rate gears. Rate switching is unmapped on this pad — 1000 Hz max.</div>
        <div className="row wrap" style={{ gap: 8, margin: '10px 0' }}>
          {rates.map((o) => (
            <button
              key={o.gear}
              className="btn sm ghost"
              disabled
              title="Rate switching is unmapped on this pad"
            >
              {o.hz >= 1000 ? `${o.hz / 1000}K` : `${o.hz} Hz`}
            </button>
          ))}
        </div>
      </div>
      <div className="card">
        <h3>{t('device.bits')} - 8-24</h3>
        <div className="hint">Precision switching is unmapped on this pad — the sensor runs its stock resolution.</div>
        <div className="row wrap" style={{ gap: 8, margin: '10px 0' }}>
          {STICK_RESOLUTION_OPTIONS.map((o) => (
            <button
              key={o.bits}
              className="btn sm ghost"
              disabled
              title="Precision switching is unmapped on this pad"
            >
              {o.bits}-bit
            </button>
          ))}
          {EXTENDED_BITS.map((bits) => (
            <button
              key={bits}
              className="btn sm ghost"
              disabled
              title="Precision switching is unmapped on this pad"
            >
              {bits}-bit*
            </button>
          ))}
        </div>
      </div>
      <div className="card">
        <h3>{t('device.rate')}</h3>
        <div className="hint">How fast this stick answers in Mouse mode on GameSir pads. No equivalent on this pad.</div>
      </div>
      <div className="card">
        <h3>{t('sticks.shape')}</h3>
        <div className="hint">Round/square/raw processing flags. This pad has no shape flags: output always follows the curve.</div>
        <div className="stack" style={{ gap: 8 }}>
          {['Round diagonals', 'Square gate', 'Pure raw 1:1'].map((name) => (
            <button key={name} className="btn sm ghost" disabled title="No processing-flag equivalent on this pad">{name}</button>
          ))}
        </div>
      </div>
      <div className="card" style={{ borderColor: 'var(--bad)' }}>
        <h3>{t('sticks.reset')}</h3>
        <div className="hint">Curve reset lives in the Sticks tab for this pad (designs state is shared there).</div>
      </div>
      <div className="card">
        <h3>LED</h3>
        <div className="hint">Mirrored from live captures (checksum rule proven). Brightness-only — the write carries Default-mode constants, so another active LED mode resets to Default.</div>
        <div className="stack" style={{ gap: 8, marginTop: 8 }}>
          <Slider label="Brightness" value={bright} min={0} max={100} step={1} unit="%" onChange={(v) => setBright(Math.round(v))} format={(v) => `${v.toFixed(0)}%`} />
        </div>
        <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
          <button className="btn sm primary" disabled={busy} onClick={() => void write()}>{busy ? 'Writing…' : 'Write LED'}</button>
        </div>
        {msg && <div className="note" style={{ marginTop: 8 }}>{msg}</div>}
        {err && <div className="note bad" style={{ marginTop: 8 }}>{err}</div>}
      </div>
    </div>
  )
}

const FLY_P2D = (v: number): number => Math.max(0, Math.min(255, Math.round((v * 255) / 150)))
const FLY_D2P = (p: number): number => Math.max(0, Math.min(150, Math.round((p * 150) / 255)))
const FLY_SLOTX = (i: number): number => Math.round((i * 255) / 8)
const flyToDesign = (pts: number[]): Array<{ x: number; y: number }> =>
  pts.map((v, i) => ({ x: FLY_SLOTX(i), y: FLY_P2D(v) }))
const flyFromDesign = (d: Array<{ x: number; y: number }>): number[] => d.map((p) => FLY_D2P(p.y))
/** Resample an 8K-style free polyline (0–255) to 9 even outputs (0–150). */
const flyResampleAim = (pts: Array<{ x: number; y: number }>): number[] => {
  const sorted = [...pts].sort((a, b) => a.x - b.x)
  const at = (x: number): number => {
    if (x <= sorted[0].x) return sorted[0].y
    for (let i = 1; i < sorted.length; i++) {
      if (x <= sorted[i].x) {
        const a = sorted[i - 1]
        const b = sorted[i]
        const t = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x)
        return a.y + t * (b.y - a.y)
      }
    }
    return sorted[sorted.length - 1].y
  }
  const out: number[] = []
  for (let i = 0; i < 9; i++) out.push(Math.max(0, Math.min(150, Math.round((at((i * 255) / 8) * 150) / 255))))
  return out
}

function ApexSticks({ flyId }: { flyId: FlyIdentity | null }): JSX.Element {
  const t = useT()
  const [ptype, setPtype] = useState(2)
  const [which, setWhich] = useState(0)
  const [leftDesign, setLeftDesign] = useState(() => flyToDesign([50, 56, 63, 69, 75, 94, 113, 131, 150]))
  const [rightDesign, setRightDesign] = useState(() => flyToDesign([50, 62, 75, 87, 100, 112, 125, 137, 150]))
  const [padLeft, setPadLeft] = useState(() => flyToDesign([50, 56, 63, 69, 75, 94, 113, 131, 150]))
  const [padRight, setPadRight] = useState(() => flyToDesign([50, 62, 75, 87, 100, 112, 125, 137, 150]))
  const [padType, setPadType] = useState(2)
  const [deadStart, setDeadStart] = useState(10)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [stamp, setStamp] = useState<string | null>(null)
  const liveFeed = useFlyLive(true)
  const [measuring, setMeasuring] = useState<null | { left: number; suggestion: { dev: number; pct: number } | null }>(null)
  const peakRef = useRef(0)

  useEffect(() => {
    if (measuring && liveFeed.present) {
      const dev = Math.max(Math.abs(liveFeed.lx), Math.abs(liveFeed.ly), Math.abs(liveFeed.rx), Math.abs(liveFeed.ry))
      peakRef.current = Math.max(peakRef.current, dev)
    }
  })

  useEffect(() => {
    if (!measuring) return
    if (measuring.left <= 0) {
      const devSteps = Math.round(peakRef.current * 128)
      const pct = Math.round(peakRef.current * 1000) / 10
      setMeasuring({ left: 0, suggestion: { dev: devSteps, pct } })
      return
    }
    const t = window.setTimeout(() => setMeasuring((m) => (m ? { ...m, left: m.left - 1 } : m)), 1000)
    return () => window.clearTimeout(t)
  }, [measuring])

  async function load(): Promise<void> {
    setErr(null)
    if (!flyTransport.connected) {
      setErr('Apex 5 not connected — connect it from the sidebar first, and close Space Station.')
      return
    }
    setBusy(true)
    try {
      const store = await flyTransport.readStore()
      setPtype(store.leftType)
      setPadType(store.leftType)
      setLeftDesign(flyToDesign(store.leftPoints))
      setPadLeft(flyToDesign(store.leftPoints))
      setRightDesign(flyToDesign(store.rightPoints))
      setPadRight(flyToDesign(store.rightPoints))
      setLoaded(true)
      setMsg(`Store read — left ${flyTypeName(store.leftType)}, right type ${store.rightType}. Editing writes both sticks, verified by re-read.`)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (flyTransport.connected && !loaded) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const resetAll = (): void => {
    if (!window.confirm('Reset both curves to the Slow baseline? Writes nothing until you Send.')) return
    setLeftDesign(flyToDesign([50, 56, 63, 69, 75, 94, 113, 131, 150]))
    setRightDesign(flyToDesign([50, 62, 75, 87, 100, 112, 125, 137, 150]))
    setPtype(2)
    setDeadStart(10)
    setMsg('Reset to the Slow baseline — Send to apply it to the pad.')
  }

  const design = which === 0 ? leftDesign : rightDesign
  const padDesign = which === 0 ? padLeft : padRight
  const setDesign = which === 0 ? setLeftDesign : setRightDesign
  const changed =
    ptype !== padType ||
    design.some((p, i) => p.y !== (padDesign[i]?.y ?? -1))

  const onDesign = (next: Array<{ x: number; y: number }>): void => {
    setDesign(next.map((p, i) => ({ x: FLY_SLOTX(i), y: Math.max(0, Math.min(255, Math.round(p.y))) })))
    setPtype(3)
  }
  const fillPreset = (t: number, p: number[]): void => {
    setPtype(t)
    setDesign(flyToDesign(p))
  }
  /** Deadzone nudge: mirrors Space Station's coupling (one observation — verify feel). */
  const nudgeHead = (v: number): void => {
    const delta = Math.round(v) - deadStart
    if (delta === 0) return
    setDesign((prev) =>
      prev.map((p, i) => (i < 4 ? { ...p, y: Math.max(0, Math.min(255, p.y - Math.round((delta * 255) / 150))) } : p))
    )
    setDeadStart(Math.round(v))
    setPtype(3)
  }

  async function write(): Promise<void> {
    setErr(null)
    setMsg(null)
    if (!flyTransport.connected) {
      setErr('Apex 5 not connected — connect it from the sidebar first, and close Space Station.')
      return
    }
    if (!window.confirm('Write both stick curves to the Apex 5? Polling and precision are untouched. Space Station can restore.')) return
    setBusy(true)
    // Snapshot for best-effort restore.
    let snapshot: { leftType: number; leftPoints: number[]; rightType: number; rightPoints: number[] } | null = null
    try {
      const store = await flyTransport.readStore()
      snapshot = { leftType: store.leftType, leftPoints: [...store.leftPoints], rightType: store.rightType, rightPoints: [...store.rightPoints] }
    } catch {
      /* proceed without a snapshot — user confirmed */
    }
    try {
      const res = await flyTransport.writeCurves(
        { type: ptype, points: flyFromDesign(leftDesign) },
        { type: ptype, points: flyFromDesign(rightDesign) },
        () => flyTransport.readStore().catch(() => null)
      )
      setStamp(res.stamp)
      setMsg(`Both curves written + save committed (stamp ${res.stamp}), read-back matches. Test feel in game.`)
      await load()
    } catch (e) {
      const message = (e as Error).message
      if (snapshot) {
        try {
          await flyTransport.writeCurves(
            { type: snapshot.leftType, points: snapshot.leftPoints },
            { type: snapshot.rightType, points: snapshot.rightPoints },
            () => flyTransport.readStore().catch(() => null)
          )
          setErr(`${message} — original curves restored.`)
          await load()
          return
        } catch {
          /* restore failed too */
        }
      }
      setErr(`${message} — restore in Space Station if feel changed.`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="two" style={{ alignItems: 'start' }}>
      <div className="stack" style={{ gap: 16 }}>
      <div className="card">
        <h3>{t('sticks.live')}</h3>
        <div className="hint">Standard gamepad stream (XInput side), -1..1. {t('sticks.liveHint')}</div>
        {liveFeed.present ? (
          <>
            <StickCross lx={axisToByte(liveFeed.lx)} ly={axisToByte(liveFeed.ly)} rx={axisToByte(liveFeed.rx)} ry={axisToByte(liveFeed.ry)} />
            <div className="row spread">
              <span className="mono">L {liveFeed.lx.toFixed(2)},{liveFeed.ly.toFixed(2)}</span>
              <span className="mono">R {liveFeed.rx.toFixed(2)},{liveFeed.ry.toFixed(2)}</span>
            </div>
          </>
        ) : (
          <div className="hint">No live gamepad stream — press a button on the pad (the browser needs input to see it).</div>
        )}
      </div>
      <div className="card">
        <h3>{t('sticks.deadzone')} — 0.1% steps</h3>
        <div className="hint">No separate window on this pad — deadzone lives in the curve head, full range always. <strong>Start</strong> reshapes the first 4 points of the viewed stick, mirroring Space Station's coupling (single observation — verify feel). End and anti stay neutral.</div>
        <div className="stack" style={{ gap: 12, marginTop: 8 }}>
          <Slider label="Start (head lift)" value={deadStart} min={0} max={20} step={0.1} unit="%" onChange={(v) => nudgeHead(v)} format={(v) => `${v.toFixed(1)}%`} />
          <div style={{ opacity: 0.45, pointerEvents: 'none' }}>
            <Slider label="End (input above = full)" value={100} min={10} max={100} step={0.1} unit="%" onChange={() => undefined} format={(v) => `${v.toFixed(1)}%`} />
          </div>
          <div style={{ opacity: 0.45, pointerEvents: 'none' }}>
            <Slider label="Anti-deadzone start (output floor — snap)" value={0} min={0} max={50} step={0.1} unit="%" onChange={() => undefined} format={(v) => `${v.toFixed(1)}%`} />
          </div>
          <div style={{ opacity: 0.45, pointerEvents: 'none' }}>
            <Slider label="Anti-deadzone end (output ceiling)" value={100} min={50} max={100} step={0.1} unit="%" onChange={() => undefined} format={(v) => `${v.toFixed(1)}%`} />
          </div>
        </div>
        <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
          {(
            [
              { label: 'Start', key: 'start', value: deadStart, locked: false },
              { label: 'End', key: 'end', value: 100, locked: true },
              { label: 'Anti-start', key: 'beginAnti', value: 0, locked: true },
              { label: 'Anti-end', key: 'endAnti', value: 100, locked: true }
            ] as const
          ).map((f) => (
            <label key={f.key} className="row" style={{ gap: 6, fontSize: 12 }}>
              <span className="label">{f.label}</span>
              <input
                className="input"
                style={{ width: 76 }}
                type="number"
                min={0}
                max={100}
                step={0.1}
                disabled={f.locked}
                value={Number(f.value.toFixed(1))}
                onChange={(e) => {
                  const v = Math.max(0, Math.min(100, Number(e.target.value)))
                  if (!Number.isFinite(v)) return
                  if (!f.locked) nudgeHead(v)
                }}
              />
              <span style={{ color: 'var(--text-3)' }}>%</span>
            </label>
          ))}
        </div>
        <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
          <button className="btn sm ghost" title="Reshape the curve head to a 5% start" onClick={() => nudgeHead(5)}>Factory 5%</button>
          <button
            className="btn sm ghost"
            title="Watch this stick untouched for 10 s, then recommend the Start % that swallows its wander"
            disabled={!liveFeed.present || measuring !== null}
            onClick={() => {
              peakRef.current = 0
              setMeasuring({ left: 10, suggestion: null })
            }}
          >
            {measuring ? `${t('sticks.measuring')} ${measuring.left}s` : t('sticks.centerGuard')}
          </button>
        </div>
        {measuring?.suggestion !== null && measuring?.suggestion !== undefined && (
          <div className="note warn" style={{ marginTop: 8 }}>
            {t('sticks.suggest').replace('{dev}', String(measuring.suggestion.dev))}{' '}
            <button
              className="btn sm primary"
              style={{ marginLeft: 8 }}
              onClick={() => {
                nudgeHead(measuring.suggestion!.pct)
                setMeasuring(null)
              }}
            >
              {t('sticks.setStart').replace('{pct}', String(measuring.suggestion.pct))}
            </button>{' '}
            <button className="btn sm ghost" onClick={() => setMeasuring(null)}>{t('common.dismiss')}</button>
          </div>
        )}
      </div>
      <div className="card">
        <h3>{t('sticks.outer')} — ∞ no limit</h3>
        <div className="hint">The boundary of max stick input. This pad is full range, always.</div>
        <div className="row spread" style={{ margin: '10px 0' }}>
          <div>
            <div style={{ fontSize: 13.5 }}>{t('sticks.noLimitTitle')}</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
              {t('sticks.outerActive')}
            </div>
          </div>
          <button
            className="btn sm primary"
            disabled
            title="Fixed full range on this pad"
          >
            {t('sticks.infiniteOn')}
          </button>
        </div>
        <div className="note">
          <strong>What this does.</strong> The outer threshold is the deflection where the stick hits maximum output. Neutral removes the boundary entirely: full physical range with nothing clipped or boosted at the rim.
        </div>
      </div>
      </div>
      <div className="stack" style={{ gap: 16 }}>
      <div className="card" style={{ borderColor: 'var(--warn)' }}>
        <h3>{t('sticks.curve')} - 9 points</h3>
        <div className="hint">The pad stores exactly <strong>9 points</strong> per stick, so this canvas is exact — no quantization. <span style={{ color: '#ff8fa0' }}>● red = your design, drag it</span>, <span style={{ color: 'var(--warn)' }}>▢ orange dashed = the pad bytes</span>. Same tab, native protocol mirrored byte-exact from live captures. Close Space Station first.</div>
        {flyId && <div className="mono" style={{ fontSize: 11, marginTop: 6 }}>uid {flyId.uid}{stamp ? ` · last write ${stamp}` : ''}</div>}
        <div className="row" style={{ gap: 8, margin: '10px 0' }}>
          {(['Left', 'Right'] as const).map((n, i) => (
            <button key={n} className={`btn${i === which ? ' primary' : ' ghost'}`} onClick={() => setWhich(i)}>
              {n} stick
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <span className={`pill${changed ? ' warn' : ' good'}`}>{changed ? 'design ≠ pad — send it' : 'pad matches design'}</span>
        </div>
        <CurvePlot points={design} onChange={(next) => onDesign(next)} overlay={padDesign} />
        <div className="row" style={{ gap: 8, margin: '8px 0' }}>
          <button className="btn sm" disabled={busy} onClick={() => void load()}>{loaded ? 'Reload from pad' : 'Load from pad'}</button>
          <div style={{ flex: 1 }} />
          <button className="btn sm primary" disabled={!changed || busy} onClick={() => void write()}>{busy ? 'Writing…' : 'Write both curves'}</button>
        </div>
        <div className="row wrap" style={{ gap: 8, margin: '8px 0' }}>
          {[{ t: 3, label: 'Custom' }, { t: 1, label: 'Quick' }, { t: 2, label: 'Slow' }].map((o) => (
            <button key={o.t} className={`btn sm${ptype === o.t ? ' primary' : ' ghost'}`} onClick={() => setPtype(o.t)}>{o.label}</button>
          ))}
        </div>
        <div className="row wrap" style={{ gap: 8, margin: '8px 0' }}>
          {Object.entries(AIM_CURVES).map(([key, c]) => (
            <button
              key={key}
              className="btn sm ghost"
              title={`${c.hint} (resampled to 9 points)`}
              onClick={() => {
                setDesign(flyToDesign(flyResampleAim(c.pts)))
                setPtype(3)
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          <button className="btn sm ghost" onClick={() => fillPreset(2, [50, 56, 63, 69, 75, 94, 113, 131, 150])}>Slow</button>
          <button className="btn sm ghost" onClick={() => fillPreset(1, [50, 69, 88, 107, 126, 132, 138, 144, 150])}>Quick</button>
          <button
            className="btn sm ghost"
            title="Copy this stick's pad curve to the other stick"
            onClick={() => {
              const src = which === 0 ? padRight : padLeft
              setDesign(src.map((p) => ({ ...p })))
            }}
          >
            {t('sticks.copyCurve')}
          </button>
        </div>
        <div className="note" style={{ marginTop: 8 }}>Fixed 9 points per stick — no add/remove. X positions are hardware slots.</div>
        <table className="tbl" style={{ marginTop: 8 }}>
          <thead><tr><th>#</th><th>X</th><th>Y</th></tr></thead>
          <tbody>
            {design.map((p, i) => (
              <tr key={i}>
                <td className="mono">{i + 1}</td>
                <td><input className="input" type="number" min={0} max={255} value={p.x} disabled /></td>
                <td><input className="input" type="number" min={0} max={150} value={FLY_D2P(p.y)} onChange={(e) => {
                  const v = Math.max(0, Math.min(150, Number(e.target.value)))
                  if (!Number.isFinite(v)) return
                  onDesign(design.map((q, j) => (j === i ? { ...q, y: FLY_P2D(v) } : q)))
                }} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="note" style={{ marginTop: 8 }}>
          Pad bytes (exact, no quantization): <span className="mono">{padDesign.map((q) => `${FLY_D2P(q.y)}`).join(' · ')}</span>
        </div>
        {msg && <div className="note" style={{ marginTop: 8 }}>{msg}</div>}
        {err && <div className="note bad" style={{ marginTop: 8 }}>{err}</div>}
      </div>
        <div className="card">
          <h3>{t('sticks.shape')}</h3>
          <div className="hint">Three shapes for this stick — processing on for the first two, fully bypassed for raw. This pad has no shape flags: output always follows the curve.</div>
          <div className="stack" style={{ gap: 8 }}>
            {['Round diagonals', 'Square gate', 'Pure raw 1:1'].map((name) => (
              <button key={name} className="btn sm ghost" disabled title="No processing-flag equivalent on this pad">{name}</button>
            ))}
          </div>
        </div>
        <div className="card" style={{ borderColor: 'var(--bad)' }}>
          <h3>{t('sticks.reset')}</h3>
          <div className="hint">Returns both curves to the Slow baseline. Polling, precision and names are untouched. Then Send to apply.</div>
          <button
            className="btn danger"
            style={{ width: '100%', padding: '14px', fontSize: 15, fontWeight: 700, letterSpacing: '0.08em', marginTop: 10 }}
            onClick={() => resetAll()}
          >
            {t('sticks.resetAll')}
          </button>
        </div>
      </div>
    </div>
  )
}

function ProfilesPanel({ connected, activeSlot, locked, modelId, modelLen, dumpLength, modelName }: { connected: boolean; activeSlot: number | null; locked: boolean; modelId: string; modelLen: number; dumpLength: number; modelName: string | null }): JSX.Element {
  const t = useT()
  const [entries, setEntries] = useState<SlotEntry[]>([1, 2, 3, 4].map((index) => ({ index, name: null, bytes: null, loading: false, error: null })))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const update = (index: number, patch: Partial<SlotEntry>): void => {
    setEntries((prev) => prev.map((e) => (e.index === index ? { ...e, ...patch } : e)))
  }

  async function readSlot(index: number): Promise<Uint8Array> {
    update(index, { loading: true, error: null })
    try {
      const res = await api().readProfile(index, modelLen)
      const bytes = b64ToBytes(res.bytes)
      let name = ''
      try {
        name = parseProfile(bytes, modelId).name
      } catch {
        name = ''
      }
      update(index, { bytes, name, loading: false })
      return bytes
    } catch (e) {
      update(index, { loading: false, error: (e as Error).message })
      throw e
    }
  }

  async function refreshAll(): Promise<void> {
    setBusy(true)
    setMessage(null)
    // Sequential, not parallel: five concurrent 19-chunk reads on one handle
    // bury each other and surface as `timed out waiting for cmd 0x4`.
    let failed = 0
    for (const i of [1, 2, 3, 4]) {
      try {
        await readSlot(i)
      } catch {
        failed++
      }
    }
    setMessage(failed ? `${failed} slot(s) failed to read — Retry them individually` : 'Read all 4 stick profiles')
    setBusy(false)
  }

  useEffect(() => {
    if (!connected) return
    // Let the main editor's slot read finish first before starting ours.
    const t = window.setTimeout(() => void refreshAll(), 2000)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected])

  async function exportSlot(entry: SlotEntry, format: 'bin' | 'json'): Promise<void> {
    const bytes = entry.bytes ?? (await readSlot(entry.index))
    const base = (entry.name || `profile-${entry.index}`).replace(/[^\w-]+/g, '_') || `profile-${entry.index}`
    if (format === 'bin') {
      download(`${base}.sticklab.bin`, bytes)
    } else {
      download(`${base}.sticklab.json`, JSON.stringify({ version: 1, app: 'g7-stick-lab', model: modelId, index: entry.index, name: parseProfile(bytes, modelId).name, bytes: bytesToB64(bytes) }, null, 2))
    }
  }

  function handleImport(entry: SlotEntry): void {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.bin,.json,.g7p'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        let bytes: Uint8Array
        if (file.name.endsWith('.json')) {
          const parsed = JSON.parse(await file.text()) as { bytes?: string }
          if (!parsed.bytes) throw new Error('JSON file has no bytes field')
          bytes = b64ToBytes(parsed.bytes)
        } else {
          bytes = new Uint8Array(await file.arrayBuffer())
        }
        if (bytes.length !== modelLen) throw new Error(`expected ${modelLen} bytes, got ${bytes.length}`)
        setBusy(true)
        const result = await api().writeProfile(entry.index, bytesToB64(bytes), modelLen)
        if (!result.verified) throw new Error(result.rolledBack ? 'rejected — previous contents restored' : 'did not verify')
        setMessage(`Imported ${file.name} → P${entry.index} · verified`)
        await readSlot(entry.index)
      } catch (e) {
        setMessage(`Import failed: ${(e as Error).message}`)
      } finally {
        setBusy(false)
      }
    }
    input.click()
  }

  async function copyTo(from: SlotEntry, toIndex: number): Promise<void> {
    if (!window.confirm(`Overwrite P${toIndex} with P${from.index}?`)) return
    try {
      const bytes = from.bytes ?? (await readSlot(from.index))
      setBusy(true)
      const result = await api().writeProfile(toIndex, bytesToB64(bytes))
      if (!result.verified) throw new Error(result.rolledBack ? 'rejected — previous contents restored' : 'did not verify')
      setMessage(`Copied P${from.index} → P${toIndex} · verified`)
      await readSlot(toIndex)
    } catch (e) {
      setMessage(`Copy failed: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  async function backupAll(): Promise<void> {
    setBusy(true)
    try {
      const dump: Record<string, { name: string; bytes: string }> = {}
      for (const slot of [1, 2, 3, 4]) {
        const bytes = await readSlot(slot)
        dump[String(slot)] = { name: parseProfile(bytes, modelId).name, bytes: bytesToB64(bytes) }
      }
      download(`sticklab-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ version: 1, app: 'g7-stick-lab', device: 'G7ProCE', profiles: dump }, null, 2))
      setMessage('Backup downloaded')
    } catch (e) {
      setMessage(`Backup failed: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  function restoreAll(): void {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      const written: string[] = []
      try {
        const parsed = JSON.parse(await file.text()) as { profiles?: Record<string, { name?: string; bytes?: string }> }
        const slots = Object.entries(parsed.profiles ?? {})
          .map(([slot, entry]) => ({ slot: Number(slot), entry }))
          .filter((x) => Number.isInteger(x.slot) && x.slot >= 1 && x.slot <= 4 && !!x.entry?.bytes)
        if (slots.length === 0) throw new Error('that file holds no profiles')
        if (!window.confirm(`Write ${slots.length} profile(s)? ${slots.map((x) => `P${x.slot} ${x.entry.name || ''}`).join(', ')}`)) return
        setBusy(true)
        for (const { slot, entry } of slots) {
          const bytes = b64ToBytes(entry.bytes as string)
          if (bytes.length !== modelLen) throw new Error(`P${slot}: expected ${modelLen} bytes, got ${bytes.length}`)
          const result = await api().writeProfile(slot, bytesToB64(bytes), modelLen)
          if (!result.verified) throw new Error(result.rolledBack ? `P${slot} rejected — restored` : `P${slot} did not verify`)
          written.push(`P${slot}`)
          await readSlot(slot)
        }
        setMessage(`Restored ${written.join(', ')} · all verified`)
      } catch (e) {
        setMessage(`Restore failed: ${written.length ? `restored ${written.join(', ')} before failing — ` : ''}${(e as Error).message}`)
      } finally {
        setBusy(false)
      }
    }
    input.click()
  }

  if (!connected) return <div className="note">{t('profiles.needConn')}</div>
  if (locked) {
    return (
      <LockedDump
        modelId={modelId}
        modelName={modelName}
        defaultLength={dumpLength > 0 ? dumpLength : 680}
      />
    )
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3>{t('profiles.title')} — {t('profiles.subtitle')}</h3>
      <div className="hint">{t('profiles.hint')}</div>
      <div className="row wrap" style={{ gap: 8, margin: '10px 0' }}>
        <button className="btn sm" disabled={busy} onClick={() => void refreshAll()}>{busy ? t('common.working') : t('profiles.readAll')}</button>
        <button className="btn sm" disabled={busy} onClick={() => void backupAll()}>{t('profiles.backup')}</button>
        <button className="btn sm" disabled={busy} onClick={restoreAll}>{t('profiles.restore')}</button>
        {message && <span className="pill">{message}</span>}
      </div>
      <table className="tbl">
        <thead><tr><th>{t('profiles.slot')}</th><th>{t('profiles.name')}</th><th>{t('profiles.active')}</th><th>{t('profiles.actions')}</th></tr></thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.index}>
              <td className="mono">P{entry.index}</td>
              <td>{entry.loading ? t('profiles.reading') : entry.error ? <span style={{ color: 'var(--bad)' }}>{entry.error} <button className="btn sm ghost" disabled={busy} onClick={() => void readSlot(entry.index)}>{t('profiles.retry')}</button></span> : (entry.name || <span style={{ color: 'var(--text-3)' }}>{t('profiles.unnamed')}</span>)}</td>
              <td>{entry.index === activeSlot ? <span className="pill good">{t('profiles.current')}</span> : <span className="tag">—</span>}</td>
              <td>
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn sm ghost" disabled={busy} onClick={() => void exportSlot(entry, 'bin')}>{t('profiles.export')}</button>
                  <button className="btn sm ghost" disabled={busy} onClick={() => void exportSlot(entry, 'json')}>JSON</button>
                  <button className="btn sm ghost" disabled={busy} onClick={() => handleImport(entry)}>{t('profiles.import')}</button>
                  <select className="input" style={{ width: 110 }} disabled={busy} value="" onChange={(e) => { if (e.target.value) void copyTo(entry, Number(e.target.value)) }}>
                    <option value="">{t('profiles.copyTo')}</option>
                    {[1, 2, 3, 4].filter((s) => s !== entry.index).map((s) => <option key={s} value={s}>P{s}</option>)}
                  </select>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ResetEverythingCard({ profile, fd, edit, onReload, notify }: {
  profile: Profile | null
  fd: Packet | null
  edit: (fn: () => void) => void
  onReload: () => void
  notify: (m: string) => void
}): JSX.Element | null {
  const t = useT()
  if (!profile || !fd) return null
  return (
    <div className="card" style={{ marginTop: 16, borderColor: 'var(--bad)' }}>
      <h3>{t('sticks.reset')}</h3>
      <div className="hint">{t('sticks.resetHint')}</div>
      <button
        className="btn danger"
        style={{ width: '100%', padding: '14px', fontSize: 15, fontWeight: 700, letterSpacing: '0.08em', marginTop: 10 }}
        onClick={() => {
          if (!window.confirm('Reset EVERYTHING this app controls to stock neutral?\n\nBoth sticks, outer, detail, polling. Names, triggers, buttons and macros are kept.')) return
          edit(() => {
            profile.sticks.forEach((s, i) => {
              stick.setDeadzone(s, { begin: 50, end: 1000, beginAnti: 0, endAnti: 1000 })
              stick.setCurve(s, LINEAR_CURVE.map((p) => ({ ...p })))
              stick.markCurveIdentity(s)
              stick.setFlipX(s, false)
              stick.setFlipY(s, false)
              stick.setSquareGate(s, false)
              stick.setAxisRatio(s, 50)
              stick.setMouseDpi(s, 50)
              stick.setMapIndex(s, i === 0 ? 1 : 2)
              stick.setMapped(s, true)
            })
            fun.extend.setStickResolutionBits(fd, 12)
            fun.extend.setReportRateGear(fd, 5)
            fun.extend.setLsAntiJitter(fd, 11)
            fun.extend.setRsAntiJitter(fd, 11)
          })
          onReload()
          notify('Everything reset to stock neutral — Write to apply it to the pad.')
        }}
      >
        {t('sticks.resetAll')}
      </button>
    </div>
  )
}

function StickCross({ lx, ly, rx, ry }: { lx: number; ly: number; rx: number; ry: number }): JSX.Element {
  const ref = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    const w = c.clientWidth
    const h = 190
    c.width = w * dpr
    c.height = h * dpr
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    const draw = (x: number, y: number, cx: number, label: string): void => {
      const r = 62
      ctx.strokeStyle = '#3a2230'
      ctx.beginPath()
      ctx.arc(cx, h / 2, r, 0, Math.PI * 2)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(cx - r, h / 2)
      ctx.lineTo(cx + r, h / 2)
      ctx.moveTo(cx, h / 2 - r)
      ctx.lineTo(cx, h / 2 + r)
      ctx.stroke()
      const nx = (x - 128) / 128
      const ny = (y - 128) / 128
      const px = cx + nx * r
      const py = h / 2 + ny * r
      ctx.fillStyle = '#f43f52'
      ctx.beginPath()
      ctx.arc(px, py, 7, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#c9a3ad'
      ctx.font = '11px system-ui'
      ctx.fillText(label, cx - 12, h - 8)
    }
    draw(lx, ly, w * 0.27, `L ${lx},${ly}`)
    draw(rx, ry, w * 0.73, `R ${rx},${ry}`)
  }, [lx, ly, rx, ry])
  return <canvas ref={ref} className="plot" style={{ height: 190 }} />
}

export default function App(): JSX.Element {
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [connPath, setConnPath] = useState<string | null>(null)
  // Idle receivers (all-zero frames) are hidden; the open handle and
  // unopenable handles always stay visible. If nothing proves live, show
  // everything rather than an empty list. Receiver interfaces (0x0575) are
  // hidden whenever a direct pad interface is present — they only stay when
  // wireless-through-receiver is the sole path.
  const knownPadPids = MODELS.flatMap((m) => m.pids)
  const hasDirectPad = candidates.some((c) => knownPadPids.includes(c.productId) && c.live === true)
  const visibleCandidates = (
    candidates.some((c) => c.live === true) ? candidates.filter((c) => c.live === true || c.live === null || c.path === connPath) : candidates
  ).filter((c) => !(c.productId === 0x0575 && hasDirectPad))
  const [connected, setConnected] = useState(false)
  const [info, setInfo] = useState<DeviceInfo | null>(null)
  const [pid, setPid] = useState<number | null>(null)
  const [model, setModel] = useState<ControllerModel | null>(null)
  const [slot, setSlot] = useState(3)
  const [flyId, setFlyId] = useState<FlyIdentity | null>(null)
  const [blob, setBlob] = useState<Uint8Array | null>(null)
  const [dirty, setDirty] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [which, setWhich] = useState(0)
  const [live, setLive] = useState<LiveSample | null>(null)
  const [busy, setBusy] = useState(false)
  const [loadId, setLoadId] = useState(0)
  const [savedAt, setSavedAt] = useState<{ slot: number; at: number } | null>(null)
  const [tab, setTab] = useState<'sticks' | 'device' | 'profiles' | 'lab' | 'calibrate' | 'marius' | 'xinput' | 'language'>('sticks')
  const [measuring, setMeasuring] = useState<{ left: number; suggestion: { dev: number; pct10: number } | null } | null>(null)
  const wanderRef = useRef(0)
  const modelLenRef = useRef(PROFILE_LENGTH)
  // The device-event effect below runs once, so its closures go stale — these
  // refs keep the reconnect handler pointed at the live slot + dirty flag.
  const slotRef = useRef(slot)
  slotRef.current = slot
  const dirtyRef = useRef(false)
  dirtyRef.current = dirty
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [showSafety, setShowSafety] = useState(() => {
    try {
      return window.localStorage.getItem('sticklabs.seenSafety') !== '1'
    } catch {
      return true
    }
  })
  // Free-point curve design (2–10 pts). The pad only stores 5, so this is a
  // design canvas — `quantized` is what actually gets written. Persisted per
  // slot+stick so a half-finished shape survives a reload.
  const [design, setDesign] = useState<Array<{ x: number; y: number }>>([])
  // Slot sampling mode for the curve designer: straight segments (linear)
  // or the smoothed spline. Only changes the 5 bytes that get written —
  // the red design stays exactly as drawn.
  const [spline, setSpline] = useState(false)
  // User curve presets for 8K profiles — named designs kept in this browser.
  const [presets, setPresets] = useState<Array<{ name: string; pts: Array<{ x: number; y: number }> }>>(() => {
    try {
      const raw = window.localStorage.getItem('sticklabs.curves.v1')
      if (!raw) return []
      const parsed = JSON.parse(raw) as Array<{ name: string; pts: Array<{ x: number; y: number }> }>
      return Array.isArray(parsed)
        ? parsed
            .filter((p) => typeof p?.name === 'string' && Array.isArray(p?.pts))
            .slice(0, 20)
            .map((p) => ({
              name: p.name.slice(0, 24),
              pts: p.pts
                .filter((q) => Number.isFinite(q?.x) && Number.isFinite(q?.y))
                .slice(0, 10)
                .map((q) => ({ x: Math.max(0, Math.min(255, Math.round(q.x))), y: Math.max(0, Math.min(255, Math.round(q.y))) })),
            }))
        : []
    } catch {
      return []
    }
  })
  useEffect(() => {
    try {
      window.localStorage.setItem('sticklabs.curves.v1', JSON.stringify(presets))
    } catch {
      /* storage full/blocked — presets stay session-only */
    }
  }, [presets])
  const [lang, setLang] = useLangState()
  const t = (key: string): string => tr(lang, key)
  const [, force] = useState(0)
  const bump = (): void => {
    setDirty(true)
    force((n) => n + 1)
  }

  useEffect(() => {
    const offSample = api().on('input:sample', (s) => setLive(s as unknown as LiveSample))
    const offStale = api().on('device:stale', () => {
      setMsg('Pad restarted to apply the write — if the sidebar shows disconnected, hit Rescan USB + Connect again.')
    })
    const offReconnecting = api().on('device:reconnecting', () => {
      setMsg('Pad rebooted to apply the change — reconnecting automatically…')
    })
    const offReconnected = api().on('device:reconnected', (incoming) => {
      const info = incoming as unknown as DeviceInfo
      setConnected(true)
      setInfo(info)
      if (dirtyRef.current) {
        // A reboot mid-edit must not silently throw away the working copy:
        // keep it and let the user choose when to re-read the pad.
        setMsg('Reconnected — your unsaved edits were kept. Re-select the slot to reload the pad bytes.')
      } else {
        setMsg('Reconnected — profile reloaded.')
        void loadSlot(slotRef.current)
      }
    })
    return () => {
      offSample()
      offStale()
      offReconnecting()
      offReconnected()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function refresh(): Promise<void> {
    try {
      setCandidates(await api().discover())
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  useEffect(() => {
    void refresh()
    void api().version().then(setAppVersion).catch(() => undefined)
  }, [])

  async function connect(path: string): Promise<void> {
    setErr(null)
    try {
      const cand = candidates.find((c) => c.path === path)
      const pre = identifyModel(cand?.product, cand?.productId) ?? null
      if (pre && pre.support === 'unsupported') {
        // Known-unsupportable (e.g. DLL-driven pads with no HID listener):
        // don't waste 10 s timing out a handshake that cannot answer.
        setModel(pre)
        setPid(cand?.productId ?? null)
        setMsg(`${pre.marketingName} detected — ${pre.supportNote}`)
        return
      }
      if (pre?.id === 'Apex5') {
        // Flydigi speaks WebHID interrupt reports, not the GameSir channel —
        // handshake + tuning run renderer-side over flyTransport.
        try {
          await flyTransport.connect()
          const ident = await flyTransport.identify()
          setConnPath(path)
          setConnected(true)
          setInfo({ firmware: 'apex-link', dongle: '', currentProfile: 0 })
          setPid(cand?.productId ?? null)
          setModel(pre)
          setFlyId(ident)
          setMsg('Flydigi Apex 5 connected — left-curve tuning is live in Sticks. Close Space Station while tuned here.')
        } catch (e) {
          setErr((e as Error).message)
        }
        return
      }
      const res = await api().connect(path)
      setConnPath(path)
      setConnected(true)
      setInfo(res)
      setPid(cand?.productId ?? null)
      const m = identifyModel(cand?.product, cand?.productId) ?? null
      setModel(m)
      if (m && m.support === 'full') {
        await loadSlot(slot, m.profileLength)
      } else if (m) {
        setBlob(null)
        setMsg(`${m.marketingName} detected — ${m.supportNote}`)
      } else {
        // Unknown PID (new editions like Royal2): prove the family live.
        // Handshake already answered; a 1070-byte read that parses as a
        // CE-family profile unlocks it as an unverified variant. Anything
        // else stays locked — this is what keeps a foreign layout safe.
        setMsg('Unknown edition — proving compatibility (read-only check)…')
        try {
          // Try the running slot first, then every user slot: a single
          // family-shaped read anywhere unlocks the pad.
          const tried = [res.currentProfile, 1, 2, 3, 4].filter((s, i, a) => s >= 1 && s <= 5 && a.indexOf(s) === i)
          let proven: Uint8Array | null = null
          for (const s of tried) {
            try {
              const probe = await api().readProfile(s, PROFILE_LENGTH)
              const bytes = b64ToBytes(probe.bytes)
              if (looksLikeCEProfile(bytes)) {
                proven = bytes
                break
              }
            } catch {
              /* next slot */
            }
          }
          if (proven) {
            const ce = MODELS.find((x) => x.id === 'G7ProCE')
            const variant: ControllerModel = {
              ...(ce ?? {
                id: 'G7ProCE',
                marketingName: 'GameSir G7 Pro 8K',
                vendorId: 0x3537,
                usagePage: 0xfff0,
                usage: 0x40,
                pids: [],
                productHints: [],
                reportRates: REPORT_RATE_OPTIONS.map((o) => ({ gear: o.gear, hz: o.hz, confirmed: o.confirmed })),
                profileLength: 1070,
                dumpLength: 1070,
                support: 'full',
                supportNote: ''
              }),
              supportNote: `Unlisted edition (PID 0x${(cand?.productId ?? 0).toString(16)}) — family proven live by structural check. Report this PID to add it permanently.`
            }
            setModel(variant)
            await loadSlot(slot, variant.profileLength)
          } else {
            setBlob(null)
            setMsg(
              `Unknown model (PID 0x${cand ? cand.productId.toString(16) : '?'}) — its profile does not read as G7-family, so it stays locked. Report the PID and model name to add it.`
            )
          }
        } catch (e) {
          setBlob(null)
          setMsg(
            `Unknown model — compatibility check failed (${(e as Error).message}). Locked as a safety default; report the PID to add it.`
          )
        }
      }
    } catch (e) {
      const raw = (e as Error).message
      setErr(
        raw.includes('timed out waiting for response')
          ? `${raw} — the pad opened but never answered. Use wired USB or the 2.4 GHz dongle (Bluetooth exposes no config channel to any app), update firmware in GameSir Connect first if this is a first connect, then close GameSir Connect (it holds the handle) and retry. If it persists, try another listed interface.`
          : raw
      )
    }
  }

  async function loadSlot(s: number, len = modelLenRef.current): Promise<void> {
    setBusy(true)
    setMsg(null)
    setErr(null)
    try {
      const res = await api().readProfile(s, len)
      setBlob(b64ToBytes(res.bytes))
      setSlot(s)
      setDirty(false)
      setLoadId((n) => n + 1)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function write(): Promise<boolean> {
    if (!blob) return false
    setBusy(true)
    setMsg(null)
    setErr(null)
    try {
      const res = await api().writeProfile(slot, bytesToB64(blob), modelLen)
      if (res.verified) {
        const liveNow = info?.currentProfile
        setSavedAt({ slot, at: Date.now() })
        setDirty(false)
        if (liveNow !== undefined && liveNow !== slot) {
          // One step: apply by switching onto the written slot, then prove
          // it — the pad may reboot instead of acking, so the live slot is
          // read back (across the reboot window) rather than trusting reply.
          let switched = false
          try {
            await api().switchProfile(slot)
            switched = true
          } catch {
            /* reboot likely ate the ack — confirm below instead of failing */
          }
          let applied = switched
          if (!applied) {
            setMsg(`Slot ${slot} written + verified — confirming it took (pad may be rebooting)…`)
          }
          for (let i = 0; i < 8 && !applied; i++) {
            await new Promise((r) => setTimeout(r, 1000))
            try {
              if ((await api().currentProfile()) === slot) applied = true
            } catch {
              /* handle down mid-reboot — retry */
            }
          }
          if (applied) {
            setInfo((prev) => (prev ? { ...prev, currentProfile: slot } : prev))
            setMsg(`Slot ${slot} written, verified and confirmed live on the pad.`)
          } else {
            setMsg(`Slot ${slot} written + verified, but could not confirm it went live — use Activate in Stick profiles below.`)
          }
        } else {
          setMsg(`Slot ${slot} written + read-back verified. If the pad reboots (~1-2 s), it is applying the change — reconnect if needed.`)
        }
        return true
      } else if (res.rolledBack) {
        setErr('Write did not verify — previous bytes restored.')
        await loadSlot(slot)
      }
      return false
    } catch (e) {
      setErr((e as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }

  const profile = blob ? parseProfile(blob, model?.id ?? 'G7ProCE') : null
  // Mutations go straight into `blob` via Packet views; re-serialize keeps
  // the working copy canonical so write() sends exactly what the UI shows.
  const syncBlob = (): void => {
    if (profile && blob) {
      const out = serializeProfile(profile)
      blob.set(out)
    }
  }
  const edit = (fn: () => void): void => {
    fn()
    syncBlob()
    bump()
  }

  const pkt = profile?.sticks[which] ?? null
  const fd = profile?.funData ?? null
  const dz = pkt ? stick.deadzone(pkt) : null
  const outerBuffer = dz ? outerBufferFromBytes(dz.end, dz.endAnti) : 0
  const outerUnlimited = dz ? isOuterUnlimited(dz.end, dz.endAnti) : true
  const pts = pkt ? stick.curve(pkt) : []
  const resBits = fd ? fun.extend.stickResolutionBits(fd) : 12
  const gear = fd ? fun.extend.reportRateGear(fd) : 5
  const rates = model && model.reportRates.length > 0 ? model.reportRates : REPORT_RATE_OPTIONS
  const gearHz = rates.find((o) => o.gear === gear)?.hz ?? 0
  const resWire = fd ? fun.extend.stickResolution(fd) : 0
  const resInfo = describeRawResolution(fd ? fun.extend.stickResolution(fd) : 0)

  // Center guard: while measuring, track the worst rest deviation of the
  // current stick; the countdown then proposes a Start % that covers it.
  useEffect(() => {
    if (!measuring || measuring.suggestion || !live) return
    const axes = which === 0 ? [live.lx, live.ly] : [live.rx, live.ry]
    const dev = Math.max(...axes.map((v) => Math.abs(v - 128)))
    if (dev > wanderRef.current) wanderRef.current = dev
  }, [live, measuring, which])

  useEffect(() => {
    if (!measuring || measuring.suggestion) return
    if (measuring.left <= 0) {
      const dev = Math.round(wanderRef.current)
      const pct10 = Math.min(200, Math.ceil((dev / 128) * 1000) + 5)
      setMeasuring({ left: 0, suggestion: { dev, pct10 } })
      return
    }
    const t = window.setTimeout(() => {
      setMeasuring((m) => (m && !m.suggestion ? { ...m, left: m.left - 1 } : m))
    }, 1000)
    return () => window.clearTimeout(t)
  }, [measuring])

  const designKey = `sticklab.design.${slot}.${which}`  // (Re)load the design canvas whenever the slot, stick, or profile bytes
  // change: prefer a saved design, else start from the pad's 5 points.
  useEffect(() => {
    if (!pkt) return
    setMeasuring(null)
    try {
      const saved = window.localStorage.getItem(designKey)
      if (saved) {
        const parsed = JSON.parse(saved) as Array<{ x: number; y: number }>
        if (Array.isArray(parsed) && parsed.length >= DESIGN_MIN_POINTS && parsed.length <= DESIGN_MAX_POINTS) {
          setDesign(parsed.map((p) => ({ x: Math.max(0, Math.min(255, Math.round(p.x))), y: Math.max(0, Math.min(255, Math.round(p.y))) })))
          return
        }
      }
    } catch {
      /* fall through to pad curve */
    }
    setDesign(stick.curve(pkt).map((p) => ({ ...p })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadId, slot, which, designKey])

  useEffect(() => {
    if (design.length === 0) return
    try {
      window.localStorage.setItem(designKey, JSON.stringify(design))
    } catch {
      /* storage full/blocked — design still works for the session */
    }
  }, [design, designKey])

  const quantized = design.length >= 2 ? (spline ? resampleSpline(design) : resampleCurve(design)) : pts
  const locked = connected && (!model || model.support !== 'full')
  const modelId = model?.id ?? 'G7ProCE'
  const modelLen = model && model.profileLength > 0 ? model.profileLength : PROFILE_LENGTH
  modelLenRef.current = modelLen
  const padCurve = pts
  const curvePending = quantized.length === padCurve.length && quantized.some((q, i) => q.x !== padCurve[i].x || q.y !== padCurve[i].y)

  function reloadDesignFromPad(): void {
    if (pkt) setDesign(stick.curve(pkt).map((p) => ({ ...p })))
  }

  return (
    <LangContext.Provider value={{ lang, setLang }}>
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <h1>Stick <span>Labs</span></h1>
        </div>
        <nav className="nav">
          <div className="nav-group">
            <h4>{t('nav.tuning')}</h4>
            <button type="button" className={`nav-item${tab === 'sticks' ? ' active' : ''}`} onClick={() => setTab('sticks')}>
              {t('nav.sticks')}
            </button>
            <button type="button" className={`nav-item${tab === 'device' ? ' active' : ''}`} onClick={() => setTab('device')}>
              {t('nav.device')}
            </button>
            <button type="button" className={`nav-item${tab === 'calibrate' ? ' active' : ''}`} onClick={() => setTab('calibrate')}>
              {t('nav.calibrate')}
            </button>
          </div>
          <div className="nav-group">
            <h4>{t('nav.data')}</h4>
            <button type="button" className={`nav-item${tab === 'profiles' ? ' active' : ''}`} onClick={() => setTab('profiles')}>
              {t('nav.profiles')}
            </button>
            <button type="button" className={`nav-item${tab === 'lab' ? ' active' : ''}`} onClick={() => setTab('lab')}>
              {t('nav.lab')}
            </button>
          </div>
          <div className="nav-group">
            <h4>{t('nav.preview')}</h4>
            <button type="button" className={`nav-item${tab === 'xinput' ? ' active' : ''}`} onClick={() => setTab('xinput')}>
              Xbox 360 / XInput
            </button>
            <button type="button" className={`nav-item${tab === 'marius' ? ' active' : ''}`} onClick={() => setTab('marius')}>
              Marius
            </button>
          </div>
          <div className="nav-group">
            <h4>{t('nav.app')}</h4>
            <button type="button" className={`nav-item${tab === 'language' ? ' active' : ''}`} onClick={() => setTab('language')}>
              {t('nav.language')}
            </button>
          </div>
        </nav>
        <div className="stack" style={{ gap: 10 }}>
          <button className="btn ghost sm" onClick={() => void refresh()}>{t('side.rescan')}</button>
          <button
            className="btn ghost sm"
            title={t('side.copyTitle')}
            onClick={() => {
              const lines = [
                `Stick Labs v${appVersion ?? '?'} ${new Date().toISOString()}`,
                `connected=${connected} model=${model?.id ?? 'none'} pid=${pid !== null ? '0x' + pid.toString(16) : 'none'} fw=${info?.firmware ?? 'none'}`,
                ...candidates.map(
                  (c) => `cand pid=0x${c.productId.toString(16)} live=${c.live} preferred=${c.preferred} product=${c.product ?? '?'}`
                )
              ]
              const text = lines.join('\n')
              try {
                void navigator.clipboard.writeText(text).then(
                  () => setMsg('Diagnostics copied — paste it to RealKiyoshi.'),
                  () => setMsg(text)
                )
              } catch {
                setMsg(text)
              }
            }}
          >
            {t('side.copy')}
          </button>
          {visibleCandidates.map((c) => {
            const known = identifyModel(c.product, c.productId)
            return (
              <button key={c.path} className="btn sm" onClick={() => void connect(c.path)}>
                {known ? known.marketingName : (c.product || `Unknown 0x${c.productId.toString(16)}`)}{c.preferred ? ' ★' : ''}
              </button>
            )
          })}
          {connected && (
            <button
              className="btn ghost sm"
              onClick={() => {
                void api().disconnect()
                flyTransport.disconnect()
                setConnPath(null)
                setConnected(false)
                setInfo(null)
                setPid(null)
                setModel(null)
                setFlyId(null)
              }}
            >
              {t('side.disconnect')}
            </button>
          )}
          {info && (
            <div className="note">
              {model?.id === 'Apex5' && flyId ? (
                <>Apex 5 · uid {flyId.uid.slice(0, 12)}…<br />{model.marketingName}</>
              ) : (
                <>{t('msg.fw')} {info.firmware} · {t('msg.liveSlot')} P{info.currentProfile}<br />{model ? model.marketingName : t('msg.unknownModel')}</>
              )}
            </div>
          )}
          {pid === 0x0575 && (
            <div className="note bad">
              {t('msg.receiver')}
            </div>
          )}
        </div>
        <div className="status-bar">
          <div className="status-row">
            <span className={`dot ${connected ? 'good' : 'bad'}`} />
            {connected ? t('side.connected') : t('side.disconnected')}
            {appVersion && <span style={{ color: 'var(--text-3)' }}>v{appVersion}</span>}
          </div>
          <div className="status-row" style={{ marginTop: 8 }}>
            <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{t('side.by')}</span>
          </div>
          <button
            type="button"
            className="btn ghost sm"
            style={{ marginTop: 6 }}
            onClick={() => void api().openExternal('https://www.youtube.com/@realkiyoshi').catch(() => undefined)}
          >
            YouTube @realkiyoshi
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="row" style={{ gap: 12 }}>
            <h2>Stick Labs</h2>
            <span className="sub">{t('topbar.sub')}</span>
          </div>
          <div className="row" style={{ gap: 8 }}>
            {[1, 2, 3, 4].map((s) => (
              <button
                key={s}
                className={`btn sm${s === slot ? ' primary' : ' ghost'}`}
                disabled={!connected || busy || locked}
                onClick={() => void loadSlot(s)}
              >
                P{s}
              </button>
            ))}
            <button className="btn sm primary" disabled={!connected || !dirty || busy || locked} onClick={() => void write()}>
              {busy ? t('common.working') : t('top.write')}
            </button>
            {dirty && <span className="pill warn">{t('msg.unsaved')}</span>}
            {!dirty && savedAt && savedAt.slot === slot && (
              <span className="pill good" title={t('msg.verifiedTitle')}>
                {t('msg.saved')} {new Date(savedAt.at).toLocaleTimeString()}
              </span>
            )}
          </div>
        </header>
        <div className="content">
          {showSafety && tab !== 'xinput' && (
            <div className="card" style={{ marginBottom: 16, borderColor: 'var(--warn)' }}>
              <h3>{t('safety.title')}</h3>
              <div className="stack" style={{ gap: 6, fontSize: 13 }}>
                <span>1. <strong>{t('safety.backup')}</strong> — Stick profiles card → Backup all → JSON. You can always restore.</span>
                <span>2. <strong>{t('safety.closeApp')}</strong> — it holds the controller and blocks this app.</span>
                <span>3. <strong>{t('safety.wired')}</strong> — Bluetooth pads don't appear here, ever.</span>
                <span>4. <strong>{t('safety.reboot')}</strong> for ~2 seconds. Normal — it reconnects by itself.</span>
                <span>5. <strong>{t('safety.tournaments')}</strong> — check your event's rules before competing on a tuned profile.</span>
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <button
                  className="btn sm primary"
                  onClick={() => {
                    try {
                      window.localStorage.setItem('sticklabs.seenSafety', '1')
                    } catch {
                      /* ignore */
                    }
                    setShowSafety(false)
                  }}
                >
                  {t('common.gotIt')}
                </button>
              </div>
            </div>
          )}
          {err && <div className="note bad">{err}</div>}
          {msg && <div className="note">{msg}</div>}
          {dirty && <div className="note warn">{t('msg.dirty')}</div>}
          {!connected && tab !== 'xinput' && (
            <div className="msg"><h3>{t('msg.connect')}</h3><p>{t('msg.models')} {t('msg.connectBody')}</p></div>
          )}
          {connected && !profile && model?.id !== 'Apex5' && (
            !model || model.support !== 'full' ? (
              <div className="msg">
                <h3>{model ? `${model.marketingName} — ${t('msg.locked')}` : `${t('msg.unknownModel')} — ${t('msg.locked')}`}</h3>
                <p>{model ? model.supportNote : 'This USB ID is not in the verified model table, so profile access stays off as a safety default.'}</p>
                <p>Live input below still works. Profile reads/writes stay disabled until the layout is verified on hardware.</p>
              </div>
            ) : (
              <div className="msg"><h3>{t('msg.loading')}</h3></div>
            )
          )}
          {connected && !profile && model?.id === 'Apex5' && (
            <>
              {tab === 'sticks' && (<ApexSticks flyId={flyId} />)}
              {tab === 'device' && (
                <ApexDevice flyId={flyId} rates={rates} />
              )}
              {(tab === 'profiles' || tab === 'lab') && (
                <div className="msg"><h3>Not mapped yet</h3><p>Profile slots and analytics are GameSir-layout only. Apex curve tuning lives in Sticks.</p></div>
              )}
              {tab === 'calibrate' && (
                <ApexCalibrate />
              )}
            </>
          )}
          {connected && profile && pkt && dz && fd && (
            <>
              <div className="row" style={{ gap: 8, marginBottom: 12 }}>
                {(['Left', 'Right'] as const).map((n, i) => (
                  <button key={n} className={`btn${i === which ? ' primary' : ' ghost'}`} onClick={() => setWhich(i)}>
                    {(n === 'Left' ? t('cal.left') : t('cal.right'))} {t('sticks.stick')}
                  </button>
                ))}
                <div style={{ flex: 1 }} />
                <span className="pill">{resBits}-bit · {bitsToLevels(resBits).toLocaleString()} {t('device.levels')}</span>
              </div>
              {tab === 'sticks' && (
              <div className="two" style={{ alignItems: 'start' }}>
                <div className="stack" style={{ gap: 16 }}>
                  <div className="card">
                    <h3>{t('sticks.live')}</h3>
                    <div className="hint">{t('sticks.liveNote')} {t('sticks.liveHint')}</div>
                    <StickCross lx={live?.lx ?? 128} ly={live?.ly ?? 128} rx={live?.rx ?? 128} ry={live?.ry ?? 128} />
                    <div className="row spread">
                      <span className="mono">L {live?.lx ?? '—'},{live?.ly ?? '—'}</span>
                      <span className="mono">R {live?.rx ?? '—'},{live?.ry ?? '—'}</span>
                    </div>
                  </div>


                  <div className="card">
                    <h3>{t('sticks.deadzone')} — {t('sticks.steps01')}</h3>
                    <div className="hint">{t('sticks.dzHint')}</div>
                    <div className="stack" style={{ gap: 12, marginTop: 8 }}>
                      <Slider label={t('sticks.start')} value={dz.begin / 10} min={0} max={20} step={0.1} unit="%" onChange={(v) => edit(() => stick.setDeadzone(pkt, { ...stick.deadzone(pkt), begin: Math.round(v * 10) }))} format={(v) => `${v.toFixed(1)}%`} />
                      <Slider label={t('sticks.end')} value={dz.end / 10} min={10} max={100} step={0.1} unit="%" onChange={(v) => edit(() => stick.setDeadzone(pkt, { ...stick.deadzone(pkt), end: Math.round(v * 10) }))} format={(v) => `${v.toFixed(1)}%`} />
                      <Slider label={t('sticks.antiStart')} value={dz.beginAnti / 10} min={0} max={50} step={0.1} unit="%" onChange={(v) => edit(() => stick.setDeadzone(pkt, { ...stick.deadzone(pkt), beginAnti: Math.round(v * 10) }))} format={(v) => `${v.toFixed(1)}%`} />
                      <Slider label={t('sticks.antiEnd')} value={dz.endAnti / 10} min={50} max={100} step={0.1} unit="%" onChange={(v) => edit(() => stick.setDeadzone(pkt, { ...stick.deadzone(pkt), endAnti: Math.round(v * 10) }))} format={(v) => `${v.toFixed(1)}%`} />
                    </div>
                    <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
                      {(
                        [
                          { label: t('sticks.nStart'), key: 'begin', value: dz.begin / 10 },
                          { label: t('sticks.nEnd'), key: 'end', value: dz.end / 10 },
                          { label: t('sticks.nAntiStart'), key: 'beginAnti', value: dz.beginAnti / 10 },
                          { label: t('sticks.nAntiEnd'), key: 'endAnti', value: dz.endAnti / 10 }
                        ] as const
                      ).map((f) => (
                        <label key={f.key} className="row" style={{ gap: 6, fontSize: 12 }}>
                          <span className="label">{f.label}</span>
                          <input
                            className="input"
                            style={{ width: 76 }}
                            type="number"
                            min={0}
                            max={100}
                            step={0.1}
                            value={Number(f.value.toFixed(1))}
                            onChange={(e) => {
                              const v = Math.max(0, Math.min(100, Number(e.target.value)))
                              if (!Number.isFinite(v)) return
                              edit(() => stick.setDeadzone(pkt, { ...stick.deadzone(pkt), [f.key]: Math.round(v * 10) }))
                            }}
                          />
                          <span style={{ color: 'var(--text-3)' }}>%</span>
                        </label>
                      ))}
                    </div>
                    <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
                      <button className="btn sm" onClick={() => edit(() => stick.applyPhysics(pkt))}>{t('sticks.physics')}</button>
                      <button className="btn sm ghost" onClick={() => edit(() => stick.setDeadzone(pkt, { begin: 50, end: 1000, beginAnti: 0, endAnti: 1000 }))}>{t('sticks.factory')}</button>
                      <button className="btn sm ghost" title={t('sticks.tAim')} onClick={() => edit(() => stick.setDeadzone(pkt, { ...stick.deadzone(pkt), end: 800 }))}>{t('sticks.aimEnd')}</button>
                      <button className="btn sm ghost" title={t('sticks.tFlick')} onClick={() => edit(() => stick.setDeadzone(pkt, { ...stick.deadzone(pkt), end: 650 }))}>{t('sticks.flickEnd')}</button>
                      <button className="btn sm ghost" title={t('sticks.tSnap')} onClick={() => edit(() => stick.setDeadzone(pkt, { ...stick.deadzone(pkt), beginAnti: 80 }))}>{t('sticks.antiSnap')}</button>
                      <button className="btn sm ghost" title={t('sticks.tMax')} onClick={() => edit(() => stick.setDeadzone(pkt, { ...stick.deadzone(pkt), beginAnti: 150 }))}>{t('sticks.antiMax')}</button>
                      <button className="btn sm ghost" title={t('sticks.tOff')} onClick={() => edit(() => stick.setDeadzone(pkt, { ...stick.deadzone(pkt), beginAnti: 0, endAnti: 1000 }))}>{t('sticks.antiOff')}</button>
                      <button
                        className="btn sm ghost"
                        title={t('sticks.watchTitle')}
                        disabled={!live || measuring !== null}
                        onClick={() => {
                          wanderRef.current = 0
                          setMeasuring({ left: 10, suggestion: null })
                        }}
                      >
                        {measuring ? `${t('sticks.measuring')} ${measuring.left}s` : t('sticks.centerGuard')}
                      </button>
                    </div>
                    {measuring?.suggestion !== null && measuring?.suggestion !== undefined && (
                      <div className="note warn" style={{ marginTop: 8 }}>
                        {t('sticks.suggest').replace('{dev}', String(measuring.suggestion.dev))}{' '}
                        <button
                          className="btn sm primary"
                          style={{ marginLeft: 8 }}
                          onClick={() => {
                            const pct10 = measuring.suggestion!.pct10
                            edit(() => stick.setDeadzone(pkt, { ...stick.deadzone(pkt), begin: pct10 }))
                            setMeasuring(null)
                          }}
                        >
                          {t('sticks.setStart').replace('{pct}', String(measuring.suggestion.pct10 / 10))}
                        </button>{' '}
                        <button className="btn sm ghost" onClick={() => setMeasuring(null)}>{t('common.dismiss')}</button>
                      </div>
                    )}
                  </div>


                  <div className="card">
                    <h3>{t('sticks.outer')} — {outerUnlimited ? t('sticks.noLimitTitle') : t('sticks.custom')}</h3>
                    <div className="hint">{t('sticks.outerHint')}</div>
                    <div className="row spread" style={{ margin: '10px 0' }}>
                      <div>
                        <div style={{ fontSize: 13.5 }}>{t('sticks.noLimitTitle')}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                          {outerUnlimited ? t('sticks.outerActive') : t('sticks.outerOff')}
                        </div>
                      </div>
                      <button
                        className={`btn sm${outerUnlimited ? ' primary' : ' ghost'}`}
                        onClick={() => {
                          if (outerUnlimited) {
                            edit(() => stick.setDeadzone(pkt, { ...stick.deadzone(pkt), end: 900, endAnti: 1000 }))
                          } else {
                            edit(() => stick.setDeadzone(pkt, { ...stick.deadzone(pkt), end: 1000, endAnti: 1000 }))
                          }
                        }}
                      >
                        {outerUnlimited ? t('sticks.infiniteOn') : t('sticks.setInfinite')}
                      </button>
                    </div>
                    <div className="note">
                      <strong>{t('sticks.outerWhatTitle')}</strong> {t('sticks.outerWhat')}
                    </div>
                    <div className="note" style={{ marginTop: 8 }}>
                      <strong>{t('sticks.outerSteamTitle')}</strong> {t('sticks.outerSteam')}
                    </div>
                    {!outerUnlimited && (
                      <div className="note warn" style={{ marginTop: 8 }}>
                        This stick currently carries a custom boundary: <span className="mono">{outerBuffer >= 0 ? `max at ${(100 - outerBuffer).toFixed(0)}% deflection` : `output tops at ${(100 + outerBuffer).toFixed(0)}%`}</span>.
                        Tap <strong>Set ∞</strong> to clear it back to the full range.
                      </div>
                    )}
                  </div>
                </div>
                <div className="stack" style={{ gap: 16 }}>
                  <div className="card">
                    <h3>{t('sticks.curve')} — {design.length} {t('sticks.points')}</h3>
                    <div className="hint">{t('sticks.curveHint')}</div>
                    <CurvePlot points={design.length >= 2 ? design : padCurve} onChange={(next) => setDesign(next)} overlay={quantized} smooth={spline} />
                    <div className="row" style={{ gap: 8, margin: '8px 0' }}>
                      <span className={curvePending ? 'pill warn' : 'pill good'}>{curvePending ? t('sticks.differs') : t('sticks.matches')}</span>
                      <div style={{ flex: 1 }} />
                      <button className={`btn sm${!spline ? ' primary' : ' ghost'}`} onClick={() => setSpline(false)}>{t('sticks.linear')}</button>
                      <button className={`btn sm${spline ? ' primary' : ' ghost'}`} onClick={() => setSpline(true)}>{t('sticks.spline')}</button>
                      <button className="btn sm primary" disabled={!curvePending} onClick={() => edit(() => { if (pkt) { stick.setCurve(pkt, quantized.map((p) => ({ ...p }))); stick.markCurveIdentity(pkt) } })}>{t('sticks.send')}</button>
                      <button className="btn sm ghost" onClick={reloadDesignFromPad}>{t('sticks.reload')}</button>
                    </div>
                    <div className="row wrap" style={{ gap: 8, margin: '8px 0' }}>
                      {Object.entries(AIM_CURVES).map(([key, c]) => (
                        <button
                          key={key}
                          className="btn sm ghost"
                          title={c.hint}
                          onClick={() => setDesign(c.pts.map((p) => ({ ...p })))}
                        >
                          {c.label}
                        </button>
                      ))}
                    </div>
                    <div className="row wrap" style={{ gap: 8, margin: '8px 0', alignItems: 'center' }}>
                      <button
                        className="btn sm"
                        title={t('sticks.saveTitle')}
                        onClick={() => {
                          const name = window.prompt('Name this curve:')
                          if (!name || !name.trim()) return
                          const clean = name.trim().slice(0, 24)
                          setPresets((prev) => {
                            const next = prev.filter((p) => p.name !== clean)
                            next.unshift({ name: clean, pts: design.map((p) => ({ ...p })) })
                            return next.slice(0, 20)
                          })
                        }}
                      >
                        {t('sticks.saveCurrent')}
                      </button>
                      {presets.map((p) => (
                        <span key={p.name} className="row" style={{ gap: 4, alignItems: 'center' }}>
                          <button
                            className="btn sm ghost"
                            title={`Apply ${p.name}`}
                            onClick={() => setDesign(p.pts.map((q) => ({ ...q })))}
                          >
                            {p.name}
                          </button>
                          <button
                            className="btn sm ghost"
                            title={`Delete ${p.name}`}
                            onClick={() => setPresets((prev) => prev.filter((q) => q.name !== p.name))}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="row wrap" style={{ gap: 8 }}>
                      <button
                        className="btn sm"
                        disabled={design.length >= DESIGN_MAX_POINTS}
                        onClick={() => setDesign((d) => addDesignPoint(d.length >= 2 ? d : padCurve))}
                      >
                        {t('sticks.addPoint')} ({design.length}/{DESIGN_MAX_POINTS})
                      </button>
                      <button
                        className="btn sm ghost"
                        title={t('sticks.copyCurve')}
                        onClick={() => {
                          if (!profile || !pkt) return
                          const other = profile.sticks[which === 0 ? 1 : 0]
                          edit(() => { stick.setCurve(other, stick.curve(pkt).map((p) => ({ ...p }))); stick.markCurveIdentity(other) })
                        }}
                      >
                        {t('sticks.copyCurve')}
                      </button>
                      <button
                        className="btn sm ghost"
                        onClick={() => setDesign(LINEAR_CURVE.map((p) => ({ ...p })))}
                      >
                        {t('sticks.resetCurve')}
                      </button>
                    </div>
                    <table className="tbl" style={{ marginTop: 8 }}>
                      <thead><tr><th>#</th><th>X</th><th>Y</th><th /></tr></thead>
                      <tbody>
                        {design.map((p, i) => (
                          <tr key={i}>
                            <td className="mono">{i + 1}</td>
                            <td><input className="input" type="number" min={0} max={255} value={p.x} onChange={(e) => { const next = design.map((q) => ({ ...q })); next[i].x = Math.max(0, Math.min(255, Number(e.target.value))); setDesign(next) }} /></td>
                            <td><input className="input" type="number" min={0} max={255} value={p.y} onChange={(e) => { const next = design.map((q) => ({ ...q })); next[i].y = Math.max(0, Math.min(255, Number(e.target.value))); setDesign(next) }} /></td>
                            <td>
                              <button className="btn sm ghost" disabled={design.length <= DESIGN_MIN_POINTS} title={t('sticks.removePoint')} onClick={() => setDesign((d) => d.filter((_, j) => j !== i))}>−</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="note" style={{ marginTop: 8 }}>
                      {t('sticks.hwPreview')} <span className="mono">{quantized.map((q) => `${q.x}/${q.y}`).join(' · ')}</span>
                    </div>
                  </div>


                  <div className="card">
                    <h3>{t('sticks.shape')}</h3>
                    <div className="hint">{t('sticks.shapeHint')}</div>
                    <div className="stack" style={{ gap: 8 }}>
                      {(
                        [
                          { key: 'round', hintKey: 'sticks.shapeHintRound' },
                          { key: 'square', hintKey: 'sticks.shapeHintSquare' },
                          { key: 'raw', hintKey: 'sticks.shapeHintRaw' }
                        ] as const
                      ).map((s) => {
                        const isRaw = stick.isRawState(pkt)
                        const isSquare = stick.enabled(pkt) && stick.squareGate(pkt) && !isRaw
                        const isRound = stick.enabled(pkt) && !stick.squareGate(pkt) && !isRaw
                        const active = (s.key === 'round' && isRound) || (s.key === 'square' && isSquare) || (s.key === 'raw' && isRaw)
                        const label = s.key === 'round' ? t('sticks.shapeRound') : s.key === 'square' ? t('sticks.shapeSquare') : t('sticks.shapeRaw')
                        return (
                          <button
                            key={s.key}
                            className={`btn sm${active ? ' primary' : ' ghost'}`}
                            title={t(s.hintKey)}
                            onClick={() => {
                              edit(() => {
                                if (s.key === 'raw') {
                                  stick.applyPhysics(pkt)
                                  stick.setEnabled(pkt, true)
                                  stick.setSquareGate(pkt, false)
                                } else {
                                  const wasRaw = stick.isRawState(pkt)
                                  stick.setEnabled(pkt, true)
                                  stick.setSquareGate(pkt, s.key === 'square')
                                  if (wasRaw) stick.setDeadzone(pkt, { ...stick.deadzone(pkt), begin: 50 })
                                }
                              })
                            }}
                          >
                            {label}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                </div>
              </div>
              )}
              {tab === 'device' && (
              <div className="two" style={{ alignItems: 'start' }}>
                <div className="stack" style={{ gap: 16 }}>
                  <div className="card">
                    <h3>{t('device.polling')} - {rates.map((o) => (o.hz >= 1000 ? `${o.hz / 1000}K` : `${o.hz}`)).join(' / ')}</h3>
                    <div className="hint">Report-rate gear (Fun_Data +14){model ? ` · ${model.marketingName} offers ${rates.length} gears` : ''}. Hz labels are the vendor's claim; measured input stays ~250–500/s.</div>
                    <div className="row wrap" style={{ gap: 8, margin: '10px 0' }}>
                      {rates.filter((o) => o.hz >= 1000).map((o) => (
                        <button
                          key={o.gear}
                          className={`btn sm${fun.extend.reportRateGear(fd) === o.gear ? ' primary' : ' ghost'}`}
                          title={o.confirmed ? `gear ${o.gear}` : `gear ${o.gear} (inferred — no vendor label)`}
                          onClick={() => edit(() => fun.extend.setReportRateGear(fd, o.gear))}
                        >
                          {o.hz >= 1000 ? `${o.hz / 1000}K` : `${o.hz} Hz`}{o.confirmed ? '' : '*'}
                        </button>
                      ))}
                    </div>
                    <div className="row spread">
                      <span className="label">{t('device.gear')}: {fun.extend.reportRateGear(fd)}</span>
                      <span className="mono">*2K inferred — completes the 250/500/1000/…/4000/8000 ladder</span>
                    </div>
                    <div className="row wrap" style={{ gap: 8, marginTop: 8 }}>
                      {rates.filter((o) => o.hz < 1000).map((o) => (
                        <button
                          key={o.gear}
                          className={`btn sm${fun.extend.reportRateGear(fd) === o.gear ? ' primary' : ' ghost'}`}
                          title={`gear ${o.gear}`}
                          onClick={() => edit(() => fun.extend.setReportRateGear(fd, o.gear))}
                        >
                          {o.hz} Hz
                        </button>
                      ))}
                    </div>
                  </div>


                  <div className="card">
                    <h3>{t('device.bits')} - 8-24</h3>
                    <div className="hint">{t('device.bitHint')}</div>
                    <div className="row wrap" style={{ gap: 8, margin: '10px 0' }}>
                      {STICK_RESOLUTION_OPTIONS.map((o) => (
                        <button
                          key={o.bits}
                          className={`btn sm${resBits === o.bits ? ' primary' : ' ghost'}`}
                          onClick={() => edit(() => fun.extend.setStickResolutionBits(fd, o.bits))}
                        >
                          {o.bits}-bit
                        </button>
                      ))}
                      {EXTENDED_BITS.map((bits) => (
                        <button
                          key={bits}
                          className={`btn sm${resWire === bitsToWireRaw(bits) ? ' primary' : ' ghost'}`}
                          title={t('device.beyondSilicon')}
                          onClick={() => edit(() => fun.extend.setStickResolution(fd, bitsToWireRaw(bits)))}
                        >
                          {bits}-bit*
                        </button>
                      ))}
                    </div>
                    <div className="note" style={{ marginTop: 8 }}>
                      {t('device.bitNote')}
                    </div>
                    {!resInfo.standard && (
                      <div className="note bad" style={{ marginTop: 8 }}>
                        {t('device.nonStdFull').replace('{wire}', String(resInfo.wire)).replace('{bits}', String(resInfo.bits))}
                      </div>
                    )}
                  </div>


                </div>
                <div className="stack" style={{ gap: 16 }}>
                  <div className="card">
                    <h3>{t('device.rate')}</h3>
                    <div className="hint">{t('device.rateHint')}</div>
                    <div className="stack" style={{ gap: 12 }}>
                      <div className="row spread">
                        <div>
                          <div style={{ fontSize: 13.5 }}>{t('device.rateConst')}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                            {t('device.rateApplies')}
                          </div>
                        </div>
                        <span className="mono">{t('device.stored')}: {stick.mouseDpi(pkt)}</span>
                      </div>
                      <div className="row wrap" style={{ gap: 8 }}>
                        {[{ rate: null as number | null }, ...[100, 150, 200, 250, 300].map((rate) => ({ rate: rate as number | null }))].map((opt) => {
                          const label = opt.rate === null ? t('device.none') : `${opt.rate}${opt.rate > 255 ? '*' : ''}`
                          const wire = opt.rate === null ? 50 : Math.min(opt.rate, 255)
                          const active = stick.mouseDpi(pkt) === wire
                          return (
                            <button
                              key={label}
                              className={`btn sm${active ? ' primary' : ' ghost'}`}
                              title={opt.rate === null ? t('device.stock50') : opt.rate > 255 ? `Firmware byte caps at 255 — stores ${wire}` : `Stores ${wire}`}
                              onClick={() => edit(() => stick.setMouseDpi(pkt, wire))}
                            >
                              {label}
                            </button>
                          )
                        })}
                        {stick.mapIndex(pkt) === 4 && (
                          <button
                            className="btn sm ghost"
                            title={t('device.restoreStick')}
                            onClick={() => edit(() => { stick.setMapIndex(pkt, which === 0 ? 1 : 2); stick.setMapped(pkt, true) })}
                          >
                            {which === 0 ? t('device.backLeft') : t('device.backRight')}
                          </button>
                        )}
                      </div>
                      <div className="note">{t('device.rateNote')}</div>
                    </div>
                  </div>

                </div>
              </div>
              )}
            </>
          )}
          {tab === 'profiles' && (
            <ProfilesPanel connected={connected} activeSlot={info?.currentProfile ?? null} locked={locked} modelId={modelId} modelLen={modelLen} dumpLength={model?.dumpLength ?? 0} modelName={model?.marketingName ?? null} />
          )}
          {tab === 'calibrate' && (
            connected && model?.support === 'full' ? (
              <CalibrationPanel />
            ) : (
              <div className="msg"><h3>{t('cal.connectTitle')}</h3><p>{t('cal.connectBody')}</p></div>
            )
          )}
          {tab === 'xinput' && <XinputPanel />}
          {tab === 'marius' && (
            <MariusPanel />
          )}
          {tab === 'language' && (
            <LanguagePanel />
          )}
          {tab === 'lab' && (
          <>
          <AnalyticsPanel
            context={
              profile && fd
                ? 'Now editing P' + slot + ': set ' + gearHz.toLocaleString() + ' Hz (gear ' + gear + ') · ' + resBits + '-bit (' + bitsToLevels(resBits).toLocaleString() + ' levels) — green chart is measured input, not the set rate.'
                : 'Connect and load a slot — then switch gear, write, and watch this chart.'
            }
          />
          <ResetEverythingCard profile={profile} fd={fd} edit={edit} onReload={reloadDesignFromPad} notify={setMsg} />
          </>
          )}
        </div>
      </main>
    </div>
    </LangContext.Provider>
  )
}

function LanguagePanel(): JSX.Element {
  const { lang, setLang } = useContext(LangContext)
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3>{tr(lang, 'lang.title')}</h3>
      <div className="hint">{tr(lang, 'lang.hint')}</div>
      <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
        {LANGS.map((o) => (
          <button
            key={o.id}
            className={`btn sm${lang === o.id ? ' primary' : ' ghost'}`}
            onClick={() => setLang(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}
