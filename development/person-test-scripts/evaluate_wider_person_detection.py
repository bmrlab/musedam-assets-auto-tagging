#!/usr/bin/env python3
"""Evaluate deployed face detection with WIDER validation image-level counts.

WIDER FACE supplies bounding-box annotations and quality flags. This
benchmark deliberately discards positions and compares only the number of
annotations with the number of faces returned by ``/face_detection``.

Because faces are not spatially matched, the reported precision, recall, and
F1 are count proxies rather than conventional object-detection metrics:

    matched = min(ground_truth_count, predicted_count)
    false_positive = max(predicted_count - ground_truth_count, 0)
    false_negative = max(ground_truth_count - predicted_count, 0)

An over-detection and a missed face in the same image can cancel under this
protocol. Use a bounding-box benchmark when true localization precision and
recall are required.
"""

from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import json
import math
import mimetypes
import os
import random
import re
import ssl
import statistics
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from concurrent.futures import Future, ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Sequence

import certifi
from PIL import Image


DEFAULT_DATASET_ROOT = Path(
    "/Users/jayson/Downloads/Datasets/CrowdedPhotoDataset/wider-validation"
)
DEFAULT_OUTPUT_ROOT = Path(__file__).resolve().parent / "wider-person-detection-results"
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())


@dataclass(frozen=True)
class WiderImage:
    image_id: str
    category: str
    image_path: Path
    annotation_path: Path
    relative_path: str
    width: int
    height: int
    ground_truth_count: int
    raw_annotation_count: int
    invalid_annotation_count: int
    nonpositive_box_count: int
    face_widths: tuple[float, ...]
    face_heights: tuple[float, ...]
    image_sha256: str


@dataclass(frozen=True)
class DatasetManifest:
    images: tuple[WiderImage, ...]
    annotation_path: Path
    missing_images: tuple[str, ...]
    unmatched_images: tuple[str, ...]


@dataclass
class DetectionRecord:
    path: str
    image_sha256: str
    status: str
    predicted_count: int | None
    response_detection_count: int | None
    confidence_min: float | None
    confidence_mean: float | None
    confidence_max: float | None
    elapsed_ms: float
    error: str | None


@dataclass
class ImageResult:
    image_id: str
    category: str
    path: str
    annotation_path: str
    image_width: int
    image_height: int
    ground_truth_count: int
    raw_annotation_count: int
    invalid_annotation_count: int
    nonpositive_box_count: int
    median_face_width: float | None
    median_face_height: float | None
    faces_width_lt_8: int
    faces_width_lt_16: int
    faces_width_lt_32: int
    status: str
    predicted_count: int | None
    matched_count: int | None
    false_positive_count: int | None
    false_negative_count: int | None
    signed_error: int | None
    absolute_error: int | None
    relative_error: float | None
    exact_match: bool | None
    within_5_percent: bool | None
    within_10_percent: bool | None
    within_20_percent: bool | None
    count_proxy_precision: float | None
    count_proxy_recall: float | None
    count_proxy_f1: float | None
    response_detection_count: int | None
    confidence_min: float | None
    confidence_mean: float | None
    confidence_max: float | None
    elapsed_ms: float
    error: str | None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Evaluate deployed face counts on the WIDER FACE validation split.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--dataset-root", type=Path, default=DEFAULT_DATASET_ROOT)
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    parser.add_argument("--env-file", type=Path, default=Path(".env"))
    parser.add_argument("--api-url", default=None, help="Defaults to LOGO_DETECTION_SERVER_URL")
    parser.add_argument("--api-token", default=None, help="Defaults to LOGO_DETECTION_SERVER_TOKEN")
    parser.add_argument("--concurrency", type=int, default=4)
    parser.add_argument("--request-timeout", type=float, default=180.0)
    parser.add_argument("--request-retries", type=int, default=3)
    parser.add_argument("--max-images", type=int, default=None)
    parser.add_argument("--retry-failures", action="store_true")
    parser.add_argument("--force", action="store_true", help="Ignore cached API responses")
    parser.add_argument("--run-name", default=None)
    parser.add_argument("--progress-every", type=int, default=5)
    args = parser.parse_args()

    if args.concurrency < 1:
        parser.error("--concurrency must be at least 1")
    if args.request_timeout <= 0:
        parser.error("--request-timeout must be positive")
    if args.request_retries < 1:
        parser.error("--request-retries must be at least 1")
    if args.max_images is not None and args.max_images < 1:
        parser.error("--max-images must be at least 1")
    if args.progress_every < 1:
        parser.error("--progress-every must be at least 1")
    return args


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("\"").strip("'")
        if key:
            os.environ.setdefault(key, value)


def natural_key(value: str) -> tuple[Any, ...]:
    return tuple(int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", value))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_annotations(
    path: Path,
) -> list[tuple[str, int, int, int, tuple[float, ...], tuple[float, ...]]]:
    """Parse WIDER's image/count/box blocks.

    Returns relative image path, raw row count, invalid row count,
    nonpositive-size row count, and valid positive-size face widths/heights.
    The primary face count is therefore ``len(widths)``. Raw row counts are
    retained for a secondary, fully inclusive count report.
    """

    lines = path.read_text(encoding="utf-8-sig").splitlines()
    parsed: list[tuple[str, int, int, int, tuple[float, ...], tuple[float, ...]]] = []
    index = 0
    while index < len(lines):
        relative_path = lines[index].strip()
        index += 1
        if not relative_path:
            continue
        if index >= len(lines):
            raise ValueError(f"{path}:{index}: missing face count after {relative_path}")
        try:
            raw_count = int(lines[index].strip())
        except ValueError as error:
            raise ValueError(f"{path}:{index + 1}: invalid face count") from error
        index += 1
        if raw_count < 0:
            raise ValueError(f"{path}:{index}: face count must be nonnegative")

        valid_widths: list[float] = []
        valid_heights: list[float] = []
        invalid_count = 0
        nonpositive_count = 0
        for _ in range(raw_count):
            if index >= len(lines):
                raise ValueError(f"{path}: annotation block for {relative_path} is truncated")
            pieces = lines[index].split()
            line_number = index + 1
            index += 1
            if len(pieces) != 10:
                raise ValueError(
                    f"{path}:{line_number}: expected 10 WIDER annotation values, got {len(pieces)}"
                )
            try:
                values = [int(piece) for piece in pieces]
            except ValueError as error:
                raise ValueError(f"{path}:{line_number}: non-integer annotation") from error
            width, height = values[2], values[3]
            invalid = values[7] == 1
            if invalid:
                invalid_count += 1
            if width <= 0 or height <= 0:
                nonpositive_count += 1
            if not invalid and width > 0 and height > 0:
                valid_widths.append(float(width))
                valid_heights.append(float(height))
        parsed.append(
            (
                relative_path,
                raw_count,
                invalid_count,
                nonpositive_count,
                tuple(valid_widths),
                tuple(valid_heights),
            )
        )
    return parsed


def discover_dataset(dataset_root: Path) -> DatasetManifest:
    images_root = dataset_root / "images"
    annotation_path = dataset_root / "wider_face_split" / "wider_face_val_bbx_gt.txt"
    if not images_root.is_dir():
        raise FileNotFoundError(f"WIDER validation images directory not found: {images_root}")
    if not annotation_path.is_file():
        raise FileNotFoundError(f"WIDER validation annotation file not found: {annotation_path}")

    missing: list[str] = []
    items: list[WiderImage] = []
    annotated_relative_paths: set[str] = set()
    for relative, raw_count, invalid_count, nonpositive_count, widths, heights in parse_annotations(
        annotation_path
    ):
        annotated_relative_paths.add(relative)
        image_path = images_root / relative
        if not image_path.is_file():
            missing.append(relative)
            continue
        with Image.open(image_path) as image:
            width, height = image.size
        items.append(
            WiderImage(
                image_id=Path(relative).with_suffix("").as_posix(),
                category=Path(relative).parts[0],
                image_path=image_path,
                annotation_path=annotation_path,
                relative_path=image_path.relative_to(dataset_root).as_posix(),
                width=width,
                height=height,
                ground_truth_count=len(widths),
                raw_annotation_count=raw_count,
                invalid_annotation_count=invalid_count,
                nonpositive_box_count=nonpositive_count,
                face_widths=widths,
                face_heights=heights,
                image_sha256=sha256_file(image_path),
            )
        )

    actual_relative_paths = {
        path.relative_to(images_root).as_posix()
        for path in images_root.rglob("*")
        if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES
    }
    unmatched = sorted(
        actual_relative_paths - annotated_relative_paths,
        key=natural_key,
    )
    return DatasetManifest(
        tuple(items), annotation_path, tuple(sorted(missing, key=natural_key)), tuple(unmatched)
    )


def image_data_url(path: Path) -> str:
    mime_type = mimetypes.guess_type(path.name)[0] or "image/jpeg"
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


def safe_error_body(error: urllib.error.HTTPError) -> str:
    try:
        return error.read(1000).decode("utf-8", errors="replace")
    except Exception:
        return str(error.reason)


def call_face_api(
    *, api_url: str, api_token: str, payload: dict[str, Any], timeout: float, retries: int
) -> dict[str, Any]:
    endpoint = f"{api_url.rstrip('/')}/face_detection"
    body = json.dumps(payload).encode("utf-8")
    headers = {
        "Authorization": f"Bearer {api_token}",
        "Content-Type": "application/json",
        "User-Agent": "wider-face-count-evaluator/1.0",
    }
    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            request = urllib.request.Request(endpoint, data=body, headers=headers, method="POST")
            with urllib.request.urlopen(request, timeout=timeout, context=SSL_CONTEXT) as response:
                result = json.loads(response.read().decode("utf-8"))
                if not isinstance(result, dict):
                    raise ValueError("face API returned a non-object JSON response")
                return result
        except urllib.error.HTTPError as error:
            last_error = RuntimeError(f"HTTP {error.code}: {safe_error_body(error)}")
            if error.code < 500 and error.code != 429:
                raise last_error
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError) as error:
            last_error = error
        if attempt < retries:
            time.sleep(min(5.0, 0.4 * (2 ** (attempt - 1))) + random.random() * 0.2)
    raise RuntimeError(f"face API failed after {retries} attempts: {last_error}")


def parse_detection_response(payload: dict[str, Any]) -> tuple[int, int | None, list[float]]:
    detections = payload.get("detections")
    if detections is not None and not isinstance(detections, list):
        raise ValueError("response detections must be a list")
    response_detection_count = len(detections) if isinstance(detections, list) else None
    raw_face_count = payload.get("face_count")
    if raw_face_count is None:
        if response_detection_count is None:
            raise ValueError("response contains neither face_count nor detections")
        predicted_count = response_detection_count
    elif isinstance(raw_face_count, bool):
        raise ValueError("response face_count must be a nonnegative integer")
    else:
        predicted_count = int(raw_face_count)
        if float(raw_face_count) != predicted_count or predicted_count < 0:
            raise ValueError("response face_count must be a nonnegative integer")

    if response_detection_count is not None and predicted_count != response_detection_count:
        raise ValueError(
            f"response face_count ({predicted_count}) does not match detections length "
            f"({response_detection_count})"
        )

    confidences: list[float] = []
    for detection in detections or []:
        if not isinstance(detection, dict) or detection.get("confidence") is None:
            continue
        confidence = float(detection["confidence"])
        if math.isfinite(confidence):
            confidences.append(confidence)
    return predicted_count, response_detection_count, confidences


def detect_one(item: WiderImage, args: argparse.Namespace) -> DetectionRecord:
    started = time.perf_counter()
    try:
        payload = call_face_api(
            api_url=args.api_url,
            api_token=args.api_token,
            payload={"image_base64": image_data_url(item.image_path), "include_embedding": False},
            timeout=args.request_timeout,
            retries=args.request_retries,
        )
        predicted, response_count, confidences = parse_detection_response(payload)
        return DetectionRecord(
            path=item.relative_path,
            image_sha256=item.image_sha256,
            status="ok",
            predicted_count=predicted,
            response_detection_count=response_count,
            confidence_min=round(min(confidences), 6) if confidences else None,
            confidence_mean=round(statistics.fmean(confidences), 6) if confidences else None,
            confidence_max=round(max(confidences), 6) if confidences else None,
            elapsed_ms=round((time.perf_counter() - started) * 1000, 3),
            error=None,
        )
    except Exception as error:
        return DetectionRecord(
            path=item.relative_path,
            image_sha256=item.image_sha256,
            status="failed",
            predicted_count=None,
            response_detection_count=None,
            confidence_min=None,
            confidence_mean=None,
            confidence_max=None,
            elapsed_ms=round((time.perf_counter() - started) * 1000, 3),
            error=f"{type(error).__name__}: {error}",
        )


def load_cache(path: Path) -> dict[str, DetectionRecord]:
    records: dict[str, DetectionRecord] = {}
    if not path.exists():
        return records
    for line_number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not raw_line.strip():
            continue
        try:
            payload = json.loads(raw_line)
            record = DetectionRecord(**payload)
        except (json.JSONDecodeError, TypeError) as error:
            raise ValueError(f"Invalid cache row at {path}:{line_number}: {error}") from error
        records[record.path] = record
    return records


def append_cache(path: Path, record: DetectionRecord) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as destination:
        destination.write(json.dumps(asdict(record), sort_keys=True) + "\n")


def cache_path_for(output_root: Path, api_url: str) -> Path:
    parsed = urllib.parse.urlparse(api_url)
    host = parsed.netloc or parsed.path
    signature = hashlib.sha256(f"{host}|face_detection|original-bytes|no-embedding".encode()).hexdigest()[:12]
    return output_root / f"wider-face-count-cache-{signature}.jsonl"


def collect_detections(
    items: Sequence[WiderImage], args: argparse.Namespace, cache_path: Path
) -> dict[str, DetectionRecord]:
    cached = {} if args.force else load_cache(cache_path)
    records: dict[str, DetectionRecord] = {}
    pending: list[WiderImage] = []
    for item in items:
        existing = cached.get(item.relative_path)
        cache_valid = existing is not None and existing.image_sha256 == item.image_sha256
        if cache_valid and (existing.status == "ok" or not args.retry_failures):
            records[item.relative_path] = existing
        else:
            pending.append(item)

    if records:
        print(f"Reusing {len(records)} cached face-detection responses")
    if not pending:
        return records

    completed = 0
    with ThreadPoolExecutor(max_workers=args.concurrency) as executor:
        futures: dict[Future[DetectionRecord], WiderImage] = {
            executor.submit(detect_one, item, args): item for item in pending
        }
        for future in as_completed(futures):
            item = futures[future]
            try:
                record = future.result()
            except Exception as error:  # Defensive: detect_one normally captures failures.
                record = DetectionRecord(
                    path=item.relative_path,
                    image_sha256=item.image_sha256,
                    status="failed",
                    predicted_count=None,
                    response_detection_count=None,
                    confidence_min=None,
                    confidence_mean=None,
                    confidence_max=None,
                    elapsed_ms=0.0,
                    error=f"worker_failed: {type(error).__name__}: {error}",
                )
            records[item.relative_path] = record
            append_cache(cache_path, record)
            completed += 1
            if completed % args.progress_every == 0 or completed == len(pending):
                successes = sum(record.status == "ok" for record in records.values())
                print(f"Processed {completed}/{len(pending)} new images ({successes} total successes)")
    return records


def division(numerator: int | float, denominator: int | float) -> float | None:
    return round(float(numerator) / float(denominator), 6) if denominator else None


def harmonic_mean(precision: float | None, recall: float | None) -> float | None:
    if precision is None or recall is None or precision + recall == 0:
        return 0.0 if precision == 0 and recall == 0 else None
    return round(2 * precision * recall / (precision + recall), 6)


def distribution(values: Sequence[float | int]) -> dict[str, float | int | None]:
    if not values:
        return {"count": 0, "min": None, "median": None, "mean": None, "p90": None, "max": None}
    ordered = sorted(float(value) for value in values)
    p90_index = max(0, math.ceil(len(ordered) * 0.9) - 1)
    return {
        "count": len(ordered),
        "min": round(ordered[0], 6),
        "median": round(statistics.median(ordered), 6),
        "mean": round(statistics.fmean(ordered), 6),
        "p90": round(ordered[p90_index], 6),
        "max": round(ordered[-1], 6),
    }


def median_or_none(values: Sequence[float]) -> float | None:
    return round(statistics.median(values), 3) if values else None


def build_image_result(item: WiderImage, detection: DetectionRecord) -> ImageResult:
    common = {
        "image_id": item.image_id,
        "category": item.category,
        "path": item.relative_path,
        "annotation_path": item.annotation_path.as_posix(),
        "image_width": item.width,
        "image_height": item.height,
        "ground_truth_count": item.ground_truth_count,
        "raw_annotation_count": item.raw_annotation_count,
        "invalid_annotation_count": item.invalid_annotation_count,
        "nonpositive_box_count": item.nonpositive_box_count,
        "median_face_width": median_or_none(item.face_widths),
        "median_face_height": median_or_none(item.face_heights),
        "faces_width_lt_8": sum(width < 8 for width in item.face_widths),
        "faces_width_lt_16": sum(width < 16 for width in item.face_widths),
        "faces_width_lt_32": sum(width < 32 for width in item.face_widths),
        "status": detection.status,
        "response_detection_count": detection.response_detection_count,
        "confidence_min": detection.confidence_min,
        "confidence_mean": detection.confidence_mean,
        "confidence_max": detection.confidence_max,
        "elapsed_ms": detection.elapsed_ms,
        "error": detection.error,
    }
    if detection.status != "ok" or detection.predicted_count is None:
        return ImageResult(
            **common,
            predicted_count=None,
            matched_count=None,
            false_positive_count=None,
            false_negative_count=None,
            signed_error=None,
            absolute_error=None,
            relative_error=None,
            exact_match=None,
            within_5_percent=None,
            within_10_percent=None,
            within_20_percent=None,
            count_proxy_precision=None,
            count_proxy_recall=None,
            count_proxy_f1=None,
        )

    predicted = detection.predicted_count
    truth = item.ground_truth_count
    matched = min(predicted, truth)
    false_positive = max(predicted - truth, 0)
    false_negative = max(truth - predicted, 0)
    precision = division(matched, predicted)
    recall = division(matched, truth)
    if predicted == 0 and truth == 0:
        precision = recall = 1.0
    elif predicted == 0:
        precision = 0.0
    signed_error = predicted - truth
    relative_error = division(abs(signed_error), truth)
    within_5_percent = predicted == 0 if truth == 0 else relative_error <= 0.05
    within_10_percent = predicted == 0 if truth == 0 else relative_error <= 0.10
    within_20_percent = predicted == 0 if truth == 0 else relative_error <= 0.20
    return ImageResult(
        **common,
        predicted_count=predicted,
        matched_count=matched,
        false_positive_count=false_positive,
        false_negative_count=false_negative,
        signed_error=signed_error,
        absolute_error=abs(signed_error),
        relative_error=relative_error,
        exact_match=predicted == truth,
        within_5_percent=within_5_percent,
        within_10_percent=within_10_percent,
        within_20_percent=within_20_percent,
        count_proxy_precision=precision,
        count_proxy_recall=recall,
        count_proxy_f1=harmonic_mean(precision, recall),
    )


def metric_block(
    rows: Sequence[ImageResult], truth_field: str = "ground_truth_count"
) -> dict[str, Any]:
    evaluated = [row for row in rows if row.status == "ok" and row.predicted_count is not None]
    truths = [int(getattr(row, truth_field)) for row in evaluated]
    predictions = [int(row.predicted_count or 0) for row in evaluated]
    truth = sum(truths)
    predicted = sum(int(row.predicted_count or 0) for row in evaluated)
    matched = sum(min(prediction, target) for prediction, target in zip(predictions, truths, strict=True))
    false_positive = sum(
        max(prediction - target, 0) for prediction, target in zip(predictions, truths, strict=True)
    )
    false_negative = sum(
        max(target - prediction, 0) for prediction, target in zip(predictions, truths, strict=True)
    )
    precision = division(matched, predicted)
    recall = division(matched, truth)
    if predicted == 0 and truth > 0:
        precision = 0.0
    errors = [prediction - target for prediction, target in zip(predictions, truths, strict=True)]
    absolute_errors = [abs(error) for error in errors]
    relative_errors = [
        abs(error) / target for error, target in zip(errors, truths, strict=True) if target > 0
    ]
    exact_flags = [error == 0 for error in errors]
    within_5 = [error == 0 if target == 0 else abs(error) / target <= 0.05 for error, target in zip(errors, truths, strict=True)]
    within_10 = [error == 0 if target == 0 else abs(error) / target <= 0.10 for error, target in zip(errors, truths, strict=True)]
    within_20 = [error == 0 if target == 0 else abs(error) / target <= 0.20 for error, target in zip(errors, truths, strict=True)]
    return {
        "images": len(rows),
        "evaluated_images": len(evaluated),
        "ground_truth_faces": truth,
        "predicted_faces": predicted,
        "matched_count_proxy": matched,
        "false_positive_count_proxy": false_positive,
        "false_negative_count_proxy": false_negative,
        "count_proxy_precision": precision,
        "count_proxy_recall": recall,
        "count_proxy_f1": harmonic_mean(precision, recall),
        "exact_count_accuracy": division(sum(exact_flags), len(evaluated)),
        "within_5_percent_accuracy": division(sum(within_5), len(evaluated)),
        "within_10_percent_accuracy": division(sum(within_10), len(evaluated)),
        "within_20_percent_accuracy": division(sum(within_20), len(evaluated)),
        "mean_absolute_error": round(statistics.fmean(absolute_errors), 6) if absolute_errors else None,
        "root_mean_squared_error": (
            round(math.sqrt(statistics.fmean(error * error for error in errors)), 6) if errors else None
        ),
        "normalized_absolute_error": division(sum(absolute_errors), truth),
        "mean_absolute_percentage_error": (
            round(statistics.fmean(relative_errors), 6) if relative_errors else None
        ),
        "mean_signed_error": round(statistics.fmean(errors), 6) if errors else None,
        "count_ratio": division(predicted, truth),
        "under_count_images": sum(error < 0 for error in errors),
        "exact_count_images": sum(error == 0 for error in errors),
        "over_count_images": sum(error > 0 for error in errors),
    }


def density_bucket(ground_truth_count: int) -> str:
    if ground_truth_count <= 10:
        return "0-10"
    if ground_truth_count <= 25:
        return "11-25"
    if ground_truth_count <= 50:
        return "26-50"
    if ground_truth_count <= 100:
        return "51-100"
    return "101+"


def build_bucket_rows(rows: Sequence[ImageResult]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for label in ("0-10", "11-25", "26-50", "51-100", "101+"):
        bucket = [row for row in rows if density_bucket(row.ground_truth_count) == label]
        if bucket:
            result.append({"ground_truth_face_bucket": label, **metric_block(bucket)})
    return result


def detect_observed_cap(rows: Sequence[ImageResult]) -> dict[str, Any] | None:
    evaluated = [row for row in rows if row.status == "ok" and row.predicted_count is not None]
    if not evaluated:
        return None
    maximum = max(int(row.predicted_count or 0) for row in evaluated)
    at_maximum = [row for row in evaluated if row.predicted_count == maximum]
    truth_above_maximum = [row for row in evaluated if row.ground_truth_count > maximum]
    common = Counter(int(row.predicted_count or 0) for row in evaluated).most_common(10)
    likely_cap = (
        maximum > 0
        and len(at_maximum) >= 2
        and len(truth_above_maximum) >= 2
        and all(row.ground_truth_count >= maximum for row in at_maximum)
    )
    return {
        "observed_maximum_predicted_count": maximum,
        "images_at_observed_maximum": len(at_maximum),
        "images_with_ground_truth_above_observed_maximum": len(truth_above_maximum),
        "likely_output_cap": likely_cap,
        "most_common_predicted_counts": [
            {"predicted_count": count, "images": frequency} for count, frequency in common
        ],
    }


def summarize(
    manifest: DatasetManifest,
    selected: Sequence[WiderImage],
    rows: Sequence[ImageResult],
    args: argparse.Namespace,
) -> dict[str, Any]:
    evaluated = [row for row in rows if row.status == "ok"]
    metrics = metric_block(rows)
    raw_metrics = metric_block(rows, truth_field="raw_annotation_count")
    all_truth = sum(row.ground_truth_count for row in rows)
    operational_matched = sum(int(row.matched_count or 0) for row in rows)
    all_widths = [width for item in selected for width in item.face_widths]
    all_heights = [height for item in selected for height in item.face_heights]
    failures = [row for row in rows if row.status != "ok"]
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "protocol": {
            "dataset_root": str(args.dataset_root.resolve()),
            "images_directory": str((args.dataset_root / "images").resolve()),
            "annotation_file": str(manifest.annotation_path.resolve()),
            "api_host": urllib.parse.urlparse(args.api_url).netloc,
            "api_endpoint": "/face_detection",
            "input_encoding": "original image bytes as a data URL; no JPEG recompression",
            "include_embedding": False,
            "metric_definition": "image-level count proxy; no bounding-box matching",
            "primary_ground_truth": (
                "valid positive-size annotations (invalid=0, width>0, height>0)"
            ),
            "secondary_ground_truth": "all raw annotation rows",
            "selected_images": len(selected),
            "available_images_with_annotations": len(manifest.images),
        },
        "coverage": {
            "processing_coverage": division(len(evaluated), len(rows)),
            "face_found_coverage": division(
                sum((row.predicted_count or 0) > 0 for row in evaluated), len(evaluated)
            ),
            "successful_images": len(evaluated),
            "failed_images": len(failures),
            "selected_images": len(rows),
        },
        "metrics_on_successful_images": metrics,
        "metrics_against_all_raw_annotation_rows": raw_metrics,
        "operational_metrics_failures_as_zero_detections": {
            "ground_truth_faces": all_truth,
            "matched_count_proxy": operational_matched,
            "count_proxy_recall": division(operational_matched, all_truth),
        },
        "ground_truth_face_size": {
            "width_pixels": distribution(all_widths),
            "height_pixels": distribution(all_heights),
            "width_lt_8": sum(width < 8 for width in all_widths),
            "width_lt_16": sum(width < 16 for width in all_widths),
            "width_lt_32": sum(width < 32 for width in all_widths),
            "width_lt_8_fraction": division(sum(width < 8 for width in all_widths), len(all_widths)),
            "width_lt_16_fraction": division(sum(width < 16 for width in all_widths), len(all_widths)),
            "width_lt_32_fraction": division(sum(width < 32 for width in all_widths), len(all_widths)),
        },
        "latency_ms": distribution([row.elapsed_ms for row in rows]),
        "confidence": distribution(
            [row.confidence_mean for row in evaluated if row.confidence_mean is not None]
        ),
        "observed_saturation": detect_observed_cap(rows),
        "density_buckets": build_bucket_rows(rows),
        "data_quality": {
            "raw_annotation_rows": sum(item.raw_annotation_count for item in selected),
            "valid_positive_size_annotation_rows": sum(item.ground_truth_count for item in selected),
            "invalid_annotation_rows": sum(item.invalid_annotation_count for item in selected),
            "nonpositive_size_annotation_rows": sum(item.nonpositive_box_count for item in selected),
            "missing_image_files": list(manifest.missing_images),
            "unmatched_image_files": list(manifest.unmatched_images),
        },
    }


def format_percent(value: float | None) -> str:
    return "n/a" if value is None else f"{value * 100:.2f}%"


def format_number(value: float | int | None, digits: int = 2) -> str:
    if value is None:
        return "n/a"
    if isinstance(value, int):
        return f"{value:,}"
    return f"{value:,.{digits}f}"


def render_report(summary: dict[str, Any], rows: Sequence[ImageResult]) -> str:
    coverage = summary["coverage"]
    metrics = summary["metrics_on_successful_images"]
    raw_metrics = summary["metrics_against_all_raw_annotation_rows"]
    sizes = summary["ground_truth_face_size"]
    quality = summary["data_quality"]
    saturation = summary["observed_saturation"]
    lines = [
        "# WIDER FACE validation face-count benchmark",
        "",
        f"Generated: {summary['generated_at']}",
        "",
        "## Protocol",
        "",
        f"- Dataset: `{summary['protocol']['dataset_root']}`",
        f"- Images evaluated: {summary['protocol']['selected_images']} of "
        f"{summary['protocol']['available_images_with_annotations']}",
        "- Endpoint: `/face_detection` with `include_embedding=false`",
        "- Original image bytes were sent without JPEG recompression.",
        "- Primary ground truth excludes annotations flagged invalid and nonpositive-size boxes.",
        "- A secondary result includes every raw annotation row.",
        "- No bounding boxes are spatially matched.",
        "",
        "> **Metric limitation:** count-proxy precision/recall use "
        "`matched=min(predicted, ground truth)`. A false positive and a missed face "
        "in the same image can cancel, so these are not conventional object-detection metrics.",
        "",
        "## Results",
        "",
        "| Metric | Result |",
        "| --- | ---: |",
        f"| Processing coverage | {format_percent(coverage['processing_coverage'])} "
        f"({coverage['successful_images']}/{coverage['selected_images']}) |",
        f"| Face-found coverage | {format_percent(coverage['face_found_coverage'])} |",
        f"| Ground-truth faces (successful images) | {metrics['ground_truth_faces']:,} |",
        f"| Predicted faces | {metrics['predicted_faces']:,} |",
        f"| Predicted / ground-truth count ratio | {format_percent(metrics['count_ratio'])} |",
        f"| Count-proxy precision | {format_percent(metrics['count_proxy_precision'])} |",
        f"| Count-proxy recall | {format_percent(metrics['count_proxy_recall'])} |",
        f"| Count-proxy F1 | {format_percent(metrics['count_proxy_f1'])} |",
        f"| Exact-count accuracy | {format_percent(metrics['exact_count_accuracy'])} |",
        f"| Within 5% count accuracy | {format_percent(metrics['within_5_percent_accuracy'])} |",
        f"| Within 10% count accuracy | {format_percent(metrics['within_10_percent_accuracy'])} |",
        f"| Within 20% count accuracy | {format_percent(metrics['within_20_percent_accuracy'])} |",
        f"| Mean absolute error (faces/image) | {format_number(metrics['mean_absolute_error'])} |",
        f"| Root mean squared error | {format_number(metrics['root_mean_squared_error'])} |",
        f"| Normalized absolute error | {format_percent(metrics['normalized_absolute_error'])} |",
        f"| Mean signed error (prediction - truth) | {format_number(metrics['mean_signed_error'])} |",
        "",
        "## Secondary result against all raw annotation rows",
        "",
        "| Metric | Result |",
        "| --- | ---: |",
        f"| Raw annotation rows (successful images) | {raw_metrics['ground_truth_faces']:,} |",
        f"| Count-proxy precision | {format_percent(raw_metrics['count_proxy_precision'])} |",
        f"| Count-proxy recall | {format_percent(raw_metrics['count_proxy_recall'])} |",
        f"| Count-proxy F1 | {format_percent(raw_metrics['count_proxy_f1'])} |",
        f"| Exact-count accuracy | {format_percent(raw_metrics['exact_count_accuracy'])} |",
        f"| Within 20% count accuracy | {format_percent(raw_metrics['within_20_percent_accuracy'])} |",
        f"| Mean absolute error | {format_number(raw_metrics['mean_absolute_error'])} |",
        "",
        "## Results by crowd density",
        "",
        "| Ground-truth faces | Images | GT faces | Predicted | Precision proxy | Recall proxy | F1 proxy | MAE | Within 20% |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for bucket in summary["density_buckets"]:
        lines.append(
            f"| {bucket['ground_truth_face_bucket']} | {bucket['evaluated_images']} | "
            f"{bucket['ground_truth_faces']:,} | {bucket['predicted_faces']:,} | "
            f"{format_percent(bucket['count_proxy_precision'])} | "
            f"{format_percent(bucket['count_proxy_recall'])} | "
            f"{format_percent(bucket['count_proxy_f1'])} | "
            f"{format_number(bucket['mean_absolute_error'])} | "
            f"{format_percent(bucket['within_20_percent_accuracy'])} |"
        )

    lines.extend(
        [
            "",
            "## Diagnostic observations",
            "",
            f"- {format_percent(sizes['width_lt_8_fraction'])} of ground-truth faces are "
            f"under 8 px wide; {format_percent(sizes['width_lt_16_fraction'])} are under "
            f"16 px; {format_percent(sizes['width_lt_32_fraction'])} are under 32 px.",
            f"- Median annotated face width is {format_number(sizes['width_pixels']['median'])} px "
            f"and median height is {format_number(sizes['height_pixels']['median'])} px.",
        ]
    )
    if saturation:
        cap_wording = "A likely output cap was observed" if saturation["likely_output_cap"] else "No clear output cap was inferred"
        lines.append(
            f"- {cap_wording}: maximum predicted count "
            f"{saturation['observed_maximum_predicted_count']}, reached by "
            f"{saturation['images_at_observed_maximum']} image(s); "
            f"{saturation['images_with_ground_truth_above_observed_maximum']} successful "
            "image(s) have ground truth above that maximum."
        )

    hardest = sorted(
        (row for row in rows if row.status == "ok"),
        key=lambda row: (row.count_proxy_recall if row.count_proxy_recall is not None else 1.0, -(row.absolute_error or 0)),
    )[:10]
    lines.extend(
        [
            "",
            "## Lowest-recall images",
            "",
            "| Image | Ground truth | Predicted | Signed error | Recall proxy |",
            "| --- | ---: | ---: | ---: | ---: |",
        ]
    )
    for row in hardest:
        lines.append(
            f"| `{row.path}` | {row.ground_truth_count} | {row.predicted_count} | "
            f"{row.signed_error:+d} | {format_percent(row.count_proxy_recall)} |"
        )

    lines.extend(
        [
            "",
            "## Data quality and failures",
            "",
            f"- Raw annotation rows selected: {quality['raw_annotation_rows']:,}",
            f"- Primary valid positive-size faces: "
            f"{quality['valid_positive_size_annotation_rows']:,}",
            f"- Rows flagged invalid: {quality['invalid_annotation_rows']:,}",
            f"- Nonpositive-size rows: {quality['nonpositive_size_annotation_rows']:,}",
            f"- Missing image files: {len(quality['missing_image_files'])}",
            f"- Unmatched image files: {len(quality['unmatched_image_files'])}",
            f"- API failures: {coverage['failed_images']}",
            "",
            "## Interpretation and proposed experiments",
            "",
            "- Overall exact-count accuracy is dominated by sparse images; use the density "
            "rows when judging crowded-event performance.",
            "- The observed 100-face saturation is consistent with a detector output cap. "
            "First rerun an isolated benchmark deployment with a cap above the dataset maximum.",
            "- Small faces are the other major constraint. A/B test larger detector input sizes "
            "and overlapping native-resolution tiles, recording latency and GPU memory alongside accuracy.",
            "- After removing the cap, sweep the confidence threshold. Validate lower thresholds "
            "with spatial box matching because count-only precision can hide a miss and false positive "
            "that occur in the same image.",
            "- Treat this as an in-domain regression reference because common InsightFace detectors "
            "are trained with WIDER FACE; retain a separate production-event validation set.",
            "- These are proposed experiments only. This benchmark does not modify detector code, "
            "model weights, or runtime configuration.",
            "",
            "## How to interpret this benchmark",
            "",
            "Use recall proxy and count ratio to measure under-counting, tolerance accuracy and "
            "MAE to measure count usefulness, and processing coverage to expose API failures. "
            "Do not use this report to claim localization AP, IoU accuracy, or true face-level "
            "precision without running a separate bounding-box matching benchmark.",
            "",
        ]
    )
    return "\n".join(lines)


def write_csv(path: Path, rows: Iterable[dict[str, Any]], fieldnames: Sequence[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as destination:
        writer = csv.DictWriter(destination, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def safe_run_name(value: str | None) -> str:
    raw = value or datetime.now().strftime("%Y%m%d-%H%M%S")
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", raw).strip("-.")
    if not cleaned:
        raise ValueError("run name must contain at least one letter or number")
    return cleaned


def main() -> int:
    args = parse_args()
    load_env_file(args.env_file)
    args.api_url = args.api_url or os.environ.get("LOGO_DETECTION_SERVER_URL")
    args.api_token = args.api_token or os.environ.get("LOGO_DETECTION_SERVER_TOKEN")
    if not args.api_url:
        raise RuntimeError("Missing --api-url or LOGO_DETECTION_SERVER_URL")
    if not args.api_token:
        raise RuntimeError("Missing --api-token or LOGO_DETECTION_SERVER_TOKEN")

    manifest = discover_dataset(args.dataset_root)
    if manifest.missing_images:
        raise ValueError(
            f"{len(manifest.missing_images)} annotated images are missing: "
            + ", ".join(manifest.missing_images[:10])
        )
    selected = manifest.images[: args.max_images] if args.max_images else manifest.images
    print(
        f"Discovered {len(manifest.images)} WIDER validation images with "
        f"{sum(item.ground_truth_count for item in manifest.images):,} valid faces "
        f"({sum(item.raw_annotation_count for item in manifest.images):,} raw rows); "
        f"evaluating {len(selected)} images"
    )

    args.output_root.mkdir(parents=True, exist_ok=True)
    cache_path = cache_path_for(args.output_root, args.api_url)
    records = collect_detections(selected, args, cache_path)
    rows = [build_image_result(item, records[item.relative_path]) for item in selected]
    summary = summarize(manifest, selected, rows, args)

    run_dir = args.output_root / safe_run_name(args.run_name)
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "summary.json").write_text(
        json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    (run_dir / "report.md").write_text(render_report(summary, rows), encoding="utf-8")

    image_fields = list(ImageResult.__dataclass_fields__)
    write_csv(run_dir / "image-results.csv", (asdict(row) for row in rows), image_fields)
    bucket_rows = summary["density_buckets"]
    if bucket_rows:
        write_csv(run_dir / "bucket-results.csv", bucket_rows, list(bucket_rows[0]))
    failure_rows = [asdict(row) for row in rows if row.status != "ok"]
    write_csv(
        run_dir / "failures.csv",
        failure_rows,
        image_fields,
    )

    metrics = summary["metrics_on_successful_images"]
    coverage = summary["coverage"]
    print(f"Report: {run_dir / 'report.md'}")
    print(
        "Processing coverage "
        f"{format_percent(coverage['processing_coverage'])}; "
        f"count-proxy precision {format_percent(metrics['count_proxy_precision'])}; "
        f"recall {format_percent(metrics['count_proxy_recall'])}; "
        f"F1 {format_percent(metrics['count_proxy_f1'])}; "
        f"within-20% accuracy {format_percent(metrics['within_20_percent_accuracy'])}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
