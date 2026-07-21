# Development benchmarks

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
