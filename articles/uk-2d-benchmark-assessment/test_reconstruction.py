"""Publication guards keep incomplete or altered results out of reviewed evidence."""
from pathlib import Path
import hashlib
import importlib.util
import json
import shutil
import unittest

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location('reconstruction', HERE / 'reconstruction.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class GuardTest(unittest.TestCase):
    def setUp(self):
        self.root = HERE / 'qa/reconstruction-publication-tests' / self._testMethodName
        if self.root.exists():
            shutil.rmtree(self.root)
        self.root.mkdir(parents=True)

    def make_fixture(self):
        source = self.root / 'source'
        source.mkdir()
        save = lambda p, v: p.write_text(json.dumps(v))
        save(source / 'qualification.json', dict(status='PASS', new_native_failures=[],
             corrected=dict(tests=12, failures=0),
             analytical={n: dict(cases=16, passed=16) for n in ['clean', 'current', 'gradient']}))
        for name in ['interpretation.json', 'report-provenance.json']:
            save(source / name, {})
        cases = {'original120': 120, 'original30': 30, 'original-broad005-30': 30, 'clean-combined': 30,
                 'vertex-gradient-only': 30, 'clean-combined-120': 120, 'clean-broad005-30': 30}
        for name, duration in cases.items():
            work = source / name
            (work / 'reference').mkdir(parents=True)
            (work / 'model.inp').write_text('duration=' + str(duration))
            save(work / 'manifest.json', dict(input_sha256=hashlib.sha256((work / 'model.inp').read_bytes()).hexdigest()))
            save(work / 'status.json', dict(state='COMPLETE'))
            save(work / 'metrics.json', dict(returncode=0, checks=dict(finite=True)))
            (work / 'reference/observations.csv').write_text('identical measured subset')
            (work / 'probes.csv').write_text('time_s,probe\n' + ''.join(f'{i / 10},{probe}\n' for i in range(1, duration * 10 + 1) for probe in range(6)))
        self.seal(source, cases)
        return source, cases

    def seal(self, source, cases):
        files = {str(p.relative_to(source)): hashlib.sha256(p.read_bytes()).hexdigest()
                 for p in source.rglob('*') if p.is_file() and p.name != 'publication-manifest.json'}
        (source / 'publication-manifest.json').write_text(json.dumps(dict(cases=cases, qualification='fixed-physics reassessment', files=files)))

    def test_complete_fixture_accepted(self):
        source, _ = self.make_fixture()
        m.validate(source)

    def test_incomplete_preserves_reviewed_evidence(self):
        source = self.root / 'source'; source.mkdir()
        destination = self.root / 'article/evidence/g2-reconstruction'
        destination.mkdir(parents=True)
        (destination / 'retained').write_text('reviewed')
        with self.assertRaisesRegex(ValueError, 'completed qualification'):
            m.supplement(source, self.root / 'article', self.root / 'images', 'slug')
        self.assertEqual((destination / 'retained').read_text(), 'reviewed')

    def test_changed_output_identity_rejected(self):
        source, _ = self.make_fixture()
        (source / 'clean-combined/probes.csv').write_text('changed')
        with self.assertRaisesRegex(ValueError, 'artifact identity mismatch'):
            m.validate(source)

    def test_incomplete_duration_rejected_even_when_resealed(self):
        source, cases = self.make_fixture()
        p = source / 'clean-combined-120/probes.csv'
        p.write_text('\n'.join(p.read_text().splitlines()[:-6]) + '\n')
        self.seal(source, cases)
        with self.assertRaisesRegex(ValueError, 'output duration incomplete'):
            m.validate(source)

    def test_changed_physics_rejected_even_when_resealed(self):
        source, cases = self.make_fixture()
        p = source / 'clean-combined/model.inp'
        p.write_text('changed roughness')
        (p.parent / 'manifest.json').write_text(json.dumps(dict(input_sha256=hashlib.sha256(p.read_bytes()).hexdigest())))
        self.seal(source, cases)
        with self.assertRaisesRegex(ValueError, 'changed physical inputs'):
            m.validate(source)


if __name__ == '__main__':
    unittest.main()
