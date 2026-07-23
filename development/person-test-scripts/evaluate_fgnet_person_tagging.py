#!/usr/bin/env python3
"""Evaluate current person tagging on a deterministic FG-NET cross-age split.

FG-NET filenames use ``personIDAage[variant].JPG`` (for example,
``066A06a.JPG``). Images are grouped by the zero-padded person ID and sorted
by age, then up to three reference images are spread across the age sequence.
With six images and three requested references, positions 1, 3, and 5 are
enrolled; positions 2, 4, and 6 are held out as queries. Every image that is
not selected as a reference is used as a known-person query.

The evaluator reuses the production-policy simulation from the AgeDB
benchmark: identity score is the maximum reference cosine similarity, multiple
supporting references can add a ranking bonus, and automatic tagging requires
raw similarity >= 0.55 plus a runner-up identity margin >= 0.06. It only calls
the deployed face API for embeddings and never writes people, vectors, or tags
to the application database.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import asdict, replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Sequence

from evaluate_agedb_person_tagging import (
    PERSON_AUTO_TAG_MIN_RAW_SIMILARITY,
    PERSON_AUTO_TAG_MIN_RUNNER_UP_MARGIN,
    PERSON_CANDIDATE_IDENTITY_LIMIT,
    PERSON_MAX_SUPPORT_BONUS,
    PERSON_MULTI_IMAGE_SUPPORT_BONUS,
    PERSON_RETURNED_IDENTITY_LIMIT,
    PERSON_SUPPORTING_IMAGE_THRESHOLD,
    PERSON_VECTOR_CANDIDATE_SCORE_FLOOR,
    AgeDbIdentity,
    AgeDbImage,
    DatasetManifest,
    acceptance_metrics,
    build_bucket_rows,
    build_confusion_rows,
    build_identity_rows,
    build_threshold_rows,
    classify_queries,
    evaluation_metrics,
    percent,
    sha256_file,
)
from evaluate_fiw_person_tagging import (
    EmbeddingRecord,
    IMAGE_SUFFIXES,
    cache_signature,
    collect_embeddings,
    distribution,
    division,
    load_env_file,
    natural_key,
    write_csv,
)


DEFAULT_DATASET_ROOT = Path(
    "/Users/jayson/Downloads/Datasets/AgeDataset/FGNET_padded/images"
)
DEFAULT_OUTPUT_ROOT = Path(__file__).resolve().parent / "fgnet-person-tagging-results"
FILENAME_PATTERN = re.compile(
    r"^(?P<person_id>\d{3})A(?P<age>\d{1,3})(?P<variant>[a-z]?)(?P<suffix>\.[^.]+)$",
    re.IGNORECASE,
)
MAX_REFERENCE_IMAGES = 3

# These aliases make the shared policy types read naturally in this module.
FgNetImage = AgeDbImage
FgNetIdentity = AgeDbIdentity


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Evaluate current multi-reference person tagging on FG-NET.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--dataset-root", type=Path, default=DEFAULT_DATASET_ROOT)
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    parser.add_argument("--env-file", type=Path, default=Path(".env"))
    parser.add_argument("--api-url", default=None, help="Defaults to LOGO_DETECTION_SERVER_URL")
    parser.add_argument("--api-token", default=None, help="Defaults to LOGO_DETECTION_SERVER_TOKEN")
    parser.add_argument(
        "--references-per-person",
        type=int,
        choices=range(1, MAX_REFERENCE_IMAGES + 1),
        default=MAX_REFERENCE_IMAGES,
        metavar="{1,2,3}",
        help="Maximum evenly spread reference images selected for each person",
    )
    parser.add_argument(
        "--embedding-mode",
        choices=("padded-detect", "synthetic-landmarks"),
        default="padded-detect",
        help=(
            "padded-detect uses SCRFD and real landmarks; synthetic-landmarks assumes "
            "the crop already follows the canonical ArcFace layout"
        ),
    )
    parser.add_argument(
        "--padding-ratios",
        default="0,0.25,0.5",
        help=(
            "Extra per-side borders tried in order. FGNET_padded is already padded, "
            "so the original image is tried first"
        ),
    )
    parser.add_argument("--padding-color", choices=("white", "black", "edge"), default="white")
    parser.add_argument("--jpeg-quality", type=int, default=95)
    parser.add_argument("--concurrency", type=int, default=8)
    parser.add_argument("--request-timeout", type=float, default=90.0)
    parser.add_argument("--request-retries", type=int, default=3)
    parser.add_argument("--max-identities", type=int, default=None)
    parser.add_argument("--max-tests", type=int, default=None)
    parser.add_argument("--retry-failures", action="store_true")
    parser.add_argument("--force", action="store_true", help="Ignore cached embeddings")
    parser.add_argument("--run-name", default=None)
    parser.add_argument("--progress-every", type=int, default=50)
    args = parser.parse_args()

    try:
        args.padding_ratios = tuple(float(item.strip()) for item in args.padding_ratios.split(","))
    except ValueError:
        parser.error("--padding-ratios must contain numbers")
    if not args.padding_ratios or any(value < 0 for value in args.padding_ratios):
        parser.error("--padding-ratios must contain nonnegative numbers")
    if not 1 <= args.jpeg_quality <= 100:
        parser.error("--jpeg-quality must be between 1 and 100")
    if args.concurrency < 1 or args.request_retries < 1 or args.progress_every < 1:
        parser.error("concurrency, retries, and progress interval must be positive")
    if args.max_identities is not None and args.max_identities < 1:
        parser.error("--max-identities must be positive")
    if args.max_tests is not None and args.max_tests < 1:
        parser.error("--max-tests must be positive")
    return args


def parse_fgnet_filename(path: Path, split: str = "source") -> FgNetImage:
    match = FILENAME_PATTERN.fullmatch(path.name)
    if not match or path.suffix.lower() not in IMAGE_SUFFIXES:
        raise ValueError("expected personIDAage[variant].<image-extension>")
    person_id = match.group("person_id")
    return FgNetImage(
        path=path,
        image_id=int(person_id),
        identity=person_id,
        age=int(match.group("age")),
        sex="unknown",
        split=split,
        sha256=sha256_file(path),
    )


def evenly_spaced_reference_indices(image_count: int, reference_count: int) -> tuple[int, ...]:
    """Return age-order positions spread from the first to penultimate image.

    The oldest image remains a query, which makes the six-image/three-reference
    case exactly ``(0, 2, 4)`` as requested. A single reference uses the middle
    image because there is no meaningful interval to span.
    """

    if image_count < 2:
        raise ValueError("at least two images are required for a reference/test split")
    if not 1 <= reference_count <= min(MAX_REFERENCE_IMAGES, image_count - 1):
        raise ValueError("reference_count must be between 1 and min(3, image_count - 1)")
    if reference_count == 1:
        return ((image_count - 1) // 2,)

    last_reference_index = image_count - 2
    intervals = reference_count - 1
    return tuple(
        (position * last_reference_index + intervals // 2) // intervals
        for position in range(reference_count)
    )


def split_identity_images(
    images: Sequence[FgNetImage],
    references_per_person: int,
) -> FgNetIdentity:
    if not images:
        raise ValueError("cannot split an empty identity")
    ordered = sorted(images, key=lambda image: (image.age, natural_key(image.path.name)))
    identity = ordered[0].identity
    if any(image.identity != identity for image in ordered):
        raise ValueError("all images must belong to one identity")
    if len(ordered) == 1:
        return FgNetIdentity(
            identity=identity,
            references=(replace(ordered[0], split="reference"),),
            tests=(),
        )

    selected_count = min(references_per_person, len(ordered) - 1)
    reference_indices = set(evenly_spaced_reference_indices(len(ordered), selected_count))
    references = tuple(
        replace(image, split="reference")
        for index, image in enumerate(ordered)
        if index in reference_indices
    )
    tests = tuple(
        replace(image, split="test")
        for index, image in enumerate(ordered)
        if index not in reference_indices
    )
    return FgNetIdentity(identity=identity, references=references, tests=tests)


def discover_dataset(
    dataset_root: Path,
    references_per_person: int = MAX_REFERENCE_IMAGES,
    max_identities: int | None = None,
) -> DatasetManifest:
    dataset_root = dataset_root.expanduser().resolve()
    if not dataset_root.is_dir():
        raise FileNotFoundError(f"FG-NET image directory not found: {dataset_root}")

    grouped: dict[str, list[FgNetImage]] = {}
    invalid: list[dict[str, str]] = []
    candidates = sorted(
        (path for path in dataset_root.iterdir() if path.is_file()),
        key=lambda path: natural_key(path.name),
    )
    for path in candidates:
        if path.suffix.lower() not in IMAGE_SUFFIXES:
            continue
        try:
            image = parse_fgnet_filename(path)
        except ValueError as error:
            invalid.append(
                {
                    "split": "source",
                    "path": path.relative_to(dataset_root).as_posix(),
                    "error": str(error),
                }
            )
            continue
        grouped.setdefault(image.identity, []).append(image)

    identity_names = sorted(grouped, key=natural_key)
    all_identities = tuple(
        split_identity_images(grouped[name], references_per_person) for name in identity_names
    )
    identities = (
        all_identities
        if max_identities is None
        else all_identities[:max_identities]
    )
    return DatasetManifest(
        identities=identities,
        invalid_filenames=tuple(invalid),
        all_reference_count=sum(len(identity.references) for identity in all_identities),
        all_test_count=sum(len(identity.tests) for identity in all_identities),
    )


def selected_tests(
    identities: Sequence[FgNetIdentity],
    max_tests: int | None,
) -> list[FgNetImage]:
    tests = [test for identity in identities for test in identity.tests]
    tests.sort(key=lambda image: (natural_key(image.identity), image.age, natural_key(image.path.name)))
    return tests if max_tests is None else tests[:max_tests]


def reference_selection_rows(identities: Sequence[FgNetIdentity]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for identity in identities:
        source = sorted(
            (*identity.references, *identity.tests),
            key=lambda image: (image.age, natural_key(image.path.name)),
        )
        rows.append(
            {
                "identity": identity.identity,
                "source_image_count": len(source),
                "source_ages": ",".join(str(image.age) for image in source),
                "reference_count": len(identity.references),
                "reference_images": ",".join(image.path.name for image in identity.references),
                "reference_ages": ",".join(str(image.age) for image in identity.references),
                "test_count": len(identity.tests),
                "test_images": ",".join(image.path.name for image in identity.tests),
                "test_ages": ",".join(str(image.age) for image in identity.tests),
            }
        )
    return rows


def dataset_metadata(
    manifest: DatasetManifest,
    results: Sequence[Any],
    references_per_person: int,
) -> dict[str, Any]:
    identities = manifest.identities
    source_counts: dict[str, int] = {}
    for identity in identities:
        count = len(identity.references) + len(identity.tests)
        source_counts[str(count)] = source_counts.get(str(count), 0) + 1
    test_hash_counts: dict[str, int] = {}
    for identity in identities:
        for image in identity.tests:
            test_hash_counts[image.sha256] = test_hash_counts.get(image.sha256, 0) + 1
    return {
        "discovered_identities": len(identities),
        "source_images": sum(
            len(identity.references) + len(identity.tests) for identity in identities
        ),
        "reference_images": sum(len(identity.references) for identity in identities),
        "test_images": len(results),
        "references_per_person_requested": references_per_person,
        "unlimited_reference_images": manifest.all_reference_count,
        "unlimited_test_images": manifest.all_test_count,
        "identities_missing_references": [
            identity.identity for identity in identities if not identity.references
        ],
        "identities_missing_tests": [
            identity.identity for identity in identities if not identity.tests
        ],
        "source_image_count_distribution": dict(
            sorted(source_counts.items(), key=lambda item: int(item[0]))
        ),
        "invalid_filename_count": len(manifest.invalid_filenames),
        "test_images_duplicating_a_reference": sum(
            bool(row.duplicate_of_reference) for row in results
        ),
        "duplicate_test_content_groups": sum(count > 1 for count in test_hash_counts.values()),
    }


def summarize(
    *,
    manifest: DatasetManifest,
    results: Sequence[Any],
    baseline_results: Sequence[Any],
    metadata: dict[str, Any],
    baseline_metadata: dict[str, Any],
    records: dict[str, EmbeddingRecord],
    args: argparse.Namespace,
    cache_path: Path,
) -> dict[str, Any]:
    evaluable = [row for row in results if row.status == "ok"]
    correct = [row for row in evaluable if row.production_rank1_correct]
    incorrect = [row for row in evaluable if not row.production_rank1_correct]
    clean = [row for row in results if not row.duplicate_of_reference]
    bucket_rows = build_bucket_rows(results)
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "protocol": {
            "identity": "zero-padded personID parsed from personIDAage[variant] filename",
            "source_order": "ascending age, then natural filename order",
            "reference_selection": (
                "up to the requested 1-3 positions evenly spread from the first to "
                "penultimate age-ordered image; one reference uses the middle image"
            ),
            "queries": "every valid image not selected as a reference",
            "identity_raw_score": "maximum cosine similarity over that identity's references",
            "supporting_reference_threshold": PERSON_SUPPORTING_IMAGE_THRESHOLD,
            "support_bonus_per_extra_reference": PERSON_MULTI_IMAGE_SUPPORT_BONUS,
            "support_bonus_cap": PERSON_MAX_SUPPORT_BONUS,
            "candidate_score_floor": PERSON_VECTOR_CANDIDATE_SCORE_FLOOR,
            "candidate_identity_limit": PERSON_CANDIDATE_IDENTITY_LIMIT,
            "returned_identity_limit": PERSON_RETURNED_IDENTITY_LIMIT,
            "auto_tag_min_raw_similarity": PERSON_AUTO_TAG_MIN_RAW_SIMILARITY,
            "auto_tag_min_runner_up_margin": PERSON_AUTO_TAG_MIN_RUNNER_UP_MARGIN,
            "padding_ratios": list(args.padding_ratios),
            "padding_color": args.padding_color,
            "embedding_mode": args.embedding_mode,
            "jpeg_quality": args.jpeg_quality,
        },
        "dataset": dataset_metadata(manifest, results, args.references_per_person),
        "embedding": {
            "model_names": sorted(
                {
                    record.model_name
                    for record in records.values()
                    if record.status == "ok" and record.model_name
                }
            ),
            "cache_file": str(cache_path),
            "enrolled_identities": metadata["enrolled_identities"],
            "valid_reference_images": metadata["valid_reference_images"],
            "reference_embedding_failures": len(metadata["reference_embedding_failures"]),
            "query_embedding_failures": sum(
                not records.get(row.path) or records[row.path].status != "ok" for row in results
            ),
        },
        "closed_set": {
            **evaluation_metrics(results),
            "leakage_excluded": evaluation_metrics(clean),
            "correct_top1_similarity": distribution(
                [row.top1_raw_similarity for row in correct if row.top1_raw_similarity is not None]
            ),
            "incorrect_top1_similarity": distribution(
                [
                    row.top1_raw_similarity
                    for row in incorrect
                    if row.top1_raw_similarity is not None
                ]
            ),
            "true_identity_similarity": distribution(
                [
                    row.true_identity_similarity
                    for row in evaluable
                    if row.true_identity_similarity is not None
                ]
            ),
            "correct_margin": distribution(
                [row.raw_runner_up_margin for row in correct if row.raw_runner_up_margin is not None]
            ),
            "incorrect_margin": distribution(
                [
                    row.raw_runner_up_margin
                    for row in incorrect
                    if row.raw_runner_up_margin is not None
                ]
            ),
        },
        "age_gap_results": [row for row in bucket_rows if row["dimension"] == "age_gap"],
        "reference_baseline": {
            "description": (
                "same production matcher using only the youngest of the selected references "
                "per identity"
            ),
            **evaluation_metrics(baseline_results),
            "valid_reference_images": baseline_metadata["valid_reference_images"],
        },
        "policy_diagnostics": {
            "support_aware_candidate": {
                "description": (
                    "raw >= 0.56 for a winner supported by one reference; raw >= 0.55 "
                    "for two or more supporting references; always require margin >= 0.06"
                ),
                **acceptance_metrics(
                    results,
                    lambda row: (
                        row.top1_raw_similarity is not None
                        and row.raw_runner_up_margin is not None
                        and row.raw_runner_up_margin
                        >= PERSON_AUTO_TAG_MIN_RUNNER_UP_MARGIN
                        and (
                            row.top1_raw_similarity >= 0.56
                            or row.top1_raw_similarity >= 0.55
                            and row.supporting_reference_count >= 2
                        )
                    ),
                ),
                "warning": (
                    "closed-set diagnostic only; validate unknown-person false accepts before "
                    "changing production policy"
                ),
            },
            "require_two_supporting_references": {
                "description": (
                    "current raw >= 0.55 and margin >= 0.06 policy, additionally requiring "
                    "at least two references above the 0.36 support threshold"
                ),
                **acceptance_metrics(
                    results,
                    lambda row: (
                        row.top1_raw_similarity is not None
                        and row.top1_raw_similarity >= PERSON_AUTO_TAG_MIN_RAW_SIMILARITY
                        and row.raw_runner_up_margin is not None
                        and row.raw_runner_up_margin
                        >= PERSON_AUTO_TAG_MIN_RUNNER_UP_MARGIN
                        and row.supporting_reference_count >= 2
                    ),
                ),
                "warning": (
                    "closed-set diagnostic only; reduces coverage and cannot apply to people "
                    "with fewer than two valid reference embeddings"
                ),
            }
        },
        "limitations": {
            "open_set_false_accept_rate": (
                "not measured: every FG-NET query belongs to an enrolled identity"
            ),
            "split_variance": (
                "one deterministic split is measured; cross-validation is needed to estimate "
                "sensitivity to reference choice"
            ),
            "threshold_tuning": (
                "do not lower production thresholds from this closed-set benchmark alone"
            ),
        },
    }


def write_markdown_report(
    *,
    path: Path,
    summary: dict[str, Any],
    threshold_rows: Sequence[dict[str, Any]],
    confusion_rows: Sequence[dict[str, Any]],
) -> None:
    closed = summary["closed_set"]
    baseline = summary["reference_baseline"]
    support_candidate = summary["policy_diagnostics"]["support_aware_candidate"]
    two_support_candidate = summary["policy_diagnostics"][
        "require_two_supporting_references"
    ]
    dataset = summary["dataset"]
    selected_thresholds = [
        row
        for row in threshold_rows
        if row["require_margin_0_06"] and row["threshold"] in {0.4, 0.5, 0.55, 0.6, 0.65}
    ]
    lines = [
        "# FG-NET cross-age person-tagging benchmark",
        "",
        f"Generated: {summary['generated_at']}",
        "",
        "## Protocol",
        "",
        f"Images are sorted by age for each person and up to "
        f"{dataset['references_per_person_requested']} references are spread from the first "
        "through the penultimate position. Every unselected image is a query. For six images "
        "with three references, positions 1, 3, and 5 are references and positions 2, 4, and "
        "6 are queries. Matching reproduces the current production identity-level maximum "
        "score, support bonus, and raw-similarity/margin acceptance policy.",
        "",
        "## Results",
        "",
        "| Measurement | Result |",
        "| --- | ---: |",
        f"| Source images | {dataset['source_images']} |",
        f"| Identities enrolled | {summary['embedding']['enrolled_identities']} / {dataset['discovered_identities']} |",
        f"| Valid reference images | {summary['embedding']['valid_reference_images']} |",
        f"| Evaluable tests | {closed['evaluable_queries']} / {closed['query_total']} |",
        f"| Rank-1 accuracy | {percent(closed['evaluable_rank1_accuracy'])} |",
        f"| Top-3 accuracy | {percent(closed['evaluable_top3_accuracy'])} |",
        f"| Top-5 accuracy | {percent(closed['evaluable_top5_accuracy'])} |",
        f"| Auto-tag coverage (`raw >= 0.55`, margin `>= 0.06`) | {percent(closed['auto_tag_coverage'])} |",
        f"| Accuracy among accepted auto-tags | {percent(closed['auto_tag_accepted_accuracy'])} |",
        f"| Incorrect accepted auto-tags | {closed['incorrect_auto_tags']} |",
        f"| Rank-1 accuracy, exact reference duplicates excluded | {percent(closed['leakage_excluded']['evaluable_rank1_accuracy'])} |",
        f"| Youngest-selected-reference-only rank-1 baseline | {percent(baseline['evaluable_rank1_accuracy'])} |",
        f"| Youngest-selected-reference-only auto-tag coverage | {percent(baseline['auto_tag_coverage'])} |",
        f"| Support-aware candidate coverage (diagnostic only) | {percent(support_candidate['coverage'])} |",
        f"| Support-aware candidate accepted accuracy | {percent(support_candidate['accepted_accuracy'])} |",
        f"| Require-two-supports coverage (diagnostic only) | {percent(two_support_candidate['coverage'])} |",
        f"| Require-two-supports accepted accuracy | {percent(two_support_candidate['accepted_accuracy'])} |",
        "",
        "## Accuracy by minimum reference age gap",
        "",
        "| Gap | Tests | Rank-1 | Auto-tag coverage | Accepted accuracy | Mean true similarity |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for row in summary["age_gap_results"]:
        lines.append(
            f"| {row['bucket']} | {row['query_count']} | {percent(row['rank1_accuracy'])} | "
            f"{percent(row['auto_tag_coverage'])} | {percent(row['accepted_accuracy'])} | "
            f"{row['mean_true_similarity']:.3f} |"
        )
    lines.extend(
        [
            "",
            "## Support-aware policy diagnostic",
            "",
            f"The closed-set support-aware diagnostic accepted {support_candidate['accepted']} "
            f"tests ({percent(support_candidate['coverage'])}) with "
            f"{percent(support_candidate['accepted_accuracy'])} accepted accuracy and "
            f"{support_candidate['incorrect']} errors. It is not a deployment recommendation "
            "until it passes an unknown-person benchmark.",
            "",
            f"Keeping the current raw and margin thresholds but requiring at least two "
            f"supporting references accepted {two_support_candidate['accepted']} tests "
            f"({percent(two_support_candidate['coverage'])}) with "
            f"{percent(two_support_candidate['accepted_accuracy'])} accepted accuracy and "
            f"{two_support_candidate['incorrect']} errors. This also requires open-set "
            "validation and is unavailable for identities with fewer than two valid references.",
            "",
            "## Closed-set threshold diagnostics",
            "",
            "These rows retain the 0.06 identity margin. They do not measure unknown-person "
            "false accepts and are not sufficient for choosing a production threshold.",
            "",
            "| Raw similarity | Coverage | Accepted accuracy | Correct accepted |",
            "| ---: | ---: | ---: | ---: |",
        ]
    )
    for row in selected_thresholds:
        lines.append(
            f"| {row['threshold']:.2f} | {percent(row['known_coverage'])} | "
            f"{percent(row['accepted_known_accuracy'])} | {row['known_correct']} |"
        )
    lines.extend(["", "## Data-quality checks", ""])
    lines.append(
        f"- {dataset['test_images_duplicating_a_reference']} test images are byte-identical "
        "to a reference image; leakage-excluded accuracy is reported above."
    )
    lines.append(f"- Invalid image filenames: {dataset['invalid_filename_count']}.")
    lines.append(
        f"- Reference embedding failures: {summary['embedding']['reference_embedding_failures']}; "
        f"query embedding failures: {summary['embedding']['query_embedding_failures']}."
    )
    lines.extend(["", "## Most frequent confusions", ""])
    if confusion_rows:
        lines.extend(
            [
                "| True identity | Predicted identity | Count | Mean winning similarity | Auto-tagged errors |",
                "| --- | --- | ---: | ---: | ---: |",
            ]
        )
        for row in confusion_rows[:10]:
            lines.append(
                f"| {row['true_identity']} | {row['predicted_identity']} | {row['count']} | "
                f"{row['mean_top1_raw_similarity']:.3f} | {row['auto_tagged_errors']} |"
            )
    else:
        lines.append("No rank-1 confusions among evaluable queries.")
    lines.extend(
        [
            "",
            "## Limitations",
            "",
            "FG-NET is closed-set here: every query identity exists in the gallery, so this "
            "measures cross-age identification and known-person auto-tag coverage/precision, "
            "not unknown-person false-accept rate. The deterministic reference split also "
            "does not quantify sensitivity to which particular images are enrolled. Retain "
            "an open-set production-domain benchmark and add repeated reference splits before "
            "changing thresholds.",
            "",
        ]
    )
    path.write_text("\n".join(lines), encoding="utf-8")


def print_summary(summary: dict[str, Any]) -> None:
    closed = summary["closed_set"]
    baseline = summary["reference_baseline"]
    print("\nFG-NET cross-age person-tagging result")
    print(
        f"  enrolled identities: {summary['embedding']['enrolled_identities']}/"
        f"{summary['dataset']['discovered_identities']}"
    )
    print(f"  valid references: {summary['embedding']['valid_reference_images']}")
    print(f"  evaluable tests: {closed['evaluable_queries']}/{closed['query_total']}")
    print(f"  rank-1 accuracy: {closed['evaluable_rank1_accuracy']}")
    print(f"  top-3 accuracy: {closed['evaluable_top3_accuracy']}")
    print(
        "  production auto-tag: "
        f"coverage={closed['auto_tag_coverage']}, "
        f"accepted_accuracy={closed['auto_tag_accepted_accuracy']}, "
        f"incorrect={closed['incorrect_auto_tags']}"
    )
    print(
        "  leakage-excluded rank-1: "
        f"{closed['leakage_excluded']['evaluable_rank1_accuracy']}"
    )
    print(
        "  youngest-selected-reference baseline rank-1: "
        f"{baseline['evaluable_rank1_accuracy']}"
    )


def main() -> int:
    args = parse_args()
    load_env_file(args.env_file)
    args.api_url = args.api_url or os.environ.get("LOGO_DETECTION_SERVER_URL")
    args.api_token = args.api_token or os.environ.get("LOGO_DETECTION_SERVER_TOKEN")
    if not args.api_url or not args.api_token:
        print(
            "error: LOGO_DETECTION_SERVER_URL and LOGO_DETECTION_SERVER_TOKEN are required",
            file=sys.stderr,
        )
        return 2

    manifest = discover_dataset(
        args.dataset_root,
        references_per_person=args.references_per_person,
        max_identities=args.max_identities,
    )
    tests = selected_tests(manifest.identities, args.max_tests)
    paths = [
        reference.path for identity in manifest.identities for reference in identity.references
    ]
    paths.extend(test.path for test in tests)
    print(
        f"discovered {len(manifest.identities)} identities, "
        f"{len(paths) - len(tests)} references, {len(tests)} tests, "
        f"{len(manifest.invalid_filenames)} invalid filenames"
    )

    args.output_root.mkdir(parents=True, exist_ok=True)
    signature = cache_signature(args)
    cache_path = args.output_root / f"embedding-cache-{signature}.jsonl"
    records = collect_embeddings(
        paths=paths,
        dataset_root=args.dataset_root,
        cache_path=cache_path,
        args=args,
    )
    results, metadata = classify_queries(
        identities=manifest.identities,
        tests=tests,
        records=records,
        dataset_root=args.dataset_root,
    )
    baseline_results, baseline_metadata = classify_queries(
        identities=manifest.identities,
        tests=tests,
        records=records,
        dataset_root=args.dataset_root,
        max_references_per_identity=1,
    )

    run_name = args.run_name or datetime.now().strftime("fgnet-%Y%m%d-%H%M%S")
    run_dir = args.output_root / run_name
    run_dir.mkdir(parents=True, exist_ok=True)
    threshold_rows = build_threshold_rows(results)
    bucket_rows = [
        row for row in build_bucket_rows(results) if row["dimension"] != "sex"
    ]
    identity_rows = build_identity_rows(manifest.identities, results)
    confusion_rows = build_confusion_rows(results)
    summary = summarize(
        manifest=manifest,
        results=results,
        baseline_results=baseline_results,
        metadata=metadata,
        baseline_metadata=baseline_metadata,
        records=records,
        args=args,
        cache_path=cache_path,
    )

    write_csv(run_dir / "query-results.csv", [asdict(row) for row in results])
    write_csv(run_dir / "threshold-sweep.csv", threshold_rows)
    write_csv(run_dir / "bucket-results.csv", bucket_rows)
    write_csv(run_dir / "identity-results.csv", identity_rows)
    write_csv(run_dir / "confusion-pairs.csv", confusion_rows)
    write_csv(run_dir / "reference-selection.csv", reference_selection_rows(manifest.identities))
    write_csv(
        run_dir / "reference-embedding-failures.csv",
        metadata["reference_embedding_failures"],
        fieldnames=("identity", "reference", "age", "error"),
    )
    write_csv(
        run_dir / "invalid-filenames.csv",
        list(manifest.invalid_filenames),
        fieldnames=("split", "path", "error"),
    )
    (run_dir / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    write_markdown_report(
        path=run_dir / "report.md",
        summary=summary,
        threshold_rows=threshold_rows,
        confusion_rows=confusion_rows,
    )
    print_summary(summary)
    print(f"  reports: {run_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
