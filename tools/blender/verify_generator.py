"""Blender integration check: failure isolation, partial rebuild, byte determinism.

Run after generating the production models:
blender -b --python-exit-code 1 -P tools/blender/verify_generator.py
Creates only ignored debug artifacts; does not change production models/previews.
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys
from typing import Any
from unittest.mock import patch


def fail() -> None:
    raise RuntimeError('Intentional verification failure')


def main() -> None:
    spec = importlib.util.spec_from_file_location('sport_models', Path(__file__).with_name('make_sport_models.py'))
    assert spec and spec.loader
    generator: Any = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(generator)
    baseline_path = generator.ROOT/'frontend/public/models/manifest.json'
    baseline = json.loads(baseline_path.read_text(encoding='utf-8'))
    assert len(baseline['models']) == 20, 'Generate all production models first'
    output = generator.ROOT/'backend/debug_frames/model_asset_checks'
    report_path = generator.ROOT/'backend/debug_frames/model_previews/generation_report.json'
    previous_report = report_path.read_bytes() if report_path.exists() else None
    try:
        # Geometry/export really run; only rendering and sheet composition are skipped.
        with patch.object(generator, 'preview'), patch.object(generator.subprocess, 'run'), \
                patch.object(sys, 'argv', ['verify', '--', '--out', str(output)]), \
                patch.dict(generator.BUILDERS, {'basketball': fail}):
            try:
                generator.main()
            except RuntimeError as error:
                assert 'Failed sports: basketball' in str(error)
            else:
                raise AssertionError('An individual failure must fail the overall run')
        failed = json.loads((output/'manifest.json').read_text(encoding='utf-8'))
        report = json.loads(report_path.read_text(encoding='utf-8'))
        assert len(failed['models']) == 19
        assert 'basketball' not in failed['models']
        assert 'uneven bars' in failed['models'], 'Sports after the failure must finish'
        assert list(report['errors']) == ['basketball']
        # --only must repair the failed sport while preserving the other 19 entries.
        with patch.object(generator, 'preview'), patch.object(generator.subprocess, 'run'), \
                patch.object(sys, 'argv', ['verify', '--', '--out', str(output), '--only', 'basketball']):
            generator.main()
        rebuilt = json.loads((output/'manifest.json').read_text(encoding='utf-8'))
        assert rebuilt == baseline, 'Full manifest including SHA256 must be reproducible'
        for label, entry in baseline['models'].items():
            assert (output/entry['file']).read_bytes() == (baseline_path.parent/entry['file']).read_bytes(), label
        print('VERIFIED: failure isolation; --only repair; 20/20 byte-identical GLBs and manifest', flush=True)
    finally:
        if previous_report is None:
            report_path.unlink(missing_ok=True)
        else:
            report_path.write_bytes(previous_report)


if __name__ == '__main__':
    main()
