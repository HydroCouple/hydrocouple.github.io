"""Guard against publishing incomplete or falsely successful shoreline evidence."""
from pathlib import Path
import hashlib
import importlib.util
import json
import shutil
import unittest
from datetime import datetime, timezone
HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('partial_wet', HERE / 'partial_wet.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
SOURCE = HERE / 'evidence/g2-partial-wet'


class Publication(unittest.TestCase):
    def setUp(self):
        self.source = HERE / 'qa/partial-wet' / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%f') / self._testMethodName
        self.source.mkdir(parents=True)
        manifest = json.loads((SOURCE / 'publication-manifest.json').read_text())
        for name in [*manifest['files'], 'publication-manifest.json']:
            target = self.source / name; target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(SOURCE / name, target)

    def reseal(self):
        p = self.source / 'publication-manifest.json'; manifest = json.loads(p.read_text())
        manifest['files'] = {name: hashlib.sha256((self.source / name).read_bytes()).hexdigest()
                             for name in manifest['files']}
        p.write_text(json.dumps(manifest))

    def test_complete_diagnostic_with_failures_is_accepted(self):
        m.validate(self.source)

    def test_tampered_case_is_rejected(self):
        with (self.source / 'native.csv').open('a') as f: f.write('tampered')
        with self.assertRaisesRegex(ValueError, 'identity mismatch'): m.validate(self.source)

    def test_missing_case_is_rejected_even_when_resealed(self):
        p = self.source / 'native.csv'; p.write_text('\n'.join(p.read_text().splitlines()[:-1]) + '\n'); self.reseal()
        with self.assertRaisesRegex(ValueError, 'Incomplete partial-wet case matrix'): m.validate(self.source)

    def test_hidden_failures_are_rejected_even_when_resealed(self):
        p = self.source / 'summary.json'; value = json.loads(p.read_text()); value['ridge_failures'] = 0
        p.write_text(json.dumps(value)); self.reseal()
        with self.assertRaisesRegex(ValueError, 'misrepresented'): m.validate(self.source)


if __name__ == '__main__': unittest.main()
