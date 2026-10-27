from pathlib import Path
import hashlib
import json
import shutil
import tempfile
import unittest

import muscl

HERE = Path(__file__).resolve().parent


class MusclPublication(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'evidence'
        shutil.copytree(HERE / 'evidence/g2-muscl', self.root)

    def reseal(self):
        path = self.root / 'publication-manifest.json'
        value = json.loads(path.read_text())
        value['files'] = {name: hashlib.sha256((self.root / name).read_bytes()).hexdigest() for name in value['files']}
        path.write_text(json.dumps(value))

    def test_complete_controlled_study_is_accepted(self):
        muscl.validate(self.root)

    def test_corrupted_evidence_is_rejected(self):
        path = self.root / 'cases/coarse-order1/probes.csv'
        path.write_text(path.read_text() + 'corrupted\n')
        with self.assertRaisesRegex(ValueError, 'identity mismatch'):
            muscl.validate(self.root)

    def test_missing_paired_case_is_rejected_after_reseal(self):
        path = self.root / 'summary.json'
        value = json.loads(path.read_text())
        del value['cases']['broad-muscl-off']
        path.write_text(json.dumps(value))
        self.reseal()
        with self.assertRaisesRegex(ValueError, 'paired method matrix'):
            muscl.validate(self.root)

    def test_nonidentical_replay_is_rejected_after_reseal(self):
        path = self.root / 'replay-equivalence.json'
        value = json.loads(path.read_text())
        value['fields']['Mesh2_face_depth']['changed_values'] = 1
        path.write_text(json.dumps(value))
        self.reseal()
        with self.assertRaisesRegex(ValueError, 'replay differs'):
            muscl.validate(self.root)

    def test_failed_native_limiter_cannot_be_admitted(self):
        path = self.root / 'qualification/summary.json'
        value = json.loads(path.read_text())
        row = next(r for r in value['modes'] if r['mode'] == 'common-velocity')
        row['native_failures'] = ['CroppedTinBankCornerDoesNotGenerateRunawayEnergy']
        path.write_text(json.dumps(value))
        self.reseal()
        with self.assertRaisesRegex(ValueError, 'Unqualified experiment'):
            muscl.validate(self.root)

    def test_strict_reference_hash_is_checked_independently(self):
        path = self.root / 'strict-reference/observations.csv'
        path.write_text(path.read_text() + 'altered\n')
        self.reseal()
        with self.assertRaisesRegex(ValueError, 'Strict reference identity'):
            muscl.validate(self.root)


if __name__ == '__main__':
    unittest.main()
