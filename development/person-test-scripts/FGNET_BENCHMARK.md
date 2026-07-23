# FG-NET cross-age person-tagging benchmark

Run date: 2026-07-23

## Protocol

- Identity: the zero-padded `personID` parsed from
  `personIDAage[variant].JPG`.
- Ordering: ascending age, then natural filename order for same-age variants.
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

The main run enrolled all 82 identities from 246 reference images and
evaluated the other 756 images. All 1,002 source images produced an embedding
without additional padding. There were no invalid filenames, embedding
failures, or byte-identical reference/query pairs.

## Main results

| Measurement | Result |
| --- | ---: |
| Rank-1 identification accuracy | 97.49% (737/756) |
| Top-3 identification accuracy | 99.07% |
| Top-5 identification accuracy | 99.74% |
| Current auto-tag coverage | 75.40% (570/756) |
| Current accepted-known accuracy | 99.65% (568/570) |
| Incorrect accepted auto-tags | 2 |
| Rank-1 with exact reference duplicates excluded | 97.49% |
| Youngest-selected-reference-only rank-1, same queries | 65.21% |
| Youngest-selected-reference-only coverage, same queries | 8.47% |

The accepted-known accuracy is a closed-set precision measurement: every
query belongs to an enrolled person. It is not an unknown-person false-accept
rate.

### Accuracy by minimum reference age gap

| Minimum gap | Tests | Rank-1 | Auto-tag coverage | Accepted accuracy | Mean true similarity |
| --- | ---: | ---: | ---: | ---: | ---: |
| Same age | 9 | 100.00% | 88.89% | 100.00% | 0.720 |
| 1–2 years | 330 | 98.48% | 82.73% | 100.00% | 0.649 |
| 3–5 years | 287 | 95.47% | 69.69% | 99.00% | 0.607 |
| 6–9 years | 106 | 99.06% | 67.92% | 100.00% | 0.605 |
| 10+ years | 24 | 100.00% | 70.83% | 100.00% | 0.626 |

The non-monotonic long-gap rows should not be read as evidence that large age
gaps are easier. The split deliberately spans the age sequence with three
references, and only 24 queries have a minimum gap of 10 years or more.

### Reference-count runs

| Selection | References | Tests | Rank-1 | Top-3 | Auto-tag coverage | Accepted accuracy |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| One middle reference | 82 | 920 | 93.26% | 96.30% | 47.72% | 99.32% |
| First and penultimate references | 164 | 838 | 95.70% | 98.69% | 54.42% | 99.78% |
| First, middle, and penultimate references | 246 | 756 | 97.49% | 99.07% | 75.40% | 99.65% |

These runs have different held-out query sets because a selected reference
cannot also be a query. They show the expected direction but are not a
strictly paired ablation. The paired main-run ablation is stronger evidence:
on the same 756 queries, using only the youngest selected reference reduces
rank-1 from 97.49% to 65.21% and coverage from 75.40% to 8.47%.

## Findings

1. **Three age-spread references work well.** Rank-1 reaches 97.49%, and
   multi-reference enrollment is responsible for a large part of the result.
   A single central-age reference is much stronger than a single youngest
   reference, so both reference count and age placement matter.
2. **The remaining rank-1 weakness is concentrated in young children.**
   Sixteen of the 19 rank-1 mistakes are queries aged seven or younger.
   Rank-1 is 92.76% (205/221) at ages 0–7 versus 99.44% (532/535) above age
   seven. Genuine identity similarity averages only 0.342 for incorrect
   queries versus 0.634 for correct queries.
3. **The current precision-first policy rejects almost every rank-1 error.**
   Seventeen of 19 rank-1 mistakes are not auto-tagged. It also rejects 168
   correctly predicted queries, which explains the gap between 97.49% rank-1
   and 75.40% auto-tag coverage.
4. **Both incorrect auto-tags are one confusion pair.** `050A14.JPG` and
   `050A22.JPG` are both predicted as person `051`, using `051A14.JPG` as the
   winning reference. Raw scores are 0.705 and 0.724; margins are 0.071 and
   0.063, only slightly above the current 0.06 margin. In both cases only one
   reference supports the winning identity.
5. **Multiple-reference agreement is a strong risk signal in this run.**
   Winners supported by two or three references have 100% rank-1 accuracy.
   Requiring at least two supporting references while retaining the current
   raw and margin thresholds accepts 518 queries (68.52%) with 100% accepted
   known-person accuracy. This is a diagnostic, not yet a production rule.
6. **Detection is not the primary bottleneck.** Every image is detected on
   the original padded input. Mean detection confidence is somewhat lower for
   incorrect queries (0.775 versus 0.824), but their much lower genuine
   similarity and concentration among young children point more directly to
   identity representation and reference coverage.

## Improvement plan

No production algorithm was changed for this benchmark. The following steps
are ordered from lowest-risk evaluation/gallery improvements to model work.

1. **Keep three curated, age-spread references as the default gallery.**
   Prefer a young, middle, and older image with varied pose, expression,
   lighting, and image source. Avoid near-duplicates. When only one reference
   is possible, prefer a central or current-age image rather than the youngest
   available image.
2. **Validate a two-support acceptance tier.** On FG-NET it removes both
   incorrect auto-tags while retaining 68.52% coverage. Test it against FIW,
   a production-domain unknown-person set, and identities with only one valid
   reference before considering a policy change. A practical policy may need
   separate rules for one-reference and multi-reference galleries.
3. **Add repeated reference splits.** Rotate or bootstrap age-spread reference
   choices and report mean accuracy plus confidence intervals. This will show
   whether the 97.49% result depends on unusually favorable individual
   reference images.
4. **Build a child-focused error suite.** Oversample ages 0–7, include larger
   child-to-teen age gaps, and track blur, pose, occlusion, resolution, and
   expression. Use the observed young-child confusions as hard negatives and
   wide-age same-person pairs as hard positives.
5. **A/B test age-invariant face embeddings.** Fine-tune with cross-age
   contrastive or metric learning, emphasizing early-childhood changes, or
   compare a stronger age/quality-robust backbone against `buffalo_l`. Keep
   the gallery and acceptance policy fixed during the model comparison so the
   source of improvement is measurable.
6. **Calibrate only with open-set data.** Before changing the 0.55 raw
   threshold or 0.06 margin, measure unknown-person false accepts at the
   expected production gallery size. The closed-set threshold table can
   estimate known-person coverage but cannot establish production safety.

## Reproduce

```bash
/Users/jayson/Downloads/Work/10_auto-tag-gpu-service/.venv/bin/python \
  development/person-test-scripts/evaluate_fgnet_person_tagging.py \
  --run-name full \
  --concurrency 16
```

Detailed local outputs are in
`development/person-test-scripts/fgnet-person-tagging-results/full/`.
Embeddings are cached, so repeating the analysis or changing
`--references-per-person` does not call the API unless preprocessing changes
or `--force` is supplied.
