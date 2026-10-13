export interface WindowsSetupStatus {
  supported: boolean
  bundled: boolean
  vigemInstalled: boolean
  hidHideInstalled: boolean
}
export type WindowsDriver = 'vigem' | 'hidhide'
