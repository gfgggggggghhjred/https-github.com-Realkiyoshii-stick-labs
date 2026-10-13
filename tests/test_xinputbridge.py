import importlib.util
from pathlib import Path
import time
import unittest

spec = importlib.util.spec_from_file_location('xinputbridge', Path(__file__).resolve().parents[1] / 'scripts' / 'xinputbridge.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
DEFAULT = dict(inner=0, outer=100, exponent=1, invertX=False, invertY=False)

class Target:
    def __init__(self, slot=1):
        self.slot = slot
        self.closed = False
        self.writes = []
    def user_index(self):
        return self.slot
    def write(self, *report):
        self.writes.append(report)
    def close(self):
        self.closed = True

class Tests(unittest.TestCase):
    def test_calibration_and_validation(self):
        calibrated = dict(DEFAULT, centerX=.1, centerY=-.05, rangeX=.8, rangeY=.9)
        x, y = m.transform_stick(3277, 1638, calibrated)
        self.assertAlmostEqual(x, 0, delta=2)
        self.assertAlmostEqual(y, 0, delta=2)
        for key, value in [('variation', 6), ('rightVariation', 6), ('centerX', float('nan')), ('rangeX', 0), ('variationSpeed', True)]:
            with self.assertRaises(ValueError): m.validate_settings(dict(DEFAULT, **{key: value}))

    def test_variation_neutral_bounds_and_time(self):
        noise = m.AnalogVariation()
        settings = dict(DEFAULT, variation=5, variationSpeed=2)
        self.assertEqual(noise.apply(0, 0, settings, 0), (0, 0))
        first = noise.apply(32767, 0, settings, 1)
        second = noise.apply(32767, 0, settings, 1.25)
        self.assertNotEqual(first, second)
        self.assertEqual(second, noise.apply(32767, 0, settings, 1.25))
        self.assertLessEqual(sum(v*v for v in second), 32768**2)
        self.assertEqual(noise.apply(0, 0, settings, 2), (0, 0))
        self.assertEqual(noise.apply(-32768, 0, DEFAULT, 3), (-32768, 0))

    def test_always_on_jitter_at_rest_and_disabled(self):
        noise = m.AnalogVariation()
        settings = dict(DEFAULT, variation=2)
        noise.apply(0, 0, settings, now=1, always=True)
        noise.previous = noise.target = (1., -.5)
        self.assertEqual(noise.apply(0, 0, settings, now=1.25, always=True), (655, -328))
        self.assertEqual(noise.apply(0, 0, settings, now=1.25), (0, 0))
        self.assertEqual(noise.apply(0, 0, DEFAULT, now=2, always=True), (0, 0))
        for mode in ('leftJitterAlways', 'rightJitterAlways'):
            with self.assertRaises(ValueError): m.validate_settings(dict(DEFAULT, **{mode: 1}))

    def test_right_jitter_is_independent_and_releases(self):
        state = m.Gamepad(lx=16384, rx=16384)
        target = Target()
        bridge = m.Bridge(lambda slot: state if slot == 0 else None, lambda: target)
        bridge.start(0, dict(DEFAULT, rightVariation=5))
        bridge.tick()
        bridge.right_variation.previous = (1., 1.)
        bridge.right_variation.target = (1., 1.)
        bridge.right_variation.started = time.monotonic()
        bridge.tick()
        self.assertEqual(target.writes[-1][3:5], (16384, 0))
        self.assertNotEqual(target.writes[-1][5:7], (16384, 0))
        state.rx = 0
        bridge.tick()
        self.assertEqual(target.writes[-1][5:7], (0, 0))
        self.assertIsNone(bridge.right_variation.started)

    def test_left_only_calibration_and_variation(self):
        state = m.Gamepad(lx=16384, ly=0, rx=16384, ry=0)
        target = Target()
        bridge = m.Bridge(lambda slot: state if slot == 0 else None, lambda: target)
        bridge.start(0, dict(DEFAULT, centerX=.1, rangeX=.8, variation=1))
        bridge.tick()
        self.assertAlmostEqual(target.writes[-1][5], 16384, delta=1)
        self.assertNotEqual(target.writes[-1][3], target.writes[-1][5])

    def test_axis_endpoints_and_y_convention(self):
        self.assertEqual(m.transform_stick(-32768, 0, DEFAULT), (-32768, 0))
        self.assertEqual(m.transform_stick(32767, 0, DEFAULT), (32767, 0))
        self.assertEqual(m.transform_stick(0, 32767, DEFAULT), (0, 32767))
        self.assertEqual(m.transform_stick(0, -32768, dict(DEFAULT, invertY=True)), (0, 32767))
    def test_shape_and_deadzone(self):
        self.assertEqual(m.transform_stick(1000, -1000, dict(DEFAULT, inner=10)), (0, 0))
        x, y = m.transform_stick(16384, 0, dict(DEFAULT, inner=10, outer=90, exponent=2))
        self.assertAlmostEqual(x, 8193, delta=1)
        self.assertEqual(y, 0)
    def test_validation(self):
        for settings in (dict(DEFAULT, outer=0), dict(DEFAULT, exponent=float('nan')), dict(DEFAULT, invertX=1), dict(DEFAULT, inner=True)):
            with self.assertRaises(ValueError): m.validate_settings(settings)
    def test_passthrough_disconnect_and_no_reconnect(self):
        state = m.Gamepad(buttons=0x1001, lt=45, rt=255, lx=32767, ly=0, rx=0, ry=-32768)
        devices = {0: state}
        target = Target()
        bridge = m.Bridge(devices.get, lambda: target)
        bridge.start(0, DEFAULT)
        bridge.tick()
        self.assertEqual(target.writes[-1], (0x1001, 45, 255, 32767, 0, 0, -32768))
        self.assertEqual(bridge.status()['outputSlot'], 1)
        devices.clear(); bridge.tick()
        self.assertTrue(target.closed)
        self.assertFalse(bridge.status()['running'])
        devices[0] = state; bridge.tick()
        self.assertEqual(len(target.writes), 1)
    def test_refuse_virtual_feedback(self):
        target = Target(0)
        bridge = m.Bridge(lambda slot: m.Gamepad() if slot == 0 else None, lambda: target)
        with self.assertRaises(ValueError): bridge.start(0, DEFAULT)
        self.assertTrue(target.closed)
        self.assertFalse(bridge.status()['running'])
    def test_full_xinput_slots(self):
        bridge = m.Bridge(lambda slot: m.Gamepad(), lambda: self.fail('Must not allocate virtual target'))
        with self.assertRaises(ValueError): bridge.start(0, DEFAULT)
    def test_watchdog_releases_and_source_not_auto_selected(self):
        target = Target()
        bridge = m.Bridge(lambda slot: m.Gamepad() if slot == 0 else None, lambda: target)
        with self.assertRaises(ValueError): bridge.start(2, DEFAULT)
        bridge.start(0, DEFAULT)
        bridge.last_heartbeat = time.monotonic() - 6
        bridge.tick()
        self.assertTrue(target.closed)
        self.assertIn('timed out', bridge.error)
    def test_explicit_stop(self):
        target = Target()
        bridge = m.Bridge(lambda slot: m.Gamepad() if slot == 0 else None, lambda: target)
        bridge.start(0, DEFAULT); bridge.stop(); bridge.stop()
        self.assertTrue(target.closed)
        self.assertEqual(bridge.status()['sourceSlot'], None)
    def test_windows_target_neutral_before_removal(self):
        events = []
        class Pad:
            def reset(self): events.append('neutral')
            def update(self): events.append('publish')
            def __del__(self): events.append('remove')
        target = m.WindowsTarget.__new__(m.WindowsTarget)
        target.pad = Pad()
        target.close()
        self.assertEqual(events, ['neutral', 'publish', 'remove'])
        target.close()
        self.assertEqual(len(events), 3)

    def test_virtual_slot_not_listed_as_source(self):
        devices = {0: m.Gamepad()}
        target = Target()
        bridge = m.Bridge(devices.get, lambda: target)
        bridge.start(0, DEFAULT); devices[1] = m.Gamepad()
        self.assertEqual([s['slot'] for s in bridge.sources()], [0])

if __name__ == '__main__': unittest.main()
