"""Publication gates reject incomplete or inconsistent scientific evidence."""
from pathlib import Path
import csv
import hashlib
import json
import tempfile
import unittest
import bank_momentum as m


class Publication(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.put('summary.json', {})
        self.put('report.html', '<h1>Fixture</h1>')
        self.put('interpretation.json', {'reviewed': True})
        self.put('instrumentation-equivalence.json', {
            'status': 'PASS', 'bit_identical': True,
            'fields': {key: {'frames': 300, 'changed_values': 0, 'max_absolute_difference': 0}
                       for key in ['Mesh2_face_depth', 'Mesh2_face_vx', 'Mesh2_face_vy']}})
        self.put('audit-enabled-30-ledger-check.json', {'status': 'PASS'})
        deck = '[2D_OPTIONS]\nCELL_CLOSURE FLAT\n'
        identity = {'input_sha256': hashlib.sha256(deck.encode()).hexdigest(), 'library_sha256': 'same'}
        self.put('audit-enabled-30/manifest.json', identity)
        for name in ['coarse', 'bank005', 'bank0025', 'broad005']:
            prefix = f'cases/{name}/'
            self.put(prefix + 'model.inp', deck)
            self.put(prefix + 'manifest.json', identity)
            self.put(prefix + 'metrics.json', {'returncode': 0, 'checks': {'continuity': True}})
            self.put(prefix + 'status.json', {'state': 'COMPLETE'})
            self.put(prefix + 'reference/observations.csv', 'same observations\n')
            with (self.root / prefix / 'probes.csv').open('w') as stream:
                writer = csv.writer(stream)
                writer.writerow(['time_s', 'probe'])
                writer.writerows((j / 10, f'G{i}') for j in range(1, 301) for i in range(1, 7))
        self.seal()

    def put(self, name, value):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value if isinstance(value, str) else json.dumps(value))

    def seal(self):
        self.put('publication-manifest.json', {'state': 'COMPLETE', 'files': {
            str(p.relative_to(self.root)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in self.root.rglob('*') if p.is_file() and p.name != 'publication-manifest.json'}})

    def test_complete_accepted(self):
        m.validate(self.root)

    def test_tampering_rejected(self):
        self.put('report.html', 'changed')
        with self.assertRaisesRegex(ValueError, 'identity mismatch'):
            m.validate(self.root)

    def test_incomplete_history_rejected_after_reseal(self):
        path = self.root / 'cases/bank0025/probes.csv'
        lines = path.read_text().splitlines()
        lines[1] = lines[2]  # Same count and end time, but one gauge/time is missing.
        path.write_text('\n'.join(lines) + '\n')
        self.seal()
        with self.assertRaisesRegex(ValueError, 'duration incomplete'):
            m.validate(self.root)

    def test_perturbing_audit_rejected_after_reseal(self):
        path = self.root / 'instrumentation-equivalence.json'
        value = json.loads(path.read_text())
        value['fields']['Mesh2_face_depth']['changed_values'] = 1
        self.put(str(path.relative_to(self.root)), value)
        self.seal()
        with self.assertRaisesRegex(ValueError, 'not identical'):
            m.validate(self.root)

    def test_changed_physics_rejected_after_reseal(self):
        deck = '[2D_OPTIONS]\nCELL_CLOSURE VFR\n'
        self.put('cases/bank0025/model.inp', deck)
        self.put('cases/bank0025/manifest.json', {
            'input_sha256': hashlib.sha256(deck.encode()).hexdigest(), 'library_sha256': 'same'})
        self.seal()
        with self.assertRaisesRegex(ValueError, 'Physical inputs'):
            m.validate(self.root)

    def test_invalid_package_preserves_destination(self):
        self.put('audit-enabled-30-ledger-check.json', {'status': 'FAIL'})
        self.seal()
        destination = self.root / 'article'
        sentinel = destination / 'evidence/g2-bank-momentum/report.html'
        sentinel.parent.mkdir(parents=True)
        sentinel.write_text('reviewed evidence')
        with self.assertRaisesRegex(ValueError, 'accounting did not pass'):
            m.supplement(self.root, destination)
        self.assertEqual(sentinel.read_text(), 'reviewed evidence')


if __name__ == '__main__':
    unittest.main()
