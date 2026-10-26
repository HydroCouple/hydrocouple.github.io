"""Publish only completed, sealed reconstruction qualification evidence."""
from pathlib import Path
import csv
import hashlib
import json
import shutil


def validate(source):
    source = Path(source)
    required = ["qualification.json", "interpretation.json", "report-provenance.json", "publication-manifest.json"]
    if any(not (source / name).is_file() for name in required):
        raise ValueError("Reconstruction supplement requires completed qualification records")
    publication = json.loads((source / "publication-manifest.json").read_text())
    cases = {"original120": 120, "original30": 30, "original-broad005-30": 30, "clean-combined": 30,
             "vertex-gradient-only": 30, "clean-combined-120": 120, "clean-broad005-30": 30}
    if publication.get("cases") != cases or publication.get("qualification") != "fixed-physics reassessment":
        raise ValueError("Reconstruction case register is incomplete")
    if not set(required[:3]).issubset(publication["files"]):
        raise ValueError("Reconstruction qualification identities are incomplete")
    for relative, expected in publication["files"].items():
        path = Path(relative)
        if path.is_absolute() or ".." in path.parts or hashlib.sha256((source / path).read_bytes()).hexdigest() != expected:
            raise ValueError("Reconstruction artifact identity mismatch: " + relative)
    qualification = json.loads((source / "qualification.json").read_text())
    if (qualification.get("status") != "PASS" or qualification.get("new_native_failures") != []
            or qualification.get("corrected", {}).get("tests") != 12
            or qualification.get("corrected", {}).get("failures") != 0
            or any(x.get("cases") != 16 or x.get("passed") != 16 for x in qualification.get("analytical", {}).values())
            or len(qualification.get("analytical", {})) != 3):
        raise ValueError("Reconstruction qualification failed")
    references = set()
    identities = {}
    for name, duration in cases.items():
        root = source / name
        required_case = [name + "/" + n for n in ["model.inp", "manifest.json", "metrics.json", "probes.csv", "status.json", "reference/observations.csv"]]
        if not set(required_case).issubset(publication["files"]):
            raise ValueError("Reconstruction executed case incomplete: " + name)
        identity = json.loads((root / "manifest.json").read_text())
        metric = json.loads((root / "metrics.json").read_text())
        if (json.loads((root / "status.json").read_text()).get("state") != "COMPLETE" or metric["returncode"] != 0
                or not metric["checks"] or not all(metric["checks"].values())):
            raise ValueError("Reconstruction numerical run incomplete: " + name)
        if hashlib.sha256((root / "model.inp").read_bytes()).hexdigest() != identity["input_sha256"]:
            raise ValueError("Reconstruction executed input mismatch: " + name)
        with (root / "probes.csv").open() as stream:
            rows = list(csv.DictReader(stream))
        if len(rows) != 6 * duration * 10 or float(rows[-1]["time_s"]) != duration:
            raise ValueError("Reconstruction output duration incomplete: " + name)
        references.add(hashlib.sha256((root / "reference/observations.csv").read_bytes()).hexdigest())
        identities[name] = identity["input_sha256"]
    if len(references) != 1:
        raise ValueError("Reconstruction measured subsets differ")
    if (identities["original120"] != identities["clean-combined-120"]
            or identities["original30"] != identities["clean-combined"]
            or identities["original-broad005-30"] != identities["clean-broad005-30"]
            or identities["clean-combined"] != identities["vertex-gradient-only"]):
        raise ValueError("Reconstruction same-mesh comparisons changed physical inputs")
    return publication


def supplement(source, here, image_root, slug):
    source = Path(source)
    publication = validate(source)
    destination = here / "evidence/g2-reconstruction"
    if destination.exists():
        shutil.rmtree(destination)
    destination.mkdir(parents=True)
    for relative in publication["files"]:
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source / relative, target)
    shutil.copy2(source / "publication-manifest.json", destination / "publication-manifest.json")
    interpretation = json.loads((source / "interpretation.json").read_text())
    return f'''## Qualifying the reconstruction and wall-state correction

Native irregular-mesh tests exposed errors in linear reconstruction and wall-stage consistency. The correction uses conditioned linear fits, bounds reconstructed velocity at cell vertices, and evaluates reflecting walls from the same beginning-stage state as interior faces. It adds no calibrated friction or turbulence coefficient.

{interpretation['finding']}

{interpretation['qualification']}

The [reconstruction qualification report](evidence/g2-reconstruction/report.html) includes the original failing tests, rejected unstable candidates, restart checks, analytical gates, full 120-second Test 6A comparison, and refined-mesh diagnostic. Its plots retain the UK report's panels and axes, with full-range views and measured data only. Canonical inputs and reviewed regression anchors remain unchanged.

'''
