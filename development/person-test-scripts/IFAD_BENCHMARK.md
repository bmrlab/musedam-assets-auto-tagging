# IFAD cross-age person-tagging benchmark

Run date: 2026-07-28

## Protocol

- Identity: numeric `personID` parsed from `imageID-personID-age.jpg`.
- Ordering: ascending age, then natural filename order for images with the
  same age.
- Main references: three images spread from the first to the penultimate
  age-ordered position. With six images, positions 1, 3, and 5 are references.
- Known queries: every valid image not selected as a reference.
- Preprocessing: try the already-padded source first, then add 25% and 50%
  white borders only if face detection fails.
- Embedding: the deployed face API's normalized 512-dimensional `buffalo_l`
  embedding.
- Matching: reproduce the current production implementation. Group vectors by
  identity, use the maximum reference cosine similarity as the raw identity
  score, add up to 0.045 support bonus for ranking, and compare the best two
  identities rather than individual reference images.
- Automatic acceptance: best raw similarity at least 0.55 and raw top-1/top-2
  identity margin at least 0.06.

This is a closed-set protocol. Precision is the fraction of accepted auto-tags
with the correct identity. Recall is correct accepted tags divided by all
evaluable known-person queries. Coverage includes both correct and incorrect
accepted tags; it equals recall in the main run only because precision is
100%.

The dataset contains 782 files for 12 identities. One malformed filename,
`364-6- 30.jpg`, was reported and skipped. The main run enrolled 36 reference
images and evaluated the other 745 valid images. Every evaluated image
produced an embedding; no query is byte-identical to a reference.

## Main results

| Measurement | Result |
| --- | ---: |
| Rank-1 identification accuracy | 100.00% (745/745) |
| Top-3 identification accuracy | 100.00% |
| Top-5 identification accuracy | 100.00% |
| Current auto-tag coverage | 56.78% (423/745) |
| Current auto-tag precision | 100.00% (423/423) |
| Current auto-tag recall | 56.78% (423/745) |
| Current auto-tag F1 | 72.43% |
| Auto-tag coverage at raw >= 0.40 (diagnostic) | 96.38% (718/745) |
| Auto-tag precision at raw >= 0.40 (diagnostic) | 100.00% (718/718) |
| Auto-tag recall at raw >= 0.40 (diagnostic) | 96.38% (718/745) |
| Incorrect accepted auto-tags | 0 |
| Correct candidates below the auto-tag threshold | 320 |
| Queries below the candidate score floor | 2 |
| Rank-1 with exact reference duplicates excluded | 100.00% |
| Youngest-selected-reference-only rank-1, same queries | 90.34% |
| Youngest-selected-reference-only auto-tag recall | 15.97% |

The 100% precision result is not an unknown-person false-accept measurement.
Every query belongs to one of only 12 enrolled identities.

### Accuracy by minimum reference age gap

| Minimum gap | Tests | Rank-1 | Auto-tag recall | Precision | Mean true similarity |
| --- | ---: | ---: | ---: | ---: | ---: |
| Same age | 71 | 100.00% | 66.20% | 100.00% | 0.588 |
| 1–2 years | 212 | 100.00% | 61.79% | 100.00% | 0.581 |
| 3–5 years | 262 | 100.00% | 54.20% | 100.00% | 0.553 |
| 6–9 years | 161 | 100.00% | 50.93% | 100.00% | 0.551 |
| 10+ years | 39 | 100.00% | 53.85% | 100.00% | 0.557 |

Rank-1 remains perfect in every age-gap bucket, but genuine similarity and
automatic-tag recall decline as the nearest enrolled age gets farther away.
The 10+ year row contains only 39 tests, so its small rebound should not be
read as evidence that very large gaps are easier.

### Reference-count runs

| Selection | References | Tests | Rank-1 | Auto-tag precision | Auto-tag recall | F1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| One middle reference | 12 | 769 | 100.00% | 100.00% | 36.41% | 53.38% |
| First and penultimate references | 24 | 757 | 99.87% | 100.00% | 39.89% | 57.03% |
| First, middle, and penultimate references | 36 | 745 | 100.00% | 100.00% | 56.78% | 72.43% |

These runs have different held-out query sets because selected references
cannot also be queries. The paired main-run ablation is more direct: on the
same 745 queries, retaining only the youngest selected reference reduces
rank-1 from 100.00% to 90.34% and recall from 56.78% to 15.97%.

## Findings

1. **Identification is excellent under this protocol.** The production
   ranking finds the right identity for all 745 held-out images, including all
   39 queries at least ten years from the nearest reference. No production
   algorithm change is justified by IFAD rank-1 accuracy alone.
2. **Operational recall is the real weakness.** Of 322 untagged queries, 320
   are correct rank-1 matches below the 0.55 similarity threshold. The other
   two are person-8 images at ages 9 and 18 with true similarities 0.194 and
   0.123, below the 0.25 candidate floor. There are no margin rejections and no
   incorrect accepted tags.
3. **Three age-spread references materially improve confidence.** The main
   three-reference gallery raises recall by 20.37 percentage points over one
   middle reference and by 16.89 points over two references. The paired
   youngest-reference ablation shows that reference age coverage matters even
   more than the raw reference count.
4. **The remaining low-confidence cases are identity-specific.** Auto-tag
   recall ranges from 16.46% for person 7 and 37.35% for person 8 to 98.11%
   for person 3 and 100% for person 2. Person 8 spans ages 3–42; its two
   no-candidate images combine a large child-to-adult appearance shift with
   visibly different resolution, crop, lighting, and photographic style.
5. **The result is likely optimistic relative to production.** There are only
   12 candidate identities, 71 queries share an age with a reference, and
   repeated images around the same age can come from closely related capture
   conditions. A larger gallery creates more competitive impostors and
   smaller margins.
6. **Four exact duplicate-content groups need data cleanup.** Each pair has
   inconsistent age labels: images 259/261 (person 5), 307/325 (person 5),
   635/649 (person 10), and 712/725 (person 11). None crosses the
   reference/query boundary, so the main leakage-excluded rank-1 result is
   unchanged, but these pairs can distort age-gap analysis.
7. **A lower threshold looks attractive but is not yet safe.** At raw
   similarity 0.40 with the current 0.06 margin, this closed-set run reaches
   96.38% recall with 100% precision. IFAD contains no unknown people, so this
   does not show what false-accept rate that threshold would produce in
   production.

## Improvement plan

No production algorithm was modified for this benchmark. The next steps are
ordered to separate gallery/data improvements from model and policy changes.

1. **Keep three curated, age-spread references as the default.** Cover early,
   middle, and recent life stages, and prefer clear frontal images with varied
   but production-representative capture conditions. For identities like
   person 8, an additional child/teen reference is more valuable than another
   similar adult portrait.
2. **Repeat the evaluation with age-era splits.** Rotate references within
   early/middle/late age bands and report mean accuracy, recall, and confidence
   intervals. Also add a strict leave-age-era-out slice so same-age or
   near-duplicate captures cannot dominate the result.
3. **Clean the benchmark data.** Rename or explicitly exclude the malformed
   filename, resolve the four byte-identical pairs with conflicting age labels,
   and audit repeated same-age frames. Keep the evaluator strict so future
   naming errors remain visible.
4. **Build an open-set threshold benchmark before changing policy.** Mix IFAD
   known-person queries with production-domain unknown people, scale the
   gallery toward the expected production identity count, and measure false
   accepts at 0.40–0.55. Select a threshold from the required false-accept
   budget, not from closed-set recall alone.
5. **Track low-confidence identities and capture quality.** Slice recall by
   identity, age era, resolution, pose, blur, and detection/alignment quality.
   Use this to request better references or route weak matches to manual review
   without weakening the global threshold.
6. **Only then A/B test representation changes.** If child-to-adult and
   cross-domain gaps remain weak after better reference coverage, compare an
   age-invariant face backbone or fine-tune with cross-age hard positives and
   same-demographic hard negatives. Keep the gallery and acceptance policy
   fixed during model comparisons so improvements are attributable.

## Reproduce

```bash
/Users/jayson/Downloads/Work/10_auto-tag-gpu-service/.venv/bin/python \
  development/person-test-scripts/evaluate_ifad_person_tagging.py \
  --run-name full \
  --concurrency 16
```

Detailed outputs are in
`development/person-test-scripts/ifad-person-tagging-results/full/`. Embeddings
are cached, so repeating the analysis or changing `--references-per-person`
does not call the API unless preprocessing changes or `--force` is supplied.
