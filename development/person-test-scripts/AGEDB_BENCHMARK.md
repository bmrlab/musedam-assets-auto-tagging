# AgeDB cross-age person-tagging benchmark

Run date: 2026-07-22

## Protocol

- Identity: the trimmed `personName` parsed from
  `imageID_personName_age_sex.jpg`.
- References: every valid immediate image in `reference/`.
- Known queries: every valid immediate image in `test/`.
- Preprocessing: because this dataset is already padded, try the original
  image first, then add 25% and 50% white borders only if detection fails.
- Embedding: the deployed face API's normalized 512-dimensional `buffalo_l`
  embedding.
- Matching: reproduce the current production implementation. Group all
  vectors by identity, use the maximum reference cosine similarity as the raw
  identity score, add up to 0.045 support bonus for ranking, and compare the
  best two identities rather than individual reference images.
- Automatic acceptance: best raw similarity at least 0.55 and raw top-1/top-2
  identity margin at least 0.06.

The run enrolled all 154 identities from 264 reference images and evaluated
all 328 test images. Every reference and test image produced an embedding.

## Results

| Measurement | Result |
| --- | ---: |
| Rank-1 identification accuracy | 92.38% (303/328) |
| Top-3 identification accuracy | 94.51% |
| Top-5 identification accuracy | 95.73% |
| Current auto-tag coverage | 53.05% (174/328) |
| Current accepted-known accuracy | 99.43% (173/174) |
| Incorrect accepted auto-tags | 1 |
| Correct known queries rejected by auto-tag policy | 127 |
| Rank-1 with exact reference duplicates excluded | 92.24% |
| First-reference-only rank-1 baseline | 81.71% |
| First-reference-only auto-tag coverage | 25.30% |

The accepted-known accuracy is a closed-set precision measurement: every query
belongs to an enrolled person. It is not an unknown-person false-accept rate.

### Accuracy by minimum reference age gap

| Minimum gap | Tests | Rank-1 | Auto-tag coverage | Accepted accuracy | Mean true similarity |
| --- | ---: | ---: | ---: | ---: | ---: |
| Same age | 34 | 94.12% | 73.53% | 100.00% | 0.666 |
| 1–2 years | 240 | 94.58% | 56.25% | 99.26% | 0.548 |
| 3–5 years | 35 | 88.57% | 34.29% | 100.00% | 0.468 |
| 6–9 years | 15 | 73.33% | 13.33% | 100.00% | 0.371 |
| 10+ years | 4 | 50.00% | 0.00% | n/a | 0.229 |

### Accuracy by number of valid references

| References per identity | Tests | Rank-1 | Auto-tag coverage | Accepted accuracy |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 91 | 81.32% | 36.26% | 100.00% |
| 2 | 131 | 94.66% | 54.96% | 98.61% |
| 3 | 106 | 99.06% | 65.09% | 100.00% |

Reference-count slices are observational rather than randomized: identities
with more source images may also be easier. Still, the all-reference ablation
improves overall rank-1 by 10.67 percentage points and more than doubles
auto-tag coverage, so multi-reference enrollment is clearly valuable here.

### Closed-set threshold diagnostics

All rows retain the 0.06 identity margin.

| Raw similarity | Coverage | Accepted-known accuracy | Correct accepted |
| ---: | ---: | ---: | ---: |
| 0.40 | 84.15% | 99.64% | 275 |
| 0.50 | 69.21% | 99.56% | 226 |
| 0.55 | 53.05% | 99.43% | 173 |
| 0.60 | 36.28% | 100.00% | 119 |
| 0.65 | 21.04% | 100.00% | 69 |

A diagnostic support-aware rule—raw 0.56 when the winner has one supporting
reference, raw 0.55 with two or more supports, and margin 0.06 in both
cases—accepted 171 queries (52.13%) with no known-person errors. It rejected
the single current-policy error while losing two correct acceptances. This is
not a deployment recommendation until it is tested against unknown people.

## Findings

1. The main weakness is age separation. Mean genuine similarity falls from
   0.548 at a 1–2 year gap to 0.371 at 6–9 years and 0.229 at 10+ years. Rank-1
   falls in parallel from 94.58% to 73.33% and 50.00%.
2. Multiple references are the strongest improvement already available. The
   current all-reference gallery reaches 92.38% rank-1 versus 81.71% with only
   the first reference.
3. The only incorrect auto-tag is
   `test/247_JanePowell_19_f.jpg -> DebbieReynolds`. Its raw score is 0.558 and
   its identity margin is 0.109, so the existing margin rule cannot reject it.
   Only one Debbie Reynolds reference supports that match.
4. Six test files are byte-identical to reference files. Excluding them changes
   rank-1 only slightly (92.38% to 92.24%), but they should still be removed in
   the next dataset version. GladysCooper, JoanLorring, and TomJones also have
   inconsistent filename sex labels.
5. Female-labeled queries score lower than male-labeled queries (89.42% versus
   97.50% rank-1), but the samples are imbalanced and contain label errors. A
   larger balanced evaluation is required before attributing this to model
   bias.
6. This `young` split contains ages only up to 20. It does not establish
   performance across adult-to-elderly aging or at a production-scale gallery.

## Improvement plan

1. **Improve the gallery before changing the model.** Require or strongly
   recommend three curated reference images per person, spanning age, pose,
   expression, lighting, and image source. When age metadata is available,
   retain age-clustered templates rather than near-duplicate references.
2. **Evaluate a support-aware policy.** Test the 0.56 single-support / 0.55
   multi-support rule on the existing FIW unknown proxy and, more importantly,
   a production-domain unknown set. Select policy using both known coverage
   and false-accept rate, not this closed-set result alone.
3. **Train for age-invariant identity.** Build hard positive batches with the
   widest available same-person age gaps and hard negative batches from the
   observed confusion pairs. A/B test age-invariant feature disentanglement
   and cross-age contrastive learning against `buffalo_l`. Published examples
   include [Decorrelated Adversarial Learning](https://openaccess.thecvf.com/content_CVPR_2019/html/Wang_Decorrelated_Adversarial_Learning_for_Age-Invariant_Face_Recognition_CVPR_2019_paper.html)
   and [Cross-Age Contrastive Learning](https://arxiv.org/abs/2312.11195).
4. **Use synthetic aging only as augmentation.** If real long-gap positive
   pairs are scarce, generate age-progressed variants, retain the original
   identity label, and filter them with identity-preservation checks. A recent
   study reports a benefit at a 40-year gap, but synthetic drift makes this an
   experiment rather than a default
   ([paper](https://arxiv.org/abs/2406.06932)).
5. **Separate age robustness from image quality.** Add blur, resolution, pose,
   occlusion, and illumination slices to the report. A quality-adaptive model
   such as [AdaFace](https://openaccess.thecvf.com/content/CVPR2022/html/Kim_AdaFace_Quality_Adaptive_Margin_for_Face_Recognition_CVPR_2022_paper.html)
   is worth an A/B test for degraded images, but it does not replace explicit
   cross-age training.
6. **Complete the validation matrix.** Add unknown people, adult/elderly age
   gaps, and a gallery near the expected production size. Report known-person
   coverage/precision together with unknown false-accept rate and bootstrap
   confidence intervals before modifying production thresholds.

## Reproduce

```bash
/Users/jayson/Downloads/Work/10_auto-tag-gpu-service/.venv/bin/python \
  development/person-test-scripts/evaluate_agedb_person_tagging.py \
  --run-name full \
  --concurrency 16
```

Detailed local outputs are in
`development/person-test-scripts/agedb-person-tagging-results/full/`.
Embeddings are cached, so a repeat analysis does not call the API unless the
preprocessing configuration changes or `--force` is supplied.
