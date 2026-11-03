# Inference regression gate

`expected.json` contains `{file, label, confidence}` entries. Every fixture is
224x224, so the inference resize is a no-op. Tests require every label to match
and every absolute confidence difference to be at most 0.01. Missing fixtures,
missing model files, and an empty manifest fail the gate rather than skipping it.

The initial eight images are deterministic synthetic patterns, generated with
the user's authorization because notebook exports and the test dataset were
unavailable. Their labels and confidences are predictions from the unchanged
model, not ground truth or accuracy measurements. They cover four predicted
classes. They check inference regressions; they do not establish notebook parity
or accuracy on sports photographs. No external image assets or licences apply.

The reference generator applies EXIF transpose, RGB conversion, Pillow bilinear
resize, float32 conversion, MobileNetV2 preprocessing, and `model.predict`
independently of the production inference functions. It never updates the model
or labels. The test suite never regenerates expectations.

Baseline model SHA256:
`23bbb3a33ad38d40340e271a52affd223706ea42f722ffc69a5cd869a8624492`

Baseline labels SHA256:
`29373731fec4b9b0cf7ea26d65db7246f2cf3e90f437d9068ef962db034c9c52`

From `backend/`, generate a candidate in a new directory for manual review:

```powershell
.\.venv\Scripts\python.exe -m tests.golden.generate_fixtures --output tests/golden_candidate
```

To sample a provided dataset across class subfolders instead:

```powershell
.\.venv\Scripts\python.exe -m tests.golden.generate_fixtures --source path/to/test_dataset --count 8 --output tests/golden_candidate
```

The helper refuses to overwrite an existing `expected.json`. Review a candidate
before intentionally replacing checked-in fixtures. When notebook exports become
available, prefer their 224x224 images and expected values for the original
notebook parity gate specified in SPEC.md.
