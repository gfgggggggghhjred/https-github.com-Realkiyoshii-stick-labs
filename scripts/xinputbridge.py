"""Windows XInput -> virtual Xbox 360 bridge. JSON-lines control; no MATRIX writes."""
import ctypes
import json
import math
import os
import queue
import random
import sys
import threading
import time


def validate_settings(s):
    if not isinstance(s, dict):
        raise ValueError('Invalid adjustment settings')
    for key in ('inner', 'outer', 'exponent'):
        if isinstance(s.get(key), bool) or not isinstance(s.get(key), (int, float)) or not math.isfinite(s[key]):
            raise ValueError('Invalid numeric setting: ' + key)
    if not (0 <= s['inner'] <= 50 and s['inner'] < s['outer'] <= 100 and .2 <= s['exponent'] <= 5):
        raise ValueError('Adjustment settings out of range')
    if type(s.get('invertX')) is not bool or type(s.get('invertY')) is not bool:
        raise ValueError('Invalid inversion setting')
    for key, low, high in [('centerX', -.25, .25), ('centerY', -.25, .25), ('rangeX', .25, 1.5), ('rangeY', .25, 1.5), ('variation', 0, 5), ('rightVariation', 0, 5), ('variationSpeed', .2, 10)]:
        value = s.get(key, 1 if key in ('rangeX', 'rangeY', 'variationSpeed') else 0)
        if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high:
            raise ValueError('Invalid setting: ' + key)
    for key in ('leftJitterAlways', 'rightJitterAlways'):
        if key in s and type(s[key]) is not bool:
            raise ValueError('Invalid jitter mode: ' + key)
    return dict(s)


def transform_stick(x, y, s):
    # XInput Y is up-positive; the UI's standard Gamepad Y is down-positive.
    x = x / (32768 if x < 0 else 32767)
    y = -y / (32768 if y < 0 else 32767)
    x = max(-1, min(1, (x - s.get('centerX', 0)) / s.get('rangeX', 1)))
    y = max(-1, min(1, (y - s.get('centerY', 0)) / s.get('rangeY', 1)))
    length = math.hypot(x, y)
    if length <= s['inner'] / 100 or length == 0:
        return 0, 0
    magnitude = min(1, (length - s['inner'] / 100) / ((s['outer'] - s['inner']) / 100)) ** s['exponent']
    x = x / length * magnitude * (-1 if s['invertX'] else 1)
    y = -y / length * magnitude * (-1 if s['invertY'] else 1)
    def axis(v):
        return max(-32768, min(32767, round(v * (32768 if v < 0 else 32767))))
    return axis(x), axis(y)


class AnalogVariation:
    """Time-based smooth noise, left stick only; exact neutral stays neutral."""
    def __init__(self):
        self.reset()

    def reset(self):
        self.previous = (0., 0.)
        self.target = (0., 0.)
        self.started = None

    def apply(self, x, y, settings, now=None, always=False):
        amount = settings.get('variation', 0) / 100
        if not amount or (x == 0 and y == 0 and not always):
            self.reset()
            return x, y
        now = time.monotonic() if now is None else now
        duration = 1 / settings.get('variationSpeed', 1)
        if self.started is None or now - self.started >= duration:
            self.previous = self.target
            self.target = (random.uniform(-1, 1), random.uniform(-1, 1))
            self.started = now
        t = min(1, max(0, (now - self.started) / duration))
        t = t * t * (3 - 2 * t)
        noise = [a + (b - a) * t for a, b in zip(self.previous, self.target)]
        if x == 0 and y == 0:
            return round(noise[0] * amount * 32767), round(noise[1] * amount * 32767)
        angle = noise[0] * amount
        scale = max(0, 1 - amount * (noise[1] + 1) / 2)
        xx = (x * math.cos(angle) - y * math.sin(angle)) * scale
        yy = (x * math.sin(angle) + y * math.cos(angle)) * scale
        length = math.hypot(xx, yy)
        if length > 32767:
            xx, yy = xx / length * 32767, yy / length * 32767
        return max(-32768, min(32767, round(xx))), max(-32768, min(32767, round(yy)))


class Gamepad(ctypes.Structure):
    _fields_ = [('buttons', ctypes.c_uint16), ('lt', ctypes.c_uint8), ('rt', ctypes.c_uint8),
                ('lx', ctypes.c_int16), ('ly', ctypes.c_int16), ('rx', ctypes.c_int16), ('ry', ctypes.c_int16)]


class State(ctypes.Structure):
    _fields_ = [('packet', ctypes.c_uint32), ('pad', Gamepad)]


class Bridge:
    def __init__(self, reader, factory):
        self.variation = AnalogVariation()
        self.right_variation = AnalogVariation()
        self.reader = reader
        self.factory = factory
        self.target = None
        self.source = None
        self.output_slot = None
        self.settings = None
        self.error = None
        self.last_heartbeat = time.monotonic()

    def status(self):
        return {'running': self.target is not None, 'sourceSlot': self.source,
                'outputSlot': self.output_slot, 'error': self.error}

    def sources(self):
        return [{'slot': i, 'buttons': p.buttons, 'lt': p.lt, 'rt': p.rt,
                 'lx': p.lx, 'ly': p.ly, 'rx': p.rx, 'ry': p.ry}
                for i in range(4) if i != self.output_slot for p in [self.reader(i)] if p is not None]

    def start(self, source, settings):
        if self.target is not None:
            raise ValueError('Stop forwarding before changing the source')
        if type(source) is not int or source not in range(4):
            raise ValueError('Select an XInput slot from 0 to 3')
        validated = validate_settings(settings)
        occupied = {s['slot'] for s in self.sources()}
        if source not in occupied:
            raise ValueError('Selected source is disconnected')
        if len(occupied) == 4:
            raise ValueError('All four XInput slots are occupied; disconnect another controller')
        target = self.factory()
        try:
            slot = target.user_index()
            if slot not in range(4) or slot in occupied:
                raise ValueError('Virtual controller slot conflicts with a source; refusing feedback loop')
        except Exception:
            target.close()
            raise
        self.target, self.source, self.output_slot = target, source, slot
        self.variation.reset()
        self.right_variation.reset()
        self.settings = validated
        self.error = None
        self.last_heartbeat = time.monotonic()

    def stop(self):
        target = self.target
        self.target = self.source = self.output_slot = None
        if target:
            target.close()  # neutral report before removal

    def tick(self):
        if self.target is None:
            return
        try:
            if time.monotonic() - self.last_heartbeat > 5:
                raise RuntimeError('Control connection timed out; forwarding stopped')
            pad = self.reader(self.source)
            if pad is None:
                raise RuntimeError('Source disconnected; forwarding stopped. Re-select the source before restarting.')
            lx, ly = transform_stick(pad.lx, pad.ly, self.settings)
            lx, ly = self.variation.apply(lx, ly, self.settings, always=self.settings.get('leftJitterAlways', False))
            right_settings = {k: v for k, v in self.settings.items() if k not in ('centerX', 'centerY', 'rangeX', 'rangeY')}
            rx, ry = transform_stick(pad.rx, pad.ry, right_settings)
            rx, ry = self.right_variation.apply(rx, ry, {**self.settings, 'variation': self.settings.get('rightVariation', 0)}, always=self.settings.get('rightJitterAlways', False))
            self.target.write(pad.buttons, pad.lt, pad.rt, lx, ly, rx, ry)
        except Exception as exc:
            self.error = str(exc)
            self.stop()


class WindowsReader:
    def __init__(self):
        self.dll = ctypes.WinDLL('xinput1_4.dll')
        self.dll.XInputGetState.argtypes = [ctypes.c_uint32, ctypes.POINTER(State)]
        self.dll.XInputGetState.restype = ctypes.c_uint32

    def __call__(self, slot):
        state = State()
        result = self.dll.XInputGetState(slot, ctypes.byref(state))
        if result == 0:
            return state.pad
        if result == 1167:
            return None
        raise RuntimeError('XInputGetState failed: ' + str(result))


class WindowsTarget:
    def __init__(self):
        import vgamepad as vg
        from vgamepad.win import vigem_client as vc
        from vgamepad.win.virtual_gamepad import check_err
        self.pad = vg.VX360Gamepad()
        self.vc, self.check_err = vc, check_err

    def user_index(self):
        index = ctypes.c_uint32()
        self.check_err(self.vc.vigem_target_x360_get_user_index(self.pad._busp, self.pad._devicep, ctypes.byref(index)))
        return index.value

    def write(self, buttons, lt, rt, lx, ly, rx, ry):
        self.pad.report.wButtons = buttons
        self.pad.report.bLeftTrigger = lt
        self.pad.report.bRightTrigger = rt
        self.pad.report.sThumbLX, self.pad.report.sThumbLY = lx, ly
        self.pad.report.sThumbRX, self.pad.report.sThumbRY = rx, ry
        self.pad.update()

    def close(self):
        pad, self.pad = self.pad, None
        if pad:
            try:
                pad.reset()
                pad.update()
            finally:
                # vgamepad owns removal/free in its destructor.
                del pad


def emit(value):
    print(json.dumps(value), flush=True)


def main():
    if os.name != 'nt':
        emit({'ready': False, 'error': 'Virtual Xbox forwarding requires Windows 10/11.'})
        return 1
    try:
        bridge = Bridge(WindowsReader(), WindowsTarget)
    except Exception as exc:
        emit({'ready': False, 'error': str(exc)})
        return 1
    commands = queue.Queue()
    def stdin_worker():
        for line in sys.stdin:
            commands.put(line)
        commands.put(None)
    threading.Thread(target=stdin_worker, daemon=True).start()
    emit({'ready': True})
    try:
        while True:
            try:
                line = commands.get(timeout=.004)
                if line is None:
                    break
                message = {}
                try:
                    if len(line) > 65536:
                        raise ValueError('Command too large')
                    decoded = json.loads(line)
                    if not isinstance(decoded, dict):
                        raise ValueError('Command must be a JSON object')
                    message = decoded
                    cmd = message.get('command')
                    if cmd == 'start':
                        bridge.start(message.get('source'), message.get('settings'))
                    elif cmd == 'settings':
                        bridge.settings = validate_settings(message.get('settings'))
                    elif cmd == 'stop':
                        bridge.stop()
                    elif cmd not in ('sources', 'status', 'heartbeat'):
                        raise ValueError('Unknown command')
                    bridge.last_heartbeat = time.monotonic()
                    data = bridge.sources() if cmd == 'sources' else bridge.status()
                    emit({'id': message.get('id'), 'ok': True, 'data': data})
                except Exception as exc:
                    emit({'id': message.get('id'), 'ok': False, 'error': str(exc)})
            except queue.Empty:
                pass
            bridge.tick()
    finally:
        bridge.stop()
    return 0


def runtime_check():
    if os.name != 'nt':
        raise RuntimeError('Runtime check requires Windows')
    WindowsReader()
    from pathlib import Path
    if getattr(sys, 'frozen', False):
        base = Path(sys._MEIPASS) / 'vgamepad'
    else:
        import importlib.util
        base = Path(importlib.util.find_spec('vgamepad').origin).parent
    dll = base / 'win' / 'vigem' / 'client' / ('x64' if ctypes.sizeof(ctypes.c_void_p) == 8 else 'x86') / 'ViGEmClient.dll'
    library = ctypes.WinDLL(str(dll))
    getattr(library, 'vigem_target_x360_update')
    emit({'runtime': 'ready', 'xinput': True, 'vigemClient': True})


if __name__ == '__main__':
    if '--runtime-check' in sys.argv:
        runtime_check()
    else:
        sys.exit(main())
