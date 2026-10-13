import assert from 'node:assert/strict'
import { hidHideToolCandidates, runSetupTool } from '../src/main/windowsTools'
for (const tool of ['HidHideCLI', 'HidHideClient'] as const) {
  const paths = hidHideToolCandidates(['C:\\Program Files'], tool)
  assert.ok(paths.includes(`C:\\Program Files\\Nefarius Software Solutions\\HidHide\\x64\\${tool}.exe`), 'Bundled 1.5.230.0 layout')
  assert.ok(paths.includes(`C:\\Program Files\\Nefarius Software Solutions\\HidHide\\${tool}.exe`), 'Current official layout')
  assert.ok(paths.includes(`C:\\Program Files\\Nefarius Software Solutions e.U.\\${tool}\\${tool}.exe`), 'Legacy layout')
}
const options = { timeout: 3000, maxBuffer: 1024, windowsHide: true }
const result = await runSetupTool(process.execPath, ['-e', "process.stdin.resume(); process.stdin.on('end', () => process.stdout.write('EOF received'))"], options)
assert.equal(result.stdout, 'EOF received', 'A CLI waiting for piped input must receive EOF')
await assert.rejects(runSetupTool(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { ...options, timeout: 100 }), /timed out/)
console.log('HidHide tool paths, subprocess EOF, and timeout reporting passed.')
