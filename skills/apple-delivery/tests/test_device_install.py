import plistlib
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from test_apple_delivery import tf, fixture


def phone(identifier='phone', kind='iPhone', mode='enabled', transport='localNetwork'):
    return {'identifier': identifier, 'hardwareProperties': {'deviceType': kind},
            'connectionProperties': {'pairingState': 'paired', 'transportType': transport},
            'deviceProperties': {'developerModeStatus': mode}}


class DeviceInstallTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(); self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name); self.cfg = fixture(self.root)
        self.addCleanup(setattr, tf, 'ROOT', tf.ROOT); tf.ROOT = self.root
        self.app = self.root/'Test.app'; self.app.mkdir()
        (self.app/'Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier': self.cfg['bundle_id'],
            'CFBundleShortVersionString': '0.1.0', 'CFBundleVersion': '17'}))
        (self.app/'embedded.mobileprovision').touch()
        self.inventory = {'deviceIdentifier': 'phone', 'apps': [{'bundleIdentifier': self.cfg['bundle_id'],
            'version': '0.1.0', 'bundleVersion': '17'}]}

    def test_device_selection(self):
        self.assertEqual(tf.select_iphone([phone(), phone('watch','appleWatch')]), 'phone')
        for devices in [[], [phone(mode='disabled')], [phone(transport=None)], [phone(),phone('other')]]:
            with self.assertRaises(tf.ReleaseError): tf.select_iphone(devices)
        self.assertEqual(tf.select_iphone([phone(),phone('other')], 'other'), 'other')
        with self.assertRaises(tf.ReleaseError): tf.select_iphone([phone()], 'missing')

    def test_dry_run_never_uses_apple_credentials_or_builds(self):
        with patch.object(tf,'device_json',return_value={'devices':[phone()]}), \
             patch.object(tf,'development_signing_probe') as probe, \
             patch.object(tf,'key_path',side_effect=AssertionError('no ASC key')), \
             patch.object(tf,'run_logged',side_effect=AssertionError('no build/install')):
            self.assertEqual(tf.main(['--project',str(self.root),'install','--dry-run']),0)
            probe.assert_called_once()
        self.assertFalse((self.root/'runs').exists())

    def test_install_readback_and_launch_order(self):
        args=SimpleNamespace(device=None,app=self.app,dry_run=False,launch=True,allow_provisioning_updates=False)
        for inventory,good in [(self.inventory,True),({'deviceIdentifier':'other','apps':self.inventory['apps']},False),
                               ({'deviceIdentifier':'phone','apps':[]},False)]:
            with patch.object(tf,'device_json',side_effect=[{'devices':[phone()]},{'devices':[phone()]},inventory]), \
                 patch.object(tf.subprocess,'run'), patch.object(tf,'run_logged') as run:
                if good:
                    self.assertEqual(tf.direct_install(self.cfg,args),0)
                    self.assertEqual(run.call_count,2)
                    self.assertIn('install',run.call_args_list[0].args[0])
                    self.assertIn('launch',run.call_args_list[1].args[0])
                else:
                    with self.assertRaisesRegex(tf.ReleaseError,'readback'): tf.direct_install(self.cfg,args)
                    self.assertEqual(run.call_count,1)

    def test_mismatched_app_is_not_installed(self):
        args=SimpleNamespace(device=None,app=self.app,dry_run=False,launch=True,allow_provisioning_updates=False)
        (self.app/'Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier':'wrong'}))
        with patch.object(tf,'device_json',return_value={'devices':[phone()]}), patch.object(tf,'run_logged') as run:
            with self.assertRaisesRegex(tf.ReleaseError,'bundle ID'): tf.direct_install(self.cfg,args)
            run.assert_not_called()

    def test_signing_gate_prevents_build(self):
        args=SimpleNamespace(device=None,app=None,dry_run=False,launch=False,allow_provisioning_updates=False)
        with patch.object(tf,'device_json',return_value={'devices':[phone()]}), \
             patch.object(tf,'development_signing_probe',side_effect=tf.ReleaseError('Keychain blocked')), \
             patch.object(tf,'run_logged') as run:
            with self.assertRaisesRegex(tf.ReleaseError,'Keychain blocked'): tf.direct_install(self.cfg,args)
            run.assert_not_called()

    def test_build_signing_retry_is_bounded_and_uses_same_derived_data(self):
        args=SimpleNamespace(device=None,app=None,dry_run=False,launch=False,allow_provisioning_updates=False)
        def fail(command, outfile, **kwargs):
            outfile.write_text('errSecInternalComponent')
            raise tf.ReleaseError('signing failure')
        with patch.object(tf,'device_json',return_value={'devices':[phone()]}), \
             patch.object(tf,'development_signing_probe') as probe, patch.object(tf.subprocess,'run'), \
             patch.object(tf,'run_logged',side_effect=fail) as run:
            with self.assertRaisesRegex(tf.ReleaseError,'signing failure'): tf.direct_install(self.cfg,args)
            self.assertEqual(run.call_count,2)
            self.assertEqual(probe.call_count,2)
            self.assertEqual(run.call_args_list[0].args[0],run.call_args_list[1].args[0])
            self.assertIn('generic/platform=iOS',run.call_args_list[0].args[0])
            self.assertNotIn('-allowProvisioningUpdates',run.call_args_list[0].args[0])
