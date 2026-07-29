#!/usr/bin/env python3
"""Evaluate current person tagging on a deterministic IFAD cross-age split.

IFAD filenames use ``imageID-personID-age.jpg``. Images are grouped by the
numeric person ID and sorted by age, then up to three reference images are
spread across the age sequence. With six images and three requested
references, positions 1, 3, and 5 are enrolled; positions 2, 4, and 6 are held
out as queries. Every valid image that is not selected as a reference is used
as a known-person query.

The evaluator reuses the production-policy simulation and report helpers from
the AgeDB and FG-NET benchmarks. It only calls the deployed face API for
embeddings and never writes people, vectors, or tags to the application
database.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from typing import Any, Sequence

from evaluate_agedb_person_tagging import (
    PERSON_AUTO_TAG_MIN_RUNNER_UP_MARGIN,
    AgeDbImage,
    DatasetManifest,
    build_bucket_rows,
    build_confusion_rows,
    build_identity_rows,
    build_threshold_rows,
    classify_queries,
    percent,
    sha256_file,
)
from evaluate_fgnet_person_tagging import (
    MAX_REFERENCE_IMAGES,
    reference_selection_rows,
    selected_tests,
    split_identity_images,
    summarize as summarize_cross_age,
)
from evaluate_fiw_person_tagging import (
    IMAGE_SUFFIXES,
    cache_signature,
    collect_embeddings,
    division,
    load_env_file,
    natural_key,
    write_csv,
)


DEFAULT_DATASET_ROOT = Path("/Users/jayson/Downloads/Datasets/AgeDataset/IFAD_padded")
DEFAULT_OUTPUT_ROOT = Path(__file__).resolve().parent / "ifad-person-tagging-results"
FILENAME_PATTERN = re.compile(
    r"^(?P<image_id>\d+)-(?P<person_id>\d+)-(?P<age>\d{1,3})(?P<suffix>\.[^.]+)$",
    re.IGNORECASE,
)

IfadImage = AgeDbImage


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Evaluate current multi-reference person tagging on IFAD.",
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
            "Extra per-side borders tried in order. IFAD_padded is already padded, "
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


def parse_ifad_filename(path: Path, split: str = "source") -> IfadImage:
    match = FILENAME_PATTERN.fullmatch(path.name)
    if not match or path.suffix.lower() not in IMAGE_SUFFIXES:
        raise ValueError("expected imageID-personID-age.<image-extension>")
    return IfadImage(
        path=path,
        image_id=int(match.group("image_id")),
        identity=str(int(match.group("person_id"))),
        age=int(match.group("age")),
        sex="unknown",
        split=split,
        sha256=sha256_file(path),
    )


def discover_dataset(
    dataset_root: Path,
    references_per_person: int = MAX_REFERENCE_IMAGES,
    max_identities: int | None = None,
) -> DatasetManifest:
    dataset_root = dataset_root.expanduser().resolve()
    if not dataset_root.is_dir():
        raise FileNotFoundError(f"IFAD image directory not found: {dataset_root}")

    grouped: dict[str, list[IfadImage]] = {}
    invalid: list[dict[str, str]] = []
    candidates = sorted(
        (path for path in dataset_root.iterdir() if path.is_file()),
        key=lambda path: natural_key(path.name),
    )
    for path in candidates:
        if path.suffix.lower() not in IMAGE_SUFFIXES:
            continue
        try:
            image = parse_ifad_filename(path)
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
    identities = all_identities if max_identities is None else all_identities[:max_identities]
    return DatasetManifest(
        identities=identities,
        invalid_filenames=tuple(invalid),
        all_reference_count=sum(len(identity.references) for identity in all_identities),
        all_test_count=sum(len(identity.tests) for identity in all_identities),
    )


def _add_tagging_metrics(metrics: dict[str, Any]) -> dict[str, Any]:
    """Add explicit closed-set auto-tag precision, recall, and F1 aliases."""

    precision = metrics["auto_tag_accepted_accuracy"]
    recall = division(metrics["auto_tag_correct"], metrics["evaluable_queries"])
    operational_recall = division(metrics["auto_tag_correct"], metrics["query_total"])
    f1 = (
        division(2 * precision * recall, precision + recall)
        if precision is not None and recall is not None and precision + recall > 0
        else 0.0
    )
    metrics.update(
        {
            "auto_tag_precision": precision,
            "auto_tag_recall": recall,
            "operational_auto_tag_recall": operational_recall,
            "auto_tag_f1": f1,
        }
    )
    return metrics


def _threshold_policy_metrics(
    results: Sequence[Any], raw_similarity_threshold: float
) -> dict[str, Any]:
    evaluable = [row for row in results if row.status == "ok"]
    accepted = [
        row
        for row in evaluable
        if row.top1_raw_similarity is not None
        and row.top1_raw_similarity >= raw_similarity_threshold
        and row.raw_runner_up_margin is not None
        and row.raw_runner_up_margin >= PERSON_AUTO_TAG_MIN_RUNNER_UP_MARGIN
    ]
    correct = sum(row.top1_correct for row in accepted)
    precision = division(correct, len(accepted))
    recall = division(correct, len(evaluable))
    return {
        "raw_similarity_threshold": raw_similarity_threshold,
        "runner_up_margin_threshold": PERSON_AUTO_TAG_MIN_RUNNER_UP_MARGIN,
        "accepted": len(accepted),
        "correct": correct,
        "incorrect": len(accepted) - correct,
        "auto_tag_coverage": division(len(accepted), len(evaluable)),
        "auto_tag_precision": precision,
        "auto_tag_recall": recall,
    }


def summarize(**kwargs: Any) -> dict[str, Any]:
    summary = summarize_cross_age(**kwargs)
    summary["protocol"].update(
        {
            "identity": "numeric personID parsed from imageID-personID-age filename",
            "source_order": "ascending age, then natural filename order",
        }
    )
    summary["closed_set"] = _add_tagging_metrics(summary["closed_set"])
    decision_counts: dict[str, int] = {}
    for row in kwargs["results"]:
        if row.status == "ok":
            decision_counts[row.auto_tag_decision] = (
                decision_counts.get(row.auto_tag_decision, 0) + 1
            )
    summary["closed_set"]["auto_tag_decision_counts"] = dict(
        sorted(decision_counts.items())
    )
    summary["closed_set"]["leakage_excluded"] = _add_tagging_metrics(
        summary["closed_set"]["leakage_excluded"]
    )
    summary["reference_baseline"] = _add_tagging_metrics(summary["reference_baseline"])
    summary["policy_diagnostics"]["threshold_0_40"] = {
        "description": (
            "closed-set diagnostic using raw similarity >= 0.40 and the existing "
            "runner-up identity margin >= 0.06"
        ),
        **_threshold_policy_metrics(kwargs["results"], 0.40),
        "warning": (
            "not a deployment recommendation; validate unknown-person false accepts first"
        ),
    }
    summary["limitations"].update(
        {
            "open_set_false_accept_rate": (
                "not measured: every IFAD query belongs to an enrolled identity"
            ),
            "metric_semantics": (
                "auto-tag precision is correctness among accepted known-person tags; "
                "auto-tag recall is correct accepted tags divided by all evaluable known queries"
            ),
        }
    )
    return summary


def build_ifad_threshold_rows(results: Sequence[Any]) -> list[dict[str, Any]]:
    rows = build_threshold_rows(results)
    for row in rows:
        precision = row["accepted_known_accuracy"]
        recall = division(row["known_correct"], row["known_total"])
        row["known_recall"] = recall
        row["known_f1"] = (
            division(2 * precision * recall, precision + recall)
            if precision is not None and recall is not None and precision + recall > 0
            else 0.0
        )
    return rows


def _bucket_recall(row: dict[str, Any]) -> float | None:
    coverage = row["auto_tag_coverage"]
    precision = row["accepted_accuracy"]
    if coverage is None or precision is None:
        return None
    return coverage * precision


def write_markdown_report(
    *,
    path: Path,
    summary: dict[str, Any],
    threshold_rows: Sequence[dict[str, Any]],
    confusion_rows: Sequence[dict[str, Any]],
) -> None:
    closed = summary["closed_set"]
    baseline = summary["reference_baseline"]
    dataset = summary["dataset"]
    support_candidate = summary["policy_diagnostics"]["support_aware_candidate"]
    two_support_candidate = summary["policy_diagnostics"][
        "require_two_supporting_references"
    ]
    threshold_0_40 = summary["policy_diagnostics"]["threshold_0_40"]
    selection_example = {
        1: "position 3 is the reference and the other five are queries",
        2: "positions 1 and 5 are references and the other four are queries",
        3: "positions 1, 3, and 5 are references and positions 2, 4, and 6 are queries",
    }[dataset["references_per_person_requested"]]
    selected_thresholds = [
        row
        for row in threshold_rows
        if row["require_margin_0_06"] and row["threshold"] in {0.4, 0.5, 0.55, 0.6, 0.65}
    ]
    lines = [
        "# IFAD cross-age person-tagging benchmark",
        "",
        f"Generated: {summary['generated_at']}",
        "",
        "## Protocol",
        "",
        f"Images are grouped by person ID and sorted by age. Up to "
        f"{dataset['references_per_person_requested']} references are spread from the first "
        "through the penultimate position, and every unselected image is a query. For six "
        f"images, {selection_example}. Matching and automatic acceptance reproduce the "
        "current production identity-level policy.",
        "",
        "Because every query belongs to an enrolled identity, precision below means correct "
        "identity among accepted auto-tags; recall means correct accepted tags divided by all "
        "evaluable known-person queries. Coverage counts both correct and incorrect accepted tags.",
        "",
        "## Results",
        "",
        "| Measurement | Result |",
        "| --- | ---: |",
        f"| Source images | {dataset['source_images']} |",
        f"| Identities enrolled | {summary['embedding']['enrolled_identities']} / {dataset['discovered_identities']} |",
        f"| Valid reference images | {summary['embedding']['valid_reference_images']} |",
        f"| Evaluable tests | {closed['evaluable_queries']} / {closed['query_total']} |",
        f"| Rank-1 identification accuracy | {percent(closed['evaluable_rank1_accuracy'])} |",
        f"| Top-3 identification accuracy | {percent(closed['evaluable_top3_accuracy'])} |",
        f"| Top-5 identification accuracy | {percent(closed['evaluable_top5_accuracy'])} |",
        f"| Auto-tag coverage (`raw >= 0.55`, margin `>= 0.06`) | {percent(closed['auto_tag_coverage'])} |",
        f"| Auto-tag precision | {percent(closed['auto_tag_precision'])} |",
        f"| Auto-tag recall | {percent(closed['auto_tag_recall'])} |",
        f"| Auto-tag F1 | {percent(closed['auto_tag_f1'])} |",
        f"| Auto-tag coverage at raw `>= 0.40` (diagnostic) | {percent(threshold_0_40['auto_tag_coverage'])} |",
        f"| Auto-tag precision at raw `>= 0.40` (diagnostic) | {percent(threshold_0_40['auto_tag_precision'])} |",
        f"| Auto-tag recall at raw `>= 0.40` (diagnostic) | {percent(threshold_0_40['auto_tag_recall'])} |",
        f"| Incorrect accepted auto-tags | {closed['incorrect_auto_tags']} |",
        f"| Correct candidates rejected by auto-tag thresholds | {closed['correct_but_rejected']} |",
        f"| Queries below the candidate score floor | {closed['auto_tag_decision_counts'].get('no_candidate', 0)} |",
        f"| Rank-1, exact reference duplicates excluded | {percent(closed['leakage_excluded']['evaluable_rank1_accuracy'])} |",
        f"| Youngest-selected-reference-only rank-1 | {percent(baseline['evaluable_rank1_accuracy'])} |",
        f"| Youngest-selected-reference-only auto-tag recall | {percent(baseline['auto_tag_recall'])} |",
        "",
        "## Accuracy by minimum reference age gap",
        "",
        "| Gap | Tests | Rank-1 | Coverage | Precision | Recall | Mean true similarity |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for row in summary["age_gap_results"]:
        lines.append(
            f"| {row['bucket']} | {row['query_count']} | {percent(row['rank1_accuracy'])} | "
            f"{percent(row['auto_tag_coverage'])} | {percent(row['accepted_accuracy'])} | "
            f"{percent(_bucket_recall(row))} | {row['mean_true_similarity']:.3f} |"
        )
    lines.extend(
        [
            "",
            "## Policy diagnostics",
            "",
            f"The support-aware diagnostic accepts {support_candidate['accepted']} tests "
            f"({percent(support_candidate['coverage'])} coverage) at "
            f"{percent(support_candidate['accepted_accuracy'])} precision with "
            f"{support_candidate['incorrect']} errors.",
            "",
            f"Requiring at least two supporting references accepts "
            f"{two_support_candidate['accepted']} tests "
            f"({percent(two_support_candidate['coverage'])} coverage) at "
            f"{percent(two_support_candidate['accepted_accuracy'])} precision with "
            f"{two_support_candidate['incorrect']} errors. These closed-set diagnostics are "
            "not deployment recommendations until validated with unknown people.",
            "",
            "## Closed-set threshold diagnostics",
            "",
            "All rows retain the 0.06 identity margin.",
            "",
            "| Raw similarity | Coverage | Precision | Recall | F1 | Correct accepted |",
            "| ---: | ---: | ---: | ---: | ---: | ---: |",
        ]
    )
    for row in selected_thresholds:
        lines.append(
            f"| {row['threshold']:.2f} | {percent(row['known_coverage'])} | "
            f"{percent(row['accepted_known_accuracy'])} | {percent(row['known_recall'])} | "
            f"{percent(row['known_f1'])} | {row['known_correct']} |"
        )
    lines.extend(["", "## Data-quality checks", ""])
    lines.append(
        f"- {dataset['test_images_duplicating_a_reference']} test images are byte-identical "
        "to a reference image; leakage-excluded accuracy is reported above."
    )
    lines.append(
        f"- Duplicate-content groups among tests: {dataset['duplicate_test_content_groups']}."
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
            "IFAD is closed-set here, so this measures cross-age identification and "
            "known-person auto-tag precision/recall, not unknown-person false-accept rate. "
            "The deterministic split also does not quantify sensitivity to the individual "
            "reference choices. Use repeated splits and an open-set production-domain set "
            "before changing thresholds or the matching algorithm.",
            "",
        ]
    )
    path.write_text("\n".join(lines), encoding="utf-8")


def print_summary(summary: dict[str, Any]) -> None:
    closed = summary["closed_set"]
    print("\nIFAD cross-age person-tagging result")
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
        f"precision={closed['auto_tag_precision']}, "
        f"recall={closed['auto_tag_recall']}, "
        f"f1={closed['auto_tag_f1']}, "
        f"incorrect={closed['incorrect_auto_tags']}"
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

    run_name = args.run_name or datetime.now().strftime("ifad-%Y%m%d-%H%M%S")
    run_dir = args.output_root / run_name
    run_dir.mkdir(parents=True, exist_ok=True)
    threshold_rows = build_ifad_threshold_rows(results)
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
