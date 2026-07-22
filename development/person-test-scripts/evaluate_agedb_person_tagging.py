#!/usr/bin/env python3
"""Evaluate current person tagging on an AgeDB reference/test split.

The script does not write people or vectors to the application database. It
uses the deployed face API to obtain the same normalized 512-dimensional
embeddings as production, then reproduces the current identity-level matching
policy in memory:

* every valid image in ``reference/`` is enrolled for its filename identity;
* every valid image in ``test/`` is a known-person query;
* an identity's raw score is its best reference-image cosine similarity;
* references scoring at least 0.36 contribute the production support bonus;
* candidates are ranked per identity, not per reference image;
* automatic tagging requires raw similarity >= 0.55 and a runner-up margin
  >= 0.06.

Expected filename format: ``imageID_personName_age_sex.jpg``. The person-name
component may contain underscores or surrounding whitespace; it is normalized
with ``strip()``. Reports include age-gap buckets, exact split-leakage checks,
per-identity results, confusion pairs, threshold sweeps, and a first-reference
baseline computed from the same cached embeddings.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import statistics
import sys
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Sequence

import numpy as np

from evaluate_fiw_person_tagging import (
    EmbeddingRecord,
    IMAGE_SUFFIXES,
    cache_signature,
    collect_embeddings,
    distribution,
    division,
    load_env_file,
    natural_key,
    record_vector,
    relative_path,
    similarity_to_confidence,
    write_csv,
)


DEFAULT_DATASET_ROOT = Path(
    "/Users/jayson/Downloads/Datasets/AgeDataset/AgeDB_young_padded_split"
)
DEFAULT_OUTPUT_ROOT = Path(__file__).resolve().parent / "agedb-person-tagging-results"
FILENAME_PATTERN = re.compile(
    r"^(?P<image_id>\d+)_(?P<identity>.+)_(?P<age>\d+)_(?P<sex>[mf])(?P<suffix>\.[^.]+)$",
    re.IGNORECASE,
)

# Keep these values synchronized with src/lib/person/person-classification.ts
# and src/lib/person/person-match-policy.ts.
PERSON_VECTOR_CANDIDATE_SCORE_FLOOR = 0.25
PERSON_SUPPORTING_IMAGE_THRESHOLD = 0.36
PERSON_MULTI_IMAGE_SUPPORT_BONUS = 0.015
PERSON_MAX_SUPPORT_BONUS = 0.045
PERSON_CANDIDATE_IDENTITY_LIMIT = 24
PERSON_RETURNED_IDENTITY_LIMIT = 3
PERSON_AUTO_TAG_MIN_RAW_SIMILARITY = 0.55
PERSON_AUTO_TAG_MIN_RUNNER_UP_MARGIN = 0.06


@dataclass(frozen=True)
class AgeDbImage:
    path: Path
    image_id: int
    identity: str
    age: int
    sex: str
    split: str
    sha256: str


@dataclass(frozen=True)
class AgeDbIdentity:
    identity: str
    references: tuple[AgeDbImage, ...]
    tests: tuple[AgeDbImage, ...]


@dataclass(frozen=True)
class DatasetManifest:
    identities: tuple[AgeDbIdentity, ...]
    invalid_filenames: tuple[dict[str, str], ...]
    all_reference_count: int
    all_test_count: int


@dataclass
class QueryResult:
    path: str
    image_id: int
    true_identity: str
    true_age: int
    sex: str
    status: str
    predicted_identity: str
    predicted_reference: str
    predicted_reference_age: int | None
    runner_up_identity: str
    top1_raw_similarity: float | None
    top1_adjusted_similarity: float | None
    runner_up_raw_similarity: float | None
    raw_runner_up_margin: float | None
    true_identity_similarity: float | None
    true_identity_adjusted_similarity: float | None
    true_identity_rank: int | None
    true_best_reference: str
    true_best_reference_age: int | None
    reference_age_gap: int | None
    best_reference_age_gap: int | None
    valid_reference_count: int
    supporting_reference_count: int
    production_rank1_correct: bool
    top1_correct: bool
    top3_correct: bool
    top5_correct: bool
    confidence: int | None
    auto_tag_accept: bool
    auto_tag_decision: str
    duplicate_of_reference: str
    detection_count: int
    detection_score: float | None
    padding_ratio: float | None
    error: str | None


@dataclass(frozen=True)
class IdentityScore:
    identity: str
    raw_similarity: float
    adjusted_similarity: float
    supporting_reference_count: int
    best_reference: AgeDbImage


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Evaluate current multi-reference person tagging on AgeDB.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--dataset-root", type=Path, default=DEFAULT_DATASET_ROOT)
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    parser.add_argument("--env-file", type=Path, default=Path(".env"))
    parser.add_argument("--api-url", default=None, help="Defaults to LOGO_DETECTION_SERVER_URL")
    parser.add_argument("--api-token", default=None, help="Defaults to LOGO_DETECTION_SERVER_TOKEN")
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
            "Extra per-side borders tried in order. AgeDB_young_padded_split is already "
            "padded, so the original image is tried first"
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


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_agedb_filename(path: Path, split: str) -> AgeDbImage:
    match = FILENAME_PATTERN.fullmatch(path.name)
    if not match or path.suffix.lower() not in IMAGE_SUFFIXES:
        raise ValueError("expected imageID_personName_age_sex.<image-extension>")
    identity = match.group("identity").strip()
    if not identity:
        raise ValueError("personName is empty after trimming whitespace")
    return AgeDbImage(
        path=path,
        image_id=int(match.group("image_id")),
        identity=identity,
        age=int(match.group("age")),
        sex=match.group("sex").lower(),
        split=split,
        sha256=sha256_file(path),
    )


def discover_dataset(dataset_root: Path, max_identities: int | None = None) -> DatasetManifest:
    dataset_root = dataset_root.expanduser().resolve()
    split_images: dict[str, list[AgeDbImage]] = {"reference": [], "test": []}
    invalid: list[dict[str, str]] = []

    for split in ("reference", "test"):
        directory = dataset_root / split
        if not directory.is_dir():
            raise FileNotFoundError(f"AgeDB {split} directory not found: {directory}")
        candidates = sorted(
            (path for path in directory.iterdir() if path.is_file()),
            key=lambda path: natural_key(path.name),
        )
        for path in candidates:
            if path.suffix.lower() not in IMAGE_SUFFIXES:
                continue
            try:
                split_images[split].append(parse_agedb_filename(path, split))
            except ValueError as error:
                invalid.append(
                    {
                        "split": split,
                        "path": path.relative_to(dataset_root).as_posix(),
                        "error": str(error),
                    }
                )

    grouped: dict[str, dict[str, list[AgeDbImage]]] = {}
    for split, images in split_images.items():
        for image in images:
            grouped.setdefault(image.identity, {"reference": [], "test": []})[split].append(image)

    identity_names = sorted(grouped, key=natural_key)
    if max_identities is not None:
        identity_names = identity_names[:max_identities]
    identities = tuple(
        AgeDbIdentity(
            identity=name,
            references=tuple(sorted(grouped[name]["reference"], key=lambda image: image.image_id)),
            tests=tuple(sorted(grouped[name]["test"], key=lambda image: image.image_id)),
        )
        for name in identity_names
    )
    return DatasetManifest(
        identities=identities,
        invalid_filenames=tuple(invalid),
        all_reference_count=len(split_images["reference"]),
        all_test_count=len(split_images["test"]),
    )


def selected_tests(identities: Sequence[AgeDbIdentity], max_tests: int | None) -> list[AgeDbImage]:
    tests = [test for identity in identities for test in identity.tests]
    tests.sort(key=lambda image: natural_key(image.path.name))
    return tests if max_tests is None else tests[:max_tests]


def support_adjusted_similarity(raw_similarity: float, supporting_count: int) -> float:
    bonus = min(
        PERSON_MAX_SUPPORT_BONUS,
        max(0, supporting_count - 1) * PERSON_MULTI_IMAGE_SUPPORT_BONUS,
    )
    return min(0.99, raw_similarity + bonus)


def score_identity(
    *,
    identity: str,
    references: Sequence[tuple[AgeDbImage, np.ndarray]],
    query: np.ndarray,
) -> IdentityScore:
    scores = np.asarray([float(vector @ query) for _, vector in references], dtype=np.float64)
    best_index = int(np.argmax(scores))
    raw_similarity = float(scores[best_index])
    supporting_count = int(np.count_nonzero(scores >= PERSON_SUPPORTING_IMAGE_THRESHOLD))
    return IdentityScore(
        identity=identity,
        raw_similarity=raw_similarity,
        adjusted_similarity=support_adjusted_similarity(raw_similarity, supporting_count),
        supporting_reference_count=supporting_count,
        best_reference=references[best_index][0],
    )


def rank_identity_scores(scores: Sequence[IdentityScore]) -> list[IdentityScore]:
    return sorted(
        scores,
        key=lambda score: (
            -score.adjusted_similarity,
            -score.raw_similarity,
            natural_key(score.identity),
        ),
    )


def production_candidates(scores: Sequence[IdentityScore]) -> list[IdentityScore]:
    # SQL first takes the top 24 identity-level raw scores above the query floor;
    # TypeScript then applies support bonuses, re-sorts, and returns the top 3.
    raw_candidates = sorted(
        (score for score in scores if score.raw_similarity >= PERSON_VECTOR_CANDIDATE_SCORE_FLOOR),
        key=lambda score: (-score.raw_similarity, natural_key(score.identity)),
    )[:PERSON_CANDIDATE_IDENTITY_LIMIT]
    return rank_identity_scores(raw_candidates)[:PERSON_RETURNED_IDENTITY_LIMIT]


def auto_tag_decision(best: IdentityScore | None, runner_up: IdentityScore | None) -> tuple[bool, str, float | None]:
    if best is None:
        return False, "no_candidate", None
    margin = best.raw_similarity - (runner_up.raw_similarity if runner_up else 0.0)
    if best.raw_similarity < PERSON_AUTO_TAG_MIN_RAW_SIMILARITY:
        return False, "below_similarity_threshold", margin
    if runner_up is not None and margin < PERSON_AUTO_TAG_MIN_RUNNER_UP_MARGIN:
        return False, "ambiguous_runner_up", margin
    return True, "accepted", margin


def failed_query(
    *,
    image: AgeDbImage,
    dataset_root: Path,
    status: str,
    record: EmbeddingRecord | None,
    error: str,
    duplicate_of_reference: str = "",
) -> QueryResult:
    return QueryResult(
        path=relative_path(image.path, dataset_root),
        image_id=image.image_id,
        true_identity=image.identity,
        true_age=image.age,
        sex=image.sex,
        status=status,
        predicted_identity="",
        predicted_reference="",
        predicted_reference_age=None,
        runner_up_identity="",
        top1_raw_similarity=None,
        top1_adjusted_similarity=None,
        runner_up_raw_similarity=None,
        raw_runner_up_margin=None,
        true_identity_similarity=None,
        true_identity_adjusted_similarity=None,
        true_identity_rank=None,
        true_best_reference="",
        true_best_reference_age=None,
        reference_age_gap=None,
        best_reference_age_gap=None,
        valid_reference_count=0,
        supporting_reference_count=0,
        production_rank1_correct=False,
        top1_correct=False,
        top3_correct=False,
        top5_correct=False,
        confidence=None,
        auto_tag_accept=False,
        auto_tag_decision=status,
        duplicate_of_reference=duplicate_of_reference,
        detection_count=record.detection_count if record else 0,
        detection_score=record.detection_score if record else None,
        padding_ratio=record.padding_ratio if record else None,
        error=error,
    )


def classify_queries(
    *,
    identities: Sequence[AgeDbIdentity],
    tests: Sequence[AgeDbImage],
    records: dict[str, EmbeddingRecord],
    dataset_root: Path,
    max_references_per_identity: int | None = None,
) -> tuple[list[QueryResult], dict[str, Any]]:
    enrolled: dict[str, list[tuple[AgeDbImage, np.ndarray]]] = {}
    reference_failures: list[dict[str, Any]] = []
    reference_hashes: dict[str, list[AgeDbImage]] = {}

    for identity in identities:
        references = identity.references
        if max_references_per_identity is not None:
            references = references[:max_references_per_identity]
        valid: list[tuple[AgeDbImage, np.ndarray]] = []
        for reference in references:
            relative = relative_path(reference.path, dataset_root)
            record = records.get(relative)
            vector = record_vector(record)
            reference_hashes.setdefault(reference.sha256, []).append(reference)
            if vector is None:
                reference_failures.append(
                    {
                        "identity": identity.identity,
                        "reference": relative,
                        "age": reference.age,
                        "error": record.error if record else "missing_embedding_record",
                    }
                )
            else:
                valid.append((reference, vector))
        if valid:
            enrolled[identity.identity] = valid

    results: list[QueryResult] = []
    for image in tests:
        relative = relative_path(image.path, dataset_root)
        record = records.get(relative)
        query = record_vector(record)
        duplicate_references = reference_hashes.get(image.sha256, [])
        duplicate_of = (
            relative_path(duplicate_references[0].path, dataset_root) if duplicate_references else ""
        )
        if image.identity not in enrolled:
            results.append(
                failed_query(
                    image=image,
                    dataset_root=dataset_root,
                    status="enrollment_failed",
                    record=record,
                    error="no_valid_reference_embedding_for_identity",
                    duplicate_of_reference=duplicate_of,
                )
            )
            continue
        if query is None:
            results.append(
                failed_query(
                    image=image,
                    dataset_root=dataset_root,
                    status="query_embedding_failed",
                    record=record,
                    error=record.error if record else "missing_embedding_record",
                    duplicate_of_reference=duplicate_of,
                )
            )
            continue

        identity_scores = [
            score_identity(identity=name, references=references, query=query)
            for name, references in enrolled.items()
        ]
        ranked = rank_identity_scores(identity_scores)
        candidates = production_candidates(identity_scores)
        best = candidates[0] if candidates else None
        runner_up = candidates[1] if len(candidates) > 1 else None
        accepted, decision, margin = auto_tag_decision(best, runner_up)
        true_score = next(score for score in identity_scores if score.identity == image.identity)
        true_rank = next(index for index, score in enumerate(ranked, start=1) if score.identity == image.identity)
        predicted_identity = best.identity if best else ""
        true_references = enrolled[image.identity]
        min_age_gap = min(abs(image.age - reference.age) for reference, _ in true_references)

        results.append(
            QueryResult(
                path=relative,
                image_id=image.image_id,
                true_identity=image.identity,
                true_age=image.age,
                sex=image.sex,
                status="ok",
                predicted_identity=predicted_identity,
                predicted_reference=(
                    relative_path(best.best_reference.path, dataset_root) if best else ""
                ),
                predicted_reference_age=best.best_reference.age if best else None,
                runner_up_identity=runner_up.identity if runner_up else "",
                top1_raw_similarity=best.raw_similarity if best else None,
                top1_adjusted_similarity=best.adjusted_similarity if best else None,
                runner_up_raw_similarity=runner_up.raw_similarity if runner_up else None,
                raw_runner_up_margin=margin,
                true_identity_similarity=true_score.raw_similarity,
                true_identity_adjusted_similarity=true_score.adjusted_similarity,
                true_identity_rank=true_rank,
                true_best_reference=relative_path(true_score.best_reference.path, dataset_root),
                true_best_reference_age=true_score.best_reference.age,
                reference_age_gap=min_age_gap,
                best_reference_age_gap=abs(image.age - true_score.best_reference.age),
                valid_reference_count=len(true_references),
                supporting_reference_count=best.supporting_reference_count if best else 0,
                production_rank1_correct=ranked[0].identity == image.identity,
                top1_correct=predicted_identity == image.identity,
                top3_correct=true_rank <= 3,
                top5_correct=true_rank <= 5,
                confidence=(similarity_to_confidence(best.adjusted_similarity) if best else None),
                auto_tag_accept=accepted,
                auto_tag_decision=decision,
                duplicate_of_reference=duplicate_of,
                detection_count=record.detection_count,
                detection_score=record.detection_score,
                padding_ratio=record.padding_ratio,
                error=None,
            )
        )

    return results, {
        "enrolled_identities": len(enrolled),
        "reference_embedding_failures": reference_failures,
        "valid_reference_images": sum(len(references) for references in enrolled.values()),
        "max_references_per_identity": max_references_per_identity,
    }


def evaluation_metrics(results: Sequence[QueryResult]) -> dict[str, Any]:
    evaluable = [row for row in results if row.status == "ok"]
    accepted = [row for row in evaluable if row.auto_tag_accept]
    return {
        "query_total": len(results),
        "evaluable_queries": len(evaluable),
        "operational_rank1_accuracy": division(
            sum(row.production_rank1_correct for row in evaluable), len(results)
        ),
        "evaluable_rank1_accuracy": division(
            sum(row.production_rank1_correct for row in evaluable), len(evaluable)
        ),
        "evaluable_thresholded_top1_accuracy": division(
            sum(row.top1_correct for row in evaluable), len(evaluable)
        ),
        "evaluable_top3_accuracy": division(sum(row.top3_correct for row in evaluable), len(evaluable)),
        "evaluable_top5_accuracy": division(sum(row.top5_correct for row in evaluable), len(evaluable)),
        "auto_tag_accepted": len(accepted),
        "auto_tag_coverage": division(len(accepted), len(evaluable)),
        "auto_tag_accepted_accuracy": division(
            sum(row.top1_correct for row in accepted), len(accepted)
        ),
        "auto_tag_correct": sum(row.top1_correct for row in accepted),
        "correct_but_rejected": sum(row.top1_correct and not row.auto_tag_accept for row in evaluable),
        "incorrect_auto_tags": sum(not row.top1_correct for row in accepted),
    }


def acceptance_metrics(results: Sequence[QueryResult], predicate) -> dict[str, Any]:
    evaluable = [row for row in results if row.status == "ok"]
    accepted = [row for row in evaluable if predicate(row)]
    return {
        "accepted": len(accepted),
        "coverage": division(len(accepted), len(evaluable)),
        "accepted_accuracy": division(sum(row.top1_correct for row in accepted), len(accepted)),
        "correct": sum(row.top1_correct for row in accepted),
        "incorrect": sum(not row.top1_correct for row in accepted),
    }


def age_gap_bucket(gap: int | None) -> str:
    if gap is None:
        return "unavailable"
    if gap == 0:
        return "0_same_age"
    if gap <= 2:
        return "1-2_years"
    if gap <= 5:
        return "3-5_years"
    if gap <= 9:
        return "6-9_years"
    return "10+_years"


def build_bucket_rows(results: Sequence[QueryResult]) -> list[dict[str, Any]]:
    evaluable = [row for row in results if row.status == "ok"]
    dimensions: list[tuple[str, Any]] = [
        ("age_gap", lambda row: age_gap_bucket(row.reference_age_gap)),
        ("test_age", lambda row: str(row.true_age)),
        ("sex", lambda row: row.sex),
        ("reference_count", lambda row: str(row.valid_reference_count)),
        ("winning_support_count", lambda row: str(row.supporting_reference_count)),
        ("split_leakage", lambda row: "duplicate_reference" if row.duplicate_of_reference else "clean"),
    ]
    rows: list[dict[str, Any]] = []
    for dimension, selector in dimensions:
        grouped: dict[str, list[QueryResult]] = {}
        for row in evaluable:
            grouped.setdefault(selector(row), []).append(row)
        for bucket, members in sorted(grouped.items(), key=lambda item: natural_key(item[0])):
            accepted = [row for row in members if row.auto_tag_accept]
            rows.append(
                {
                    "dimension": dimension,
                    "bucket": bucket,
                    "query_count": len(members),
                    "rank1_accuracy": division(
                        sum(row.production_rank1_correct for row in members), len(members)
                    ),
                    "top3_accuracy": division(sum(row.top3_correct for row in members), len(members)),
                    "auto_tag_coverage": division(len(accepted), len(members)),
                    "accepted_accuracy": division(
                        sum(row.top1_correct for row in accepted), len(accepted)
                    ),
                    "mean_true_similarity": round(
                        statistics.fmean(
                            row.true_identity_similarity
                            for row in members
                            if row.true_identity_similarity is not None
                        ),
                        6,
                    ),
                }
            )
    return rows


def build_threshold_rows(results: Sequence[QueryResult]) -> list[dict[str, Any]]:
    evaluable = [row for row in results if row.status == "ok"]
    rows: list[dict[str, Any]] = []
    for threshold in np.arange(0.25, 0.701, 0.01):
        for require_margin in (False, True):
            accepted = [
                row
                for row in evaluable
                if row.top1_raw_similarity is not None
                and row.top1_raw_similarity >= threshold
                and (
                    not require_margin
                    or row.raw_runner_up_margin is not None
                    and row.raw_runner_up_margin >= PERSON_AUTO_TAG_MIN_RUNNER_UP_MARGIN
                )
            ]
            rows.append(
                {
                    "threshold": round(float(threshold), 2),
                    "require_margin_0_06": require_margin,
                    "known_total": len(evaluable),
                    "known_accepted": len(accepted),
                    "known_coverage": division(len(accepted), len(evaluable)),
                    "accepted_known_accuracy": division(
                        sum(row.top1_correct for row in accepted), len(accepted)
                    ),
                    "known_correct": sum(row.top1_correct for row in accepted),
                }
            )
    return rows


def build_identity_rows(
    identities: Sequence[AgeDbIdentity], results: Sequence[QueryResult]
) -> list[dict[str, Any]]:
    identity_map = {identity.identity: identity for identity in identities}
    grouped: dict[str, list[QueryResult]] = {}
    for row in results:
        grouped.setdefault(row.true_identity, []).append(row)
    rows: list[dict[str, Any]] = []
    for name, members in sorted(grouped.items(), key=lambda item: natural_key(item[0])):
        identity = identity_map[name]
        evaluable = [row for row in members if row.status == "ok"]
        accepted = [row for row in evaluable if row.auto_tag_accept]
        rows.append(
            {
                "identity": name,
                "reference_count": len(identity.references),
                "reference_ages": ",".join(str(image.age) for image in identity.references),
                "test_count": len(members),
                "evaluable_test_count": len(evaluable),
                "rank1_accuracy": division(
                    sum(row.production_rank1_correct for row in evaluable), len(evaluable)
                ),
                "top3_accuracy": division(sum(row.top3_correct for row in evaluable), len(evaluable)),
                "auto_tag_coverage": division(len(accepted), len(evaluable)),
                "accepted_accuracy": division(
                    sum(row.top1_correct for row in accepted), len(accepted)
                ),
                "mean_true_similarity": (
                    round(
                        statistics.fmean(
                            row.true_identity_similarity
                            for row in evaluable
                            if row.true_identity_similarity is not None
                        ),
                        6,
                    )
                    if evaluable
                    else None
                ),
                "max_reference_age_gap": max(
                    (row.reference_age_gap for row in evaluable if row.reference_age_gap is not None),
                    default=None,
                ),
                "exact_reference_duplicates": sum(bool(row.duplicate_of_reference) for row in members),
            }
        )
    return rows


def build_confusion_rows(results: Sequence[QueryResult]) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str], list[QueryResult]] = {}
    for row in results:
        if row.status == "ok" and not row.top1_correct and row.predicted_identity:
            grouped.setdefault((row.true_identity, row.predicted_identity), []).append(row)
    rows: list[dict[str, Any]] = []
    for (truth, prediction), members in grouped.items():
        rows.append(
            {
                "true_identity": truth,
                "predicted_identity": prediction,
                "count": len(members),
                "mean_top1_raw_similarity": round(
                    statistics.fmean(
                        row.top1_raw_similarity
                        for row in members
                        if row.top1_raw_similarity is not None
                    ),
                    6,
                ),
                "max_top1_raw_similarity": round(
                    max(row.top1_raw_similarity for row in members if row.top1_raw_similarity is not None),
                    6,
                ),
                "mean_age_gap": round(
                    statistics.fmean(
                        row.reference_age_gap
                        for row in members
                        if row.reference_age_gap is not None
                    ),
                    3,
                ),
                "auto_tagged_errors": sum(row.auto_tag_accept for row in members),
            }
        )
    return sorted(
        rows,
        key=lambda row: (-row["count"], -row["mean_top1_raw_similarity"], row["true_identity"]),
    )


def dataset_metadata(manifest: DatasetManifest, results: Sequence[QueryResult]) -> dict[str, Any]:
    identities = manifest.identities
    missing_references = [identity.identity for identity in identities if not identity.references]
    missing_tests = [identity.identity for identity in identities if not identity.tests]
    mixed_sex = []
    for identity in identities:
        labels = {image.sex for image in (*identity.references, *identity.tests)}
        if len(labels) > 1:
            mixed_sex.append(identity.identity)
    test_hash_counts: dict[str, int] = {}
    for identity in identities:
        for image in identity.tests:
            test_hash_counts[image.sha256] = test_hash_counts.get(image.sha256, 0) + 1
    return {
        "discovered_identities": len(identities),
        "reference_images": sum(len(identity.references) for identity in identities),
        "test_images": len(results),
        "unlimited_reference_images": manifest.all_reference_count,
        "unlimited_test_images": manifest.all_test_count,
        "identities_missing_references": missing_references,
        "identities_missing_tests": missing_tests,
        "invalid_filename_count": len(manifest.invalid_filenames),
        "mixed_sex_label_identities": mixed_sex,
        "test_images_duplicating_a_reference": sum(bool(row.duplicate_of_reference) for row in results),
        "duplicate_test_content_groups": sum(count > 1 for count in test_hash_counts.values()),
    }


def summarize(
    *,
    manifest: DatasetManifest,
    results: Sequence[QueryResult],
    baseline_results: Sequence[QueryResult],
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
            "identity": "trimmed personName parsed from imageID_personName_age_sex filename",
            "references": "all valid immediate images in reference/",
            "queries": "all valid immediate images in test/",
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
        "dataset": dataset_metadata(manifest, results),
        "embedding": {
            "model_names": sorted(
                {record.model_name for record in records.values() if record.status == "ok" and record.model_name}
            ),
            "cache_file": str(cache_path),
            "enrolled_identities": metadata["enrolled_identities"],
            "valid_reference_images": metadata["valid_reference_images"],
            "reference_embedding_failures": len(metadata["reference_embedding_failures"]),
            "query_embedding_failures": sum(row.status == "query_embedding_failed" for row in results),
        },
        "closed_set": {
            **evaluation_metrics(results),
            "leakage_excluded": evaluation_metrics(clean),
            "correct_top1_similarity": distribution(
                [row.top1_raw_similarity for row in correct if row.top1_raw_similarity is not None]
            ),
            "incorrect_top1_similarity": distribution(
                [row.top1_raw_similarity for row in incorrect if row.top1_raw_similarity is not None]
            ),
            "true_identity_similarity": distribution(
                [row.true_identity_similarity for row in evaluable if row.true_identity_similarity is not None]
            ),
            "correct_margin": distribution(
                [row.raw_runner_up_margin for row in correct if row.raw_runner_up_margin is not None]
            ),
            "incorrect_margin": distribution(
                [row.raw_runner_up_margin for row in incorrect if row.raw_runner_up_margin is not None]
            ),
        },
        "age_gap_results": [row for row in bucket_rows if row["dimension"] == "age_gap"],
        "reference_baseline": {
            "description": "same production matcher using only the first reference per identity",
            **evaluation_metrics(baseline_results),
            "valid_reference_images": baseline_metadata["valid_reference_images"],
        },
        "policy_diagnostics": {
            "support_aware_candidate": {
                "description": (
                    "raw >= 0.56 for a winner supported by one reference; raw >= 0.55 for "
                    "two or more supporting references; always require margin >= 0.06"
                ),
                **acceptance_metrics(
                    results,
                    lambda row: (
                        row.top1_raw_similarity is not None
                        and row.raw_runner_up_margin is not None
                        and row.raw_runner_up_margin >= PERSON_AUTO_TAG_MIN_RUNNER_UP_MARGIN
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
            }
        },
        "limitations": {
            "open_set_false_accept_rate": "not measured: this split contains no unknown identities",
            "threshold_tuning": "do not lower production thresholds from this closed-set benchmark alone",
        },
    }


def percent(value: float | None) -> str:
    return "n/a" if value is None else f"{value * 100:.2f}%"


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
    dataset = summary["dataset"]
    selected_thresholds = [
        row
        for row in threshold_rows
        if row["require_margin_0_06"] and row["threshold"] in {0.4, 0.5, 0.55, 0.6, 0.65}
    ]
    lines = [
        "# AgeDB cross-age person-tagging benchmark",
        "",
        f"Generated: {summary['generated_at']}",
        "",
        "## Protocol",
        "",
        "All images in `reference/` are enrolled and all images in `test/` are queried. "
        "Matching reproduces the current production identity-level max score, support bonus, "
        "and raw-similarity/margin acceptance policy.",
        "",
        "## Results",
        "",
        "| Measurement | Result |",
        "| --- | ---: |",
        f"| Identities enrolled | {summary['embedding']['enrolled_identities']} / {dataset['discovered_identities']} |",
        f"| Evaluable tests | {closed['evaluable_queries']} / {closed['query_total']} |",
        f"| Rank-1 accuracy | {percent(closed['evaluable_rank1_accuracy'])} |",
        f"| Top-3 accuracy | {percent(closed['evaluable_top3_accuracy'])} |",
        f"| Top-5 accuracy | {percent(closed['evaluable_top5_accuracy'])} |",
        f"| Auto-tag coverage (`raw >= 0.55`, margin `>= 0.06`) | {percent(closed['auto_tag_coverage'])} |",
        f"| Accuracy among accepted auto-tags | {percent(closed['auto_tag_accepted_accuracy'])} |",
        f"| Incorrect accepted auto-tags | {closed['incorrect_auto_tags']} |",
        f"| Rank-1 accuracy, exact reference duplicates excluded | {percent(closed['leakage_excluded']['evaluable_rank1_accuracy'])} |",
        f"| First-reference-only rank-1 baseline | {percent(baseline['evaluable_rank1_accuracy'])} |",
        f"| Support-aware candidate coverage (diagnostic only) | {percent(support_candidate['coverage'])} |",
        f"| Support-aware candidate accepted accuracy | {percent(support_candidate['accepted_accuracy'])} |",
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
            f"A closed-set candidate that uses raw `0.56` when only one reference supports the "
            f"winner and raw `0.55` when at least two references support it accepted "
            f"{support_candidate['accepted']} tests ({percent(support_candidate['coverage'])}) "
            f"with {percent(support_candidate['accepted_accuracy'])} accepted accuracy and "
            f"{support_candidate['incorrect']} errors. This is not a deployment recommendation "
            "until it passes an unknown-person benchmark.",
            "",
            "## Closed-set threshold diagnostics",
            "",
            "These rows do not measure unknown-person false accepts and are not sufficient for "
            "choosing a production threshold.",
            "",
            "| Raw similarity | Coverage with margin 0.06 | Accepted accuracy | Correct accepted |",
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
        f"- {dataset['test_images_duplicating_a_reference']} test images are byte-identical to a "
        "reference image; leakage-excluded accuracy is reported above."
    )
    lines.append(
        f"- {len(dataset['mixed_sex_label_identities'])} identities contain mixed filename sex labels: "
        f"{', '.join(dataset['mixed_sex_label_identities']) or 'none'}."
    )
    lines.append(f"- Invalid image filenames: {dataset['invalid_filename_count']}.")
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
            "## Limitation",
            "",
            "AgeDB is closed-set here: every test identity also exists in the gallery. It measures "
            "cross-age identification and auto-tag coverage/precision for known people, but it cannot "
            "measure unknown-person false-accept rate. Retain a separate open-set production-domain "
            "benchmark before changing acceptance thresholds.",
            "",
        ]
    )
    path.write_text("\n".join(lines), encoding="utf-8")


def print_summary(summary: dict[str, Any]) -> None:
    closed = summary["closed_set"]
    baseline = summary["reference_baseline"]
    print("\nAgeDB cross-age person-tagging result")
    print(
        f"  enrolled identities: {summary['embedding']['enrolled_identities']}/"
        f"{summary['dataset']['discovered_identities']}"
    )
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
    print(f"  first-reference baseline rank-1: {baseline['evaluable_rank1_accuracy']}")


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

    manifest = discover_dataset(args.dataset_root, args.max_identities)
    tests = selected_tests(manifest.identities, args.max_tests)
    paths = [reference.path for identity in manifest.identities for reference in identity.references]
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

    run_name = args.run_name or datetime.now().strftime("agedb-%Y%m%d-%H%M%S")
    run_dir = args.output_root / run_name
    run_dir.mkdir(parents=True, exist_ok=True)
    threshold_rows = build_threshold_rows(results)
    bucket_rows = build_bucket_rows(results)
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
