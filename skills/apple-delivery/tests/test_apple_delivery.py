"""Apple-delivery capability tests; no Apple uploads, credentials, or real repository modifications."""
import base64
import importlib.util
import json
import os
import plistlib
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'apple_delivery.py'
spec = importlib.util.spec_from_file_location('apple_delivery', SCRIPT)
tf = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tf)


class FakeApple:
    def __init__(self, cfg, state='VALID', attached=True, encryption=False):
        self.cfg=cfg
        self.state=state
        self.attached=attached
        self.encryption=encryption
        self.calls=[]
        self.build_data={'id':'B17','attributes':{'version':'17','processingState':self.state,
                         'uploadedDate':'2026-11-13','usesNonExemptEncryption':encryption}}

    def app(self):
        return {'attributes':{'bundleId':self.cfg['bundle_id'],'name':'Example'}}

    def builds(self):
        return [{'attributes':{'version':'14'}}]

    def build(self,number):
        return self.build_data if number=='17' else None

    def request(self,path,method='GET',payload=None):
        self.calls.append((path,method,payload))
        if path.endswith('buildBetaDetail'):
            return {'data':{'attributes':{'internalBuildState':'IN_BETA_TESTING'}}}
        if path=='/v1/builds/B17' and method=='PATCH':
            self.encryption=payload['data']['attributes']['usesNonExemptEncryption']
            self.build_data['attributes']['usesNonExemptEncryption']=self.encryption
            return self.build_data
        if path=='/v1/builds/B17':
            return {'data':self.build_data}
        raise AssertionError('Unexpected request '+method+' '+path)

    def group_state(self,build_id):
        return ({'attributes':{'name':'Existing Internal Group'}},self.attached)

    def attach_group(self,build_id):
        self.attached=True
        self.calls.append(('attach',build_id,None))


def fixture(root,kind='plist'):
    cfg={'scheme':'NeoxApp' if kind=='plist' else 'ToyAlive',
         'project':'Neox.xcodeproj' if kind=='plist' else 'ToyAlive.xcodeproj',
         'version_source':kind if kind=='plist' else 'xcodegen-yaml',
         'version_file':'Neox/Info.plist' if kind=='plist' else 'project.yml',
         'bundle_id':'com.neox.app' if kind=='plist' else 'com.lalalic.toyalive',
         'app_id':'6761634486' if kind=='plist' else '6830787971',
         'team_id':'JABNLDLN8G','key_id':'FAKEKEY','issuer_id':'fake-issuer','group_id':'fake-testers',
         'export_compliance':{'uses_non_exempt_encryption':False,'basis':'Previously reviewed app classification'}}
    if kind=='plist':
        p=root/'Neox/Info.plist'
        p.parent.mkdir(parents=True,exist_ok=True)
        p.write_bytes(plistlib.dumps({'CFBundleShortVersionString':'0.1.0','CFBundleVersion':'17',
                                     'ITSAppUsesNonExemptEncryption':False}))
    else:
        p=root/'project.yml'
        p.write_text('name: ToyAlive\nsettings:\n  base:\n    MARKETING_VERSION: "0.1.0"\n    CURRENT_PROJECT_VERSION: "1"\n    INFOPLIST_KEY_ITSAppUsesNonExemptEncryption: false\n')
    (root/'apple-delivery.json').write_text(json.dumps(cfg))
    return cfg


def archive(root, cfg, encryption=None):
    a=root/'candidate.xcarchive'
    p=a/'Products/Applications'/(cfg['scheme'].removesuffix('App')+'.app')/'Info.plist'
    p.parent.mkdir(parents=True,exist_ok=True)
    d={'CFBundleIdentifier':cfg['bundle_id'],'CFBundleShortVersionString':'0.1.0','CFBundleVersion':'17'}
    if encryption is not None:d['ITSAppUsesNonExemptEncryption']=encryption
    p.write_bytes(plistlib.dumps(d))
    return a


class AppleDeliveryTests(unittest.TestCase):
    def setUp(self):
        tmp=tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root=Path(tmp.name)
        self.cfg=fixture(self.root)
        old=tf.ROOT
        tf.ROOT=self.root
        self.addCleanup(setattr,tf,'ROOT',old)

    def test_config_and_neox_version(self):
        self.assertEqual(tf.load_config(self.root/'apple-delivery.json'),self.cfg)
        self.assertEqual(tf.stored_version(self.cfg),('0.1.0','17'))

    def test_toyalive_xcodegen_version_and_bump(self):
        cfg=fixture(self.root,'yaml')
        self.assertEqual(tf.stored_version(cfg),('0.1.0','1'))
        tf.set_build_number(cfg,'18')
        self.assertEqual(tf.stored_version(cfg),('0.1.0','18'))
        self.assertEqual((self.root/'project.yml').read_text().count('CURRENT_PROJECT_VERSION'),1)

    def test_source_compliance_verified_for_both_project_types(self):
        tf.check_source_compliance(self.cfg)
        cfg=fixture(self.root,'yaml')
        tf.check_source_compliance(cfg)
        p=self.root/'project.yml'
        p.write_text(p.read_text().replace('false','true'))
        with self.assertRaisesRegex(tf.ReleaseError,'differs'):
            tf.check_source_compliance(cfg)

    def test_apple_request_blocks_cross_origin_pagination(self):
        o=tf.Apple({},None)
        with patch.object(o,'request',return_value={'data':[],'links':{'next':'https://evil.example/v1/builds'}}):
            with self.assertRaisesRegex(tf.ReleaseError,'unexpected origin'):
                o.pages('/v1/builds')

    def test_apple_pagination_accepts_apple(self):
        o=tf.Apple({},None)
        responses=[{'data':[{'id':'one'}],'links':{'next':'https://api.appstoreconnect.apple.com/v1/builds?cursor=x'}},{'data':[{'id':'two'}]}]
        with patch.object(o,'request',side_effect=responses) as req:
            self.assertEqual(len(o.pages('/v1/builds')),2)
            self.assertEqual(req.call_args[0][0],'/v1/builds?cursor=x')

    def test_build_bump_never_reuses_uploaded_build(self):
        self.assertEqual(tf.latest_build_num([{'attributes':{'version':'4'}},{'attributes':{'version':'14'}}]),14)
        with self.assertRaisesRegex(tf.ReleaseError,'not newer'):
            tf.ensure_build_not_used(FakeApple(self.cfg), '0.1.0','14')
        with self.assertRaises(tf.ReleaseError):tf.numeric_build('1.2')

    def test_archive_identity_and_compliance(self):
        a=archive(self.root,self.cfg,encryption=False)
        self.assertEqual(tf.archived_version(a,self.cfg),('0.1.0','17'))
        tf.check_archive_compliance(a,self.cfg)
        p=next(a.glob('Products/Applications/*.app/Info.plist'))
        d=plistlib.loads(p.read_bytes());d['ITSAppUsesNonExemptEncryption']=True;p.write_bytes(plistlib.dumps(d))
        with self.assertRaisesRegex(tf.ReleaseError,'encryption key'):
            tf.check_archive_compliance(a,self.cfg)
        d['CFBundleIdentifier']='com.wrong.app';p.write_bytes(plistlib.dumps(d))
        with self.assertRaisesRegex(tf.ReleaseError,'bundle ID'):
            tf.archived_version(a,self.cfg)

    def test_legacy_archive_requires_post_upload_compliance(self):
        a=archive(self.root,self.cfg)
        with self.assertRaisesRegex(tf.ReleaseError,'encryption key'):
            tf.check_archive_compliance(a,self.cfg,strict=True)
        tf.check_archive_compliance(a,self.cfg,strict=False)

    def test_no_unapproved_compliance_changes(self):
        fake=FakeApple(self.cfg,encryption=None)
        self.assertFalse(tf.report_status(fake,'0.1.0','17',resolve_compliance=False))
        self.assertFalse(any(method=='PATCH' for _,method,_ in fake.calls))
        self.assertTrue(tf.report_status(fake,'0.1.0','17',resolve_compliance=True))
        patch_calls=[x for x in fake.calls if x[1]=='PATCH']
        self.assertEqual(len(patch_calls),1)
        self.assertIs(patch_calls[0][2]['data']['attributes']['usesNonExemptEncryption'],False)

    def test_status_rejects_conflicting_apple_classification(self):
        fake=FakeApple(self.cfg,encryption=True)
        with self.assertRaisesRegex(tf.ReleaseError,'differs'):
            tf.report_status(fake,'0.1.0','17',resolve_compliance=True)
        self.assertFalse(any(method=='PATCH' for _,method,_ in fake.calls))

    def test_processed_and_group_separate(self):
        self.assertFalse(tf.report_status(FakeApple(self.cfg,state='PROCESSING'),'0.1.0','17',assign=True))
        fake=FakeApple(self.cfg,attached=False)
        self.assertFalse(tf.report_status(fake,'0.1.0','17'))
        self.assertTrue(tf.report_status(fake,'0.1.0','17',assign=True))
        self.assertTrue(fake.attached)

    def test_key_permissions_enforced(self):
        k=self.root/'AuthKey_FAKEKEY.p8'
        k.write_text('no real key')
        os.chmod(k,0o644)
        with patch.dict(os.environ,{'ASC_PRIVATE_KEYS_DIR':str(self.root)}):
            with self.assertRaisesRegex(tf.ReleaseError,'chmod 600'):tf.key_path(self.cfg)
            os.chmod(k,0o600)
            self.assertEqual(tf.key_path(self.cfg),k)

    def test_der_ecdsa_signing_returns_correct_jwt_shape(self):
        key=self.root/'ec-key.pem'
        subprocess.run(['openssl','ecparam','-name','prime256v1','-genkey','-noout','-out',str(key)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        token=tf.jwt(self.cfg,key,now=1234567890)
        h,p,s=token.split('.')
        self.assertEqual(len(base64.urlsafe_b64decode(s+'='*((-len(s))%4))),64)
        self.assertEqual(json.loads(base64.urlsafe_b64decode(p+'='*((-len(p))%4)))['iat'],1234567890)
        with self.assertRaises(tf.ReleaseError):tf.der_signature_to_raw(b'invalid')

    def test_existing_archive_upload_mock_and_readback(self):
        a=archive(self.root,self.cfg,encryption=False)
        fake=FakeApple(self.cfg)
        seen=[]
        with patch.object(tf,'Apple',return_value=fake),patch.object(tf,'key_path',return_value=self.root/'dummy.p8'),patch.object(tf,'check_signing',return_value=True),patch.object(tf,'run_logged',side_effect=lambda command,outfile,**kwargs:seen.append(command)):
            self.assertEqual(tf.main(['--project',str(self.root),'release','--archive',str(a),'--wait-seconds','0']),0)
        self.assertEqual(len(seen),1)
        self.assertIn('-exportArchive',seen[0])
        self.assertIn('-authenticationKeyPath',seen[0])

    def test_dry_run_does_not_bump_or_upload(self):
        fake=FakeApple(self.cfg)
        before=(self.root/'Neox/Info.plist').read_bytes()
        with patch.object(tf,'Apple',return_value=fake),patch.object(tf,'key_path',return_value=self.root/'dummy.p8'),patch.object(tf,'check_signing',return_value=True),patch.object(tf,'run_logged') as run:
            self.assertEqual(tf.main(['--project',str(self.root),'release','--bump','--dry-run']),0)
            run.assert_not_called()
        self.assertEqual(before,(self.root/'Neox/Info.plist').read_bytes())

    def test_compliance_config_requires_review_basis(self):
        self.cfg['export_compliance']={'uses_non_exempt_encryption':False}
        (self.root/'apple-delivery.json').write_text(json.dumps(self.cfg))
        with self.assertRaisesRegex(tf.ReleaseError,'basis'):
            tf.load_config(self.root/'apple-delivery.json')


if __name__=='__main__':unittest.main()
