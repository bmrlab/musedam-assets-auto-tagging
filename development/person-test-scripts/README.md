# Development benchmarks

## FG-NET cross-age person-tagging benchmark

`evaluate_fgnet_person_tagging.py` parses `personIDAage[variant].JPG`, groups
images by the zero-padded person ID, and sorts each person by age. By default,
it enrolls three evenly spread references and queries every unselected image.
For six images, positions 1, 3, and 5 are references while positions 2, 4, and
6 are tests. Use `--references-per-person 1`, `2`, or `3` to change the
gallery size.

Matching, support bonuses, and automatic-acceptance thresholds reproduce the
current production policy. Reports include the exact reference selection,
per-query and per-identity results, age-gap slices, confusion pairs, threshold
diagnostics, a youngest-selected-reference ablation, and data-quality checks.
FG-NET is closed-set in this protocol, so it does not measure unknown-person
false accepts.

Run a smoke benchmark:

```bash
/Users/jayson/Downloads/Work/10_auto-tag-gpu-service/.venv/bin/python \
  development/person-test-scripts/evaluate_fgnet_person_tagging.py \
  --max-identities 5 \
  --max-tests 30 \
  --run-name smoke
```

Run the complete three-reference benchmark:

```bash
/Users/jayson/Downloads/Work/10_auto-tag-gpu-service/.venv/bin/python \
  development/person-test-scripts/evaluate_fgnet_person_tagging.py \
  --run-name full \
  --concurrency 16
```

The default input is
`/Users/jayson/Downloads/Datasets/AgeDataset/FGNET_padded/images` and outputs
are written under `fgnet-person-tagging-results/`. Embeddings are cached, so
the one-, two-, and three-reference protocols can reuse the same API results.
The completed interpretation is in
[`FGNET_BENCHMARK.md`](./FGNET_BENCHMARK.md).

Run the offline regression tests (no API calls):

```bash
/Users/jayson/Downloads/Work/10_auto-tag-gpu-service/.venv/bin/python \
  -m unittest development/person-test-scripts/test_evaluate_fgnet_person_tagging.py -v
```

## AgeDB cross-age person-tagging benchmark

`evaluate_agedb_person_tagging.py` evaluates the current production person
matcher against the separated `reference/` and `test/` folders in
`AgeDB_young_padded_split`. It enrolls every reference image for each parsed
person name, groups matches at the identity level, applies the production
multi-reference support bonus, and evaluates the current raw similarity `0.55`
plus identity runner-up margin `0.06` auto-tag policy.

The report also includes accuracy by minimum reference/test age gap, a
first-reference-only baseline, exact file-content leakage checks, per-identity
results, confusion pairs, and a closed-set threshold sweep. AgeDB has no
unknown-person split here, so the benchmark intentionally does not claim an
open-set false-accept rate.

Run a smoke benchmark:

```bash
/Users/jayson/Downloads/Work/10_auto-tag-gpu-service/.venv/bin/python \
  development/person-test-scripts/evaluate_agedb_person_tagging.py \
  --max-identities 20 \
  --max-tests 50 \
  --run-name smoke
```

Run the complete benchmark:

```bash
/Users/jayson/Downloads/Work/10_auto-tag-gpu-service/.venv/bin/python \
  development/person-test-scripts/evaluate_agedb_person_tagging.py \
  --run-name full
```

The default input is
`/Users/jayson/Downloads/Datasets/AgeDataset/AgeDB_young_padded_split` and
outputs are written under `agedb-person-tagging-results/`. Embeddings are
cached outside each named run, so later analyses normally reuse them.
The completed interpretation is in
[`AGEDB_BENCHMARK.md`](./AGEDB_BENCHMARK.md).

Run the offline regression tests (no API calls):

```bash
/Users/jayson/Downloads/Work/10_auto-tag-gpu-service/.venv/bin/python \
  -m unittest development/person-test-scripts/test_evaluate_agedb_person_tagging.py -v
```

## FIW person-tagging benchmark

`evaluate_fiw_person_tagging.py` enrolls the naturally sorted first image from
each `F*/MID*` folder and classifies the remaining images with cosine
similarity. It uses the deployed face API configured by
`LOGO_DETECTION_SERVER_URL` and `LOGO_DETECTION_SERVER_TOKEN` in the project
`.env`; it does not create people, tags, or vectors in the application database.

FIW images are tight face crops. The evaluator pads them before detection so
SCRFD can recover five landmarks and the deployed ArcFace model can perform its
normal alignment. The first padding ratio that yields a 512-dimensional
embedding is cached and reused by later runs.

For comparison, `--embedding-mode synthetic-landmarks` bypasses SCRFD and calls
`/generate_face_embedding` with canonical ArcFace landmarks scaled to the crop.
This approximates direct embedding when the input crops are already aligned,
but it will also embed nonface images and should not be used on arbitrary
production images without an upstream face/crop guarantee.

Run a smoke benchmark:

```bash
/Users/jayson/Downloads/Work/10_auto-tag-gpu-service/.venv/bin/python \
  development/evaluate_fiw_person_tagging.py \
  --max-members 20 \
  --max-queries 50 \
  --unknown-limit 20 \
  --run-name smoke
```

Run the complete local FIW benchmark:

```bash
/Users/jayson/Downloads/Work/10_auto-tag-gpu-service/.venv/bin/python \
  development/evaluate_fiw_person_tagging.py \
  --run-name full
```

Outputs are written to `development/fiw-person-tagging-results/`:

- `summary.json`: accuracy, score distributions, and acceptance-rule metrics
- `query-results.csv`: one row per known or unknown query
- `identity-results.csv`: accuracy aggregated by FIW member
- `confusion-pairs.csv`: repeatedly confused identity pairs
- `threshold-sweep.csv`: similarity/margin threshold trade-offs
- `enrollment-failures.csv`: reference images that could not be embedded
- `embedding-cache-*.jsonl`: resumable API embedding cache

The completed benchmark interpretation and threshold table are in
[`FIW_BENCHMARK.md`](./FIW_BENCHMARK.md).

Run the offline regression tests (no API calls):

```bash
/Users/jayson/Downloads/Work/10_auto-tag-gpu-service/.venv/bin/python \
  -m unittest development/test_evaluate_fiw_person_tagging.py -v
```

Useful options:

```text
--padding-ratios 0.5,0.75,1.0
--padding-color white|black|edge
--embedding-mode padded-detect|synthetic-landmarks
--concurrency 8
--retry-failures
--force
--no-include-unknown
```

## FIW padded dataset copy

`pad_fiw_dataset.py` recursively adds a 50% white border on every side of each
image while preserving the original relative paths and filenames. Existing
outputs are skipped so an interrupted run can be resumed safely.

```bash
/Users/jayson/Downloads/Work/10_auto-tag-gpu-service/.venv/bin/python \
  development/pad_fiw_dataset.py
```

The default destination is
`/Users/jayson/Downloads/Datasets/Family Dataset/FIW Dataset_padded dataset`.
