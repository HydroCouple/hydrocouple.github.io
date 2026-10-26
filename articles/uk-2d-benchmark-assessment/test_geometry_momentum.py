"""A partial or altered diagnostic may not overwrite reviewed website evidence."""
import hashlib,importlib.util,json,tempfile,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('geometry_momentum',Path(__file__).with_name('geometry_momentum.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class GuardTest(unittest.TestCase):
    def test_incomplete_preserves_existing(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);source=root/'source';source.mkdir();dest=root/'article/evidence/g2-geometry-momentum';dest.mkdir(parents=True);(dest/'retained').write_text('reviewed')
            with self.assertRaisesRegex(ValueError,'completed audit'):m.supplement(source,root/'article',root/'images','slug')
            self.assertEqual((dest/'retained').read_text(),'reviewed')
    def test_changed_receipts_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            for f in ['geometry-audit.json','momentum-audit.json','instrumentation-equivalence.json','report-provenance.json']:(root/f).write_text(json.dumps(dict(status='PASS')))
            (root/'momentum-ledger.csv').write_text('changed')
            (root/'publication-manifest.json').write_text(json.dumps(dict(duration_s=30,qualification='diagnostic',cases=['frozen30','audit-disabled','audit-enabled','audit-enabled-v2','order1-30','muscl-off-30','broad005-30','broad005-muscloff-30','previous-local'],files={**{n:hashlib.sha256((root/n).read_bytes()).hexdigest() for n in ['geometry-audit.json','momentum-audit.json','instrumentation-equivalence.json','report-provenance.json']},'momentum-ledger.csv':hashlib.sha256(b'original').hexdigest()})))
            with self.assertRaisesRegex(ValueError,'identity mismatch'):m.validate(root)
if __name__=='__main__':unittest.main()
