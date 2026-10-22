"""Ensure an excluded rerun cannot republish an older case's evidence."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


class EvidenceAssemblyTest(unittest.TestCase):
    def test_incomplete_river_sweep_cannot_publish_complete_article(self):
        path=Path(__file__).with_name('assemble.py')
        spec=importlib.util.spec_from_file_location('uk_article_assemble',path)
        assembly=importlib.util.module_from_spec(spec);spec.loader.exec_module(assembly)
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);source=root/'source';source.mkdir()
            (source/'scores.json').write_text(json.dumps(dict(coverage=dict(executed=0),cells=[])))
            with patch.object(assembly,'HERE',root/'article'):
                with self.assertRaisesRegex(ValueError,'requires all ten'):
                    assembly.river_supplement(source,root/'images')

    def test_skipped_case_files_are_not_copied(self):
        path=Path(__file__).with_name('assemble.py')
        spec=importlib.util.spec_from_file_location('uk_article_assemble',path)
        assembly=importlib.util.module_from_spec(spec);spec.loader.exec_module(assembly)
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);here=root/'article';destination=here/'evidence'
            source=root/'run';source.mkdir();images=root/'images';images.mkdir()
            cells=[]
            for name,verdict in [('uk-ea-complete','PASS'),('uk-ea-excluded','SKIP')]:
                work=source/name;(work/'figures').mkdir(parents=True)
                (work/'figures/chart.png').write_bytes(b'image fixture')
                (work/'metrics.json').write_text('{}',encoding='utf-8')
                cell=dict(case=name,solver='swmm2d-cpu-full-swe-rk2',verdict=verdict)
                if verdict=='PASS':cell['checks']={'continuity':True}
                cells.append(cell)
            (source/'scores.json').write_text(json.dumps(dict(cells=cells)),encoding='utf-8')
            with patch.object(assembly,'HERE',here):assembly.copy_evidence(source,destination,images)
            self.assertTrue((images/'uk-ea-complete-chart.png').exists())
            self.assertTrue((destination/'uk-ea-complete/metrics.json').exists())
            self.assertFalse((images/'uk-ea-excluded-chart.png').exists())
            self.assertFalse((destination/'uk-ea-excluded').exists())


if __name__=='__main__':unittest.main()
