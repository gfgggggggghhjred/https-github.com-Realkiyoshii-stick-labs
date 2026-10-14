export interface XinputSource {
  slot: number
  buttons: number
  lt: number
  rt: number
  lx: number
  ly: number
  rx: number
  ry: number
}
export interface ForwardingStatus {
  supported: boolean
  running: boolean
  prepared?: boolean
  sourceSlot: number | null
  outputSlot: number | null
  error: string | null
}
