# FIW person-tagging benchmark

Run date: 2026-07-21

## Protocol

- Identity: one `F*/MID*` directory.
- Reference: the naturally sorted first immediate face image in each member directory.
- Known query: every remaining immediate image for that member.
- Unknown proxy: immediate images in each family's `unrelated_and_nonfaces` directory.
- Preprocessing: try a white border of 50%, 75%, then 100% per side; use the first size at which SCRFD detects a face.
- Embedding: the deployed face API's normalized 512-dimensional `buffalo_l` embedding.
- Matching: cosine similarity against one reference vector per identity.

The run enrolled 472 identities from 2,472 member images. There were 2,000
known queries and 765 unknown/nonface images. All references and known queries
embedded successfully. Detection rejected 205 unknown/nonface images, leaving
560 embeddable unknowns for the false-accept calculation.

## Results

| Measurement | Result |
| --- | ---: |
| Raw rank-1 accuracy | 89.25% |
| Top-3 accuracy | 92.80% |
| Top-5 accuracy | 93.70% |
| Current direct rule (`similarity >= 0.25`) coverage | 94.15% |
| Current direct rule accepted-known accuracy | 93.57% |
| Current direct rule unknown false-accept rate | 15.18% |
| Production confident-winner coverage | 83.60% |
| Production confident-winner accepted-known accuracy | 96.41% |
| Production confident-winner unknown false-accept rate | 5.36% |

The false-accept denominator is the 560 unknown images that produced a face
embedding. Counting all 765 unknown/nonface inputs instead, the current direct
rule accepted 85 (11.11%) and the production confident-winner rule accepted 30
(3.92%).

Threshold trade-offs using the actual second-nearest gallery identity and a
minimum top-1/top-2 margin of 0.06:

| Similarity | Known coverage | Accepted-known accuracy | Unknown FAR |
| ---: | ---: | ---: | ---: |
| 0.40 | 78.40% | 96.88% | 4.46% |
| 0.50 | 63.15% | 97.47% | 1.96% |
| 0.55 | 52.95% | 97.83% | 1.25% |
| 0.60 | 43.20% | 97.92% | 0.89% |
| 0.65 | 32.15% | 97.82% | 0.54% |
| 0.68 | 26.40% | 97.92% | 0.00% |

`0.60 + margin 0.06` is the highest-coverage tested rule under a 1% proxy FAR.
It is a benchmark candidate, not a production threshold: the FIW unknown set
is small and does not represent the application's production image mix.

## Findings

1. Padding the tight FIW crops is effective. It preserved SCRFD landmark-based
   alignment and produced embeddings for every reference and known query. The
   first 50% border worked for 2,469 of 2,472 member images; two needed 75% and
   one needed 100%.
2. One reference image is brittle. Raw rank-1 is 89.25%, and several identities
   have large appearance changes between their first image and later images.
3. Relatives are a material source of error. Of 238 raw rank-1 errors, 96
   (40.34%) selected another member of the same family. The most repeated
   confusion pairs are concentrated in families F0282 and F0026.
4. The direct `>= 0.25` path is too permissive for automatic open-set tagging
   on this benchmark: 85 of 560 embeddable unknowns were assigned an identity.
5. The production margin is sometimes inflated. Its candidate query filters
   out similarities below 0.25 before choosing the runner-up; when only one
   result survives, the runner-up becomes zero. The strict analysis in this
   report calculates the margin from the real top two gallery scores.
6. This run does not establish 8,000-person performance. `buffalo_l` produces
   embeddings rather than fixed classes, so it has no model-level class-count
   limit, but a larger gallery raises the chance of a close impostor. A real
   8,000-identity validation set is still required.

## Reproduce

The evaluator reads `LOGO_DETECTION_SERVER_URL` and
`LOGO_DETECTION_SERVER_TOKEN` from the project `.env` and does not print or
store the token.

```bash
/Users/jayson/Downloads/Work/10_auto-tag-gpu-service/.venv/bin/python \
  development/evaluate_fiw_person_tagging.py \
  --run-name full
```

The completed report is in
`development/fiw-person-tagging-results/full-v2/`. Embeddings are cached, so a
repeat analysis normally requires no API calls unless preprocessing options
change or `--force` is supplied.
