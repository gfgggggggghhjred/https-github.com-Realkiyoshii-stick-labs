import importlib.util
from pathlib import Path
import time
import unittest
from unittest.mock import patch

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

    def test_fast_jitter_validation(self):
        for rate in (.2, 16, 32, 60):
            self.assertEqual(m.validate_settings(dict(DEFAULT, variationSpeed=rate))['variationSpeed'], rate)
        for rate in (0, 60.1, float('inf'), True):
            with self.assertRaises(ValueError): m.validate_settings(dict(DEFAULT, variationSpeed=rate))

    def test_slow_jitter_completes_long_intervals(self):
        noise = m.AnalogVariation()
        settings = dict(DEFAULT, variation=1, variationSpeed=.2)
        with patch.object(m.random, 'uniform', return_value=1.):
            for i in range(11):
                noise.apply(16000, 0, settings, now=i * .5)
        self.assertEqual(noise.value, (1., 1.))
        self.assertEqual(noise.started, 5.)

    def test_jitter_matches_across_different_sampling_schedules(self):
        settings = dict(DEFAULT, variation=1, variationSpeed=32)
        def sample(times):
            noise = m.AnalogVariation()
            with patch.object(m.random, 'uniform', side_effect=[.2, -.3, -.8, .4, .5, -.6, .1, .3]):
                for t in times:
                    result = noise.apply(16000, 0, settings, now=t)
                return result
        self.assertEqual(sample([0, .013, .036, .07, .1]), sample([i / 1000 for i in range(0, 101, 4)]))

    def test_fast_jitter_retains_fractional_time(self):
        noise = m.AnalogVariation()
        settings = dict(DEFAULT, variation=1, variationSpeed=40)
        with patch.object(m.random, 'uniform', side_effect=[1., 1., -1., -1.]):
            noise.apply(16000, 0, settings, now=0)
            noise.apply(16000, 0, settings, now=.029)
        self.assertAlmostEqual(noise.started, .025)
        self.assertLess(noise.value[0], 1.)
        self.assertGreater(noise.value[0], .8)

    def test_jitter_speed_changes_speed_without_changing_size_or_base(self):
        settings = dict(DEFAULT, variation=1)
        def offset(rate, now):
            noise = m.AnalogVariation()
            with patch.object(m.random, 'uniform', return_value=1.):
                noise.apply(16000, 0, dict(settings, variationSpeed=rate), now=0)
                return noise.apply(16000, 0, dict(settings, variationSpeed=rate), now=now)
        self.assertNotEqual(offset(1, .01), offset(32, .01))
        self.assertEqual(offset(1, .5), offset(32, .015625))
        noise = m.AnalogVariation()
        with patch.object(m.random, 'uniform', return_value=1.):
            noise.apply(16000, 0, settings, now=0)
            before = noise.apply(16000, 0, settings, now=.5)
            self.assertEqual(before, noise.apply(16000, 0, dict(settings, variationSpeed=60), now=.5))
        self.assertEqual(noise.apply(0, 0, dict(settings, variationSpeed=60), now=.6), (0, 0))
        self.assertEqual(noise.apply(-32768, 0, dict(DEFAULT, variationSpeed=60), now=.7), (-32768, 0))

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

class SlotResolutionTests(unittest.TestCase):
    class Reader:
        def __init__(self):
            self.devices = {0: m.Gamepad(), 1: m.Gamepad()}
            self.ids = {0: (0x046d, 0xc53b), 1: (0x045e, 0x028e)}
        def __call__(self, slot): return self.devices.get(slot)
        def identity(self, slot): return self.ids.get(slot)
    class Virtual(Target):
        def identity(self): return 0x045e, 0x028e
    def test_cached_led_conflict_uses_new_native_slot_with_distinct_verified_identity(self):
        reader = self.Reader()
        slot, source_id = m.resolve_output_slot(reader, self.Virtual(0), 0, {0}, attempts=3, pause=lambda _: None)
        self.assertEqual(slot, 1)
        self.assertEqual(source_id, (0x046d, 0xc53b))
    def test_delayed_index_can_stabilize_without_bypassing_guard(self):
        indices = iter([0, 1, 1])
        target = self.Virtual()
        target.user_index = lambda: next(indices)
        slot, _ = m.resolve_output_slot(lambda i: m.Gamepad() if i == 0 else None, target, 0, {0}, attempts=4, pause=lambda _: None)
        self.assertEqual(slot, 1)
    def test_same_identity_and_conflicting_led_index_still_refused(self):
        reader = self.Reader(); reader.ids[0] = reader.ids[1]
        with self.assertRaises(ValueError): m.resolve_output_slot(reader, self.Virtual(0), 0, {0}, attempts=3, pause=lambda _: None)
    def test_ambiguous_multiple_new_slots_refused(self):
        reader = self.Reader(); reader.devices[2] = m.Gamepad(); reader.ids[2] = (0x045e, 0x028e)
        with self.assertRaises(ValueError): m.resolve_output_slot(reader, self.Virtual(0), 0, {0}, attempts=3, pause=lambda _: None)
    def test_source_remap_stops_forwarding(self):
        reader = self.Reader(); target = self.Virtual(2)
        reader.devices.pop(1); reader.ids.pop(1)
        def factory():
            reader.devices[2] = m.Gamepad(); reader.ids[2] = (0x045e, 0x028e)
            return target
        bridge = m.Bridge(reader, factory)
        bridge.start(0, DEFAULT)
        reader.ids[0] = (0x045e, 0x028e)
        bridge.tick()
        self.assertTrue(target.closed)
        self.assertIn('identity changed', bridge.error)
    def test_free_led_slot_with_wrong_hardware_identity_refused(self):
        reader = self.Reader(); reader.ids[1] = (0x1234, 0x5678)
        with self.assertRaises(ValueError):
            m.resolve_output_slot(reader, self.Virtual(1), 0, {0}, attempts=3, pause=lambda _: None)
    def test_identity_changed_during_creation_refused(self):
        reader = self.Reader()
        with self.assertRaises(ValueError):
            m.resolve_output_slot(reader, self.Virtual(1), 0, {0}, attempts=3, pause=lambda _: None, expected_source_identity=(0x1111, 0x2222))
    def test_native_layouts_match_xinput(self):
        self.assertEqual(m.ctypes.sizeof(m.Gamepad), 12)
        self.assertEqual(m.ctypes.sizeof(m.Capabilities), 20)
        self.assertEqual(m.ctypes.sizeof(m.CapabilitiesEx), 32)


class PlayerOneTests(unittest.TestCase):
    class Reader:
        def __init__(self):
            self.devices = {}
            self.ids = {}
        def __call__(self, slot): return self.devices.get(slot)
        def identity(self, slot): return self.ids.get(slot)

    def build(self, output=0):
        reader = self.Reader()
        class Virtual(Target):
            def identity(self): return (0x045e, 0x028e)
            def close(self):
                super().close()
                reader.devices.pop(output, None)
                reader.ids.pop(output, None)
        target = Virtual(output)
        def factory():
            reader.devices[output] = m.Gamepad()
            reader.ids[output] = target.identity()
            return target
        return m.Bridge(reader, factory), reader, target

    def test_prepare_then_reconnect_source_uses_same_virtual_player_one(self):
        bridge, reader, target = self.build()
        bridge.prepare_player_one(attempts=2, pause=lambda _: None)
        self.assertTrue(bridge.status()['prepared'])
        self.assertFalse(bridge.status()['running'])
        self.assertEqual(bridge.status()['outputSlot'], 0)
        self.assertEqual(bridge.sources(), [])
        bridge.tick()
        self.assertEqual(target.writes, [(0, 0, 0, 0, 0, 0, 0)])
        reader.devices[1] = m.Gamepad(lx=12345, buttons=1)
        reader.ids[1] = (0x046d, 0xc53b)
        bridge.start(1, DEFAULT)
        bridge.tick()
        self.assertTrue(bridge.status()['running'])
        self.assertFalse(bridge.status()['prepared'])
        self.assertEqual(bridge.output_slot, 0)
        self.assertEqual(target.writes[-1], (1, 0, 0, 12345, 0, 0, 0))
        reader.devices.pop(1)
        bridge.tick()
        self.assertTrue(target.closed)

    def test_refuses_occupied_slots_without_creating_output(self):
        bridge, reader, target = self.build()
        reader.devices[2] = m.Gamepad()
        with self.assertRaisesRegex(ValueError, 'Disconnect MATRIX'):
            bridge.prepare_player_one(attempts=2, pause=lambda _: None)
        self.assertEqual(list(reader.devices), [2])
        self.assertFalse(bridge.status()['prepared'])

    def test_wrong_output_slot_is_removed(self):
        bridge, reader, target = self.build(output=1)
        with self.assertRaisesRegex(ValueError, 'did not assign'):
            bridge.prepare_player_one(attempts=2, pause=lambda _: None)
        self.assertTrue(target.closed)
        self.assertEqual(reader.devices, {})

    def test_ambiguous_source_cannot_read_reserved_output(self):
        bridge, reader, target = self.build()
        bridge.prepare_player_one(attempts=2, pause=lambda _: None)
        with self.assertRaises(ValueError): bridge.start(0, DEFAULT)
        reader.devices[1] = m.Gamepad()
        reader.ids[1] = target.identity()
        with self.assertRaisesRegex(ValueError, 'Cannot distinguish'):
            bridge.start(1, DEFAULT)
        self.assertFalse(bridge.status()['running'])
        self.assertTrue(bridge.status()['prepared'])
        bridge.stop()
        self.assertTrue(target.closed)

    def test_reservation_releases_on_timeout_or_identity_change(self):
        for cause in ('timeout', 'identity'):
            bridge, reader, target = self.build()
            bridge.prepare_player_one(attempts=2, pause=lambda _: None)
            if cause == 'timeout': bridge.last_heartbeat = time.monotonic() - 6
            else: reader.ids[0] = (0x046d, 0xc53b)
            bridge.tick()
            self.assertTrue(target.closed)
            self.assertFalse(bridge.status()['prepared'])

if __name__ == '__main__': unittest.main()
