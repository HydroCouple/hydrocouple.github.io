from pathlib import Path
import hashlib
import json
import shutil
import tempfile
import unittest
import source_reconciliation as m

HERE = Path(__file__).resolve().parent


class SourcePublication(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'source'
        shutil.copytree(HERE / 'evidence/g2-source-reconciliation', self.root)

    def reseal(self):
        p = self.root / 'publication-manifest.json'
        manifest = json.loads(p.read_text())
        manifest['files'] = {name: hashlib.sha256((self.root / name).read_bytes()).hexdigest()
                             for name in manifest['files']}
        p.write_text(json.dumps(manifest))

    def test_complete_audit_with_limitations_is_accepted(self):
        m.validate(self.root)

    def test_uncertain_sources_cannot_be_relabelled_complete(self):
        p = self.root / 'source-review.json'; value = json.loads(p.read_text())
        value['state'] = 'COMPLETE'; p.write_text(json.dumps(value)); self.reseal()
        with self.assertRaisesRegex(ValueError, 'limitations omitted'):
            m.validate(self.root)

    def test_altered_reference_is_rejected_after_outer_reseal(self):
        p = self.root / 'strict-reference/observations.csv'
        p.write_text(p.read_text() + 'altered\n'); self.reseal()
        with self.assertRaisesRegex(ValueError, 'Strict-reference identity'):
            m.validate(self.root)

    def test_attached_marker_cannot_be_promoted_after_reseal(self):
        p = self.root / 'marker-connectivity.csv'
        text = p.read_text(); self.assertIn(',13,True', text)
        p.write_text(text.replace(',13,True', ',14,True', 1)); self.reseal()
        with self.assertRaisesRegex(ValueError, 'connectivity misrepresented'):
            m.validate(self.root)


if __name__ == '__main__':
    unittest.main()
