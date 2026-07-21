#!/usr/bin/env python3
"""Evaluate the person-tagging algorithm against the FIW face-crop dataset.

The evaluator intentionally does not write FIW identities into the application
database. It uses the deployed face API for the expensive/authoritative
InsightFace embedding step, then reproduces the application's one-reference
cosine matching, confidence calibration, and acceptance rules in memory.

Dataset protocol:
  * identity = <family folder>/<member folder>, for example F0010/MID1
  * enrollment image = the naturally-sorted first immediate image in MID*
  * known queries = every other immediate image in that MID* folder
  * optional unknown queries = immediate images in unrelated_and_nonfaces

FIW crops are tight enough that SCRFD often returns no face. To retain the
production model's landmark alignment, this script adds a plain border before
calling /face_detection with include_embedding=true. Multiple padding ratios
can be supplied; the first ratio that yields a valid embedding wins.
"""

from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import io
import json
import math
import os
import random
import re
import ssl
import statistics
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import Future, ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Sequence

import certifi
import numpy as np
from PIL import Image, ImageOps


DEFAULT_DATASET_ROOT = Path("/Users/jayson/Downloads/Datasets/Family Dataset/FIW Dataset")
DEFAULT_OUTPUT_ROOT = Path(__file__).resolve().parent / "fiw-person-tagging-results"
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
REFERENCE_QUERY_THRESHOLD = 0.25
CONFIDENT_HIGH_SIMILARITY = 0.55
CONFIDENT_LOW_SIMILARITY = 0.36
CONFIDENT_MIN_MARGIN = 0.06
REVIEW_MIN_CONFIDENCE = 60
EXPECTED_EMBEDDING_DIMENSION = 512
SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())
ARCFACE_LANDMARK_NAMES = ("left_eye", "right_eye", "nose_tip", "mouth_left", "mouth_right")
ARCFACE_CANONICAL_LANDMARKS = (
    (38.2946, 51.6963),
    (73.5318, 51.5014),
    (56.0252, 71.7366),
    (41.5493, 92.3655),
    (70.7299, 92.2041),
)


@dataclass(frozen=True)
class Member:
    family_id: str
    member_id: str
    identity: str
    images: tuple[Path, ...]

    @property
    def reference(self) -> Path:
        return self.images[0]

    @property
    def queries(self) -> tuple[Path, ...]:
        return self.images[1:]


@dataclass
class EmbeddingRecord:
    path: str
    status: str
    embedding: list[float] | None
    detection_count: int
    detection_score: float | None
    padding_ratio: float | None
    attempts: int
    model_name: str | None
    embedding_dimension: int | None
    elapsed_ms: float
    error: str | None


@dataclass
class QueryResult:
    kind: str
    path: str
    true_identity: str
    true_family_id: str
    status: str
    predicted_identity: str
    predicted_family_id: str
    top1_similarity: float | None
    second_similarity: float | None
    margin: float | None
    production_second_similarity: float | None
    production_margin: float | None
    true_similarity: float | None
    true_rank: int | None
    top1_correct: bool
    top3_correct: bool
    top5_correct: bool
    same_family_error: bool
    confidence: int | None
    production_confident_winner: bool
    current_direct_accept: bool
    review_accept: bool
    detection_count: int
    detection_score: float | None
    padding_ratio: float | None
    error: str | None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Evaluate FIW identities with the deployed InsightFace face API.",
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
            "padded-detect uses SCRFD and real landmarks; synthetic-landmarks skips detection "
            "and assumes each FIW crop already follows the canonical ArcFace layout"
        ),
    )
    parser.add_argument(
        "--padding-ratios",
        default="0.5,0.75,1.0",
        help="Per-side border ratios tried in order; 0 means the original crop",
    )
    parser.add_argument(
        "--padding-color",
        choices=("white", "black", "edge"),
        default="white",
    )
    parser.add_argument("--jpeg-quality", type=int, default=95)
    parser.add_argument("--concurrency", type=int, default=8)
    parser.add_argument("--request-timeout", type=float, default=90.0)
    parser.add_argument("--request-retries", type=int, default=3)
    parser.add_argument("--max-members", type=int, default=None)
    parser.add_argument("--max-queries", type=int, default=None)
    parser.add_argument("--include-unknown", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--unknown-limit", type=int, default=None)
    parser.add_argument("--retry-failures", action="store_true")
    parser.add_argument("--force", action="store_true", help="Ignore cached embeddings")
    parser.add_argument("--run-name", default=None)
    parser.add_argument("--progress-every", type=int, default=50)
    args = parser.parse_args()

    args.padding_ratios = tuple(float(item.strip()) for item in args.padding_ratios.split(","))
    if not args.padding_ratios or any(value < 0 for value in args.padding_ratios):
        parser.error("--padding-ratios must contain nonnegative numbers")
    if not 1 <= args.jpeg_quality <= 100:
        parser.error("--jpeg-quality must be between 1 and 100")
    if args.concurrency < 1:
        parser.error("--concurrency must be positive")
    if args.request_retries < 1:
        parser.error("--request-retries must be positive")
    return args


def load_env_file(path: Path) -> None:
    """Load a simple dotenv file without printing or overriding existing values."""
    if not path.is_file():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        key, separator, value = line.partition("=")
        if not separator or not key.strip():
            continue
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        os.environ.setdefault(key, value)


def natural_key(value: str) -> tuple[Any, ...]:
    return tuple(int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", value))


def immediate_images(directory: Path) -> tuple[Path, ...]:
    return tuple(
        sorted(
            (
                item
                for item in directory.iterdir()
                if item.is_file() and item.suffix.lower() in IMAGE_SUFFIXES
            ),
            key=lambda item: natural_key(item.name),
        )
    )


def discover_dataset(dataset_root: Path, max_members: int | None) -> tuple[list[Member], list[Path]]:
    fids_root = dataset_root / "FIDs"
    if not fids_root.is_dir():
        raise FileNotFoundError(f"FIW FIDs directory not found: {fids_root}")

    members: list[Member] = []
    unknowns: list[Path] = []
    for family_dir in sorted(
        (item for item in fids_root.iterdir() if item.is_dir() and re.fullmatch(r"F\d+", item.name)),
        key=lambda item: natural_key(item.name),
    ):
        member_dirs = sorted(
            (
                item
                for item in family_dir.iterdir()
                if item.is_dir() and re.fullmatch(r"MID\d+", item.name)
            ),
            key=lambda item: natural_key(item.name),
        )
        for member_dir in member_dirs:
            images = immediate_images(member_dir)
            if not images:
                continue
            members.append(
                Member(
                    family_id=family_dir.name,
                    member_id=member_dir.name,
                    identity=f"{family_dir.name}/{member_dir.name}",
                    images=images,
                )
            )

        unknown_dir = family_dir / "unrelated_and_nonfaces"
        if unknown_dir.is_dir():
            unknowns.extend(immediate_images(unknown_dir))

    if max_members is not None:
        members = members[:max_members]
    return members, sorted(unknowns, key=lambda item: natural_key(str(item)))


def relative_path(path: Path, dataset_root: Path) -> str:
    return path.resolve().relative_to(dataset_root.resolve()).as_posix()


def cache_signature(args: argparse.Namespace) -> str:
    parsed = urllib.parse.urlparse(args.api_url)
    signature_data = {
        "api_host": parsed.netloc,
        "padding_ratios": args.padding_ratios,
        "padding_color": args.padding_color,
        "jpeg_quality": args.jpeg_quality,
        "embedding_dimension": EXPECTED_EMBEDDING_DIMENSION,
    }
    # Preserve the original padded-detection cache key. Experimental modes must
    # never collide with production-compatible embeddings.
    if args.embedding_mode != "padded-detect":
        signature_data["embedding_mode"] = args.embedding_mode
    identity = json.dumps(signature_data, sort_keys=True)
    return hashlib.sha256(identity.encode("utf-8")).hexdigest()[:12]


def load_cache(path: Path) -> dict[str, EmbeddingRecord]:
    records: dict[str, EmbeddingRecord] = {}
    if not path.is_file():
        return records
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            try:
                raw = json.loads(line)
                records[raw["path"]] = EmbeddingRecord(**raw)
            except (KeyError, TypeError, json.JSONDecodeError) as error:
                print(f"warning: ignoring invalid cache line {line_number}: {error}", file=sys.stderr)
    return records


def padded_image(image: Image.Image, ratio: float, color: str) -> Image.Image:
    if ratio <= 0:
        return image.copy()
    horizontal = max(1, round(image.width * ratio))
    vertical = max(1, round(image.height * ratio))
    border = (horizontal, vertical, horizontal, vertical)
    if color == "edge":
        array = np.asarray(image.convert("RGB"))
        padded = np.pad(array, ((vertical, vertical), (horizontal, horizontal), (0, 0)), mode="edge")
        return Image.fromarray(padded, mode="RGB")
    fill = (255, 255, 255) if color == "white" else (0, 0, 0)
    return ImageOps.expand(image, border=border, fill=fill)


def image_data_url(image: Image.Image, quality: int) -> str:
    buffer = io.BytesIO()
    image.convert("RGB").save(buffer, format="JPEG", quality=quality, optimize=True)
    payload = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/jpeg;base64,{payload}"


def safe_error_body(error: urllib.error.HTTPError) -> str:
    try:
        return error.read(1000).decode("utf-8", errors="replace")
    except Exception:
        return ""


def call_face_api(
    *,
    api_url: str,
    api_token: str,
    endpoint_name: str,
    payload: dict[str, Any],
    timeout: float,
    retries: int,
) -> dict[str, Any]:
    endpoint = f"{api_url.rstrip('/')}/{endpoint_name.lstrip('/')}"
    body = json.dumps(payload).encode("utf-8")
    headers = {
        "Authorization": f"Bearer {api_token}",
        "Content-Type": "application/json",
        "User-Agent": "fiw-person-tagging-evaluator/1.0",
    }
    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            request = urllib.request.Request(endpoint, data=body, headers=headers, method="POST")
            with urllib.request.urlopen(request, timeout=timeout, context=SSL_CONTEXT) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            last_error = RuntimeError(f"HTTP {error.code}: {safe_error_body(error)}")
            if error.code < 500 and error.code != 429:
                raise last_error
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            last_error = error
        if attempt < retries:
            time.sleep(min(5.0, 0.4 * (2 ** (attempt - 1))) + random.random() * 0.2)
    raise RuntimeError(f"face API failed after {retries} attempts: {last_error}")


def extract_embedding(payload: dict[str, Any]) -> tuple[list[float], int, float, str, int]:
    detections = payload.get("detections")
    if not isinstance(detections, list) or not detections:
        raise LookupError("no_face_detected")

    valid: list[tuple[float, dict[str, Any], list[float]]] = []
    for detection in detections:
        embedding = detection.get("embedding") if isinstance(detection, dict) else None
        vector = embedding.get("vector") if isinstance(embedding, dict) else None
        if not isinstance(vector, list) or len(vector) != EXPECTED_EMBEDDING_DIMENSION:
            continue
        score = float(detection.get("confidence") or 0.0)
        valid.append((score, embedding, [float(value) for value in vector]))
    if not valid:
        raise LookupError("detected_face_missing_512d_embedding")

    score, embedding, vector = max(valid, key=lambda item: item[0])
    array = np.asarray(vector, dtype=np.float32)
    norm = float(np.linalg.norm(array))
    if not math.isfinite(norm) or norm <= 0:
        raise ValueError("embedding_has_invalid_norm")
    array /= norm
    model_name = str(embedding.get("model_name") or "unknown")
    return array.astype(float).tolist(), len(detections), score, model_name, len(vector)


def extract_single_embedding(payload: dict[str, Any]) -> tuple[list[float], float, str, int]:
    embedding = payload.get("embedding")
    vector = embedding.get("vector") if isinstance(embedding, dict) else None
    if not isinstance(vector, list) or len(vector) != EXPECTED_EMBEDDING_DIMENSION:
        raise LookupError("response_missing_512d_embedding")
    array = np.asarray(vector, dtype=np.float32)
    norm = float(np.linalg.norm(array))
    if not math.isfinite(norm) or norm <= 0:
        raise ValueError("embedding_has_invalid_norm")
    array /= norm
    score = float(payload.get("confidence") or 1.0)
    model_name = str(embedding.get("model_name") or "unknown")
    return array.astype(float).tolist(), score, model_name, len(vector)


def synthetic_arcface_landmarks(image: Image.Image) -> list[dict[str, float | str]]:
    scale_x = image.width / 112.0
    scale_y = image.height / 112.0
    return [
        {"name": name, "x": x * scale_x, "y": y * scale_y}
        for name, (x, y) in zip(
            ARCFACE_LANDMARK_NAMES,
            ARCFACE_CANONICAL_LANDMARKS,
            strict=True,
        )
    ]


def embed_with_synthetic_landmarks(
    *,
    image: Image.Image,
    relative: str,
    args: argparse.Namespace,
    started: float,
) -> EmbeddingRecord:
    landmarks = synthetic_arcface_landmarks(image)
    face = {
        "bbox": {
            "x_min": 0.0,
            "y_min": 0.0,
            "x_max": float(image.width),
            "y_max": float(image.height),
            "width": float(image.width),
            "height": float(image.height),
        },
        "confidence": 1.0,
        "keypoints": landmarks,
        "landmarks_5": landmarks,
    }
    try:
        payload = call_face_api(
            api_url=args.api_url,
            api_token=args.api_token,
            endpoint_name="generate_face_embedding",
            payload={"image_base64": image_data_url(image, args.jpeg_quality), "face": face},
            timeout=args.request_timeout,
            retries=args.request_retries,
        )
        vector, score, model_name, dimension = extract_single_embedding(payload)
        return EmbeddingRecord(
            path=relative,
            status="ok",
            embedding=vector,
            detection_count=0,
            detection_score=score,
            padding_ratio=None,
            attempts=1,
            model_name=model_name,
            embedding_dimension=dimension,
            elapsed_ms=round((time.perf_counter() - started) * 1000, 3),
            error=None,
        )
    except Exception as error:
        return EmbeddingRecord(
            path=relative,
            status="failed",
            embedding=None,
            detection_count=0,
            detection_score=None,
            padding_ratio=None,
            attempts=1,
            model_name=None,
            embedding_dimension=None,
            elapsed_ms=round((time.perf_counter() - started) * 1000, 3),
            error=f"{type(error).__name__}: {error}",
        )


def embed_one(
    path: Path,
    relative: str,
    args: argparse.Namespace,
) -> EmbeddingRecord:
    started = time.perf_counter()
    request_attempts = 0
    last_error: str | None = None
    last_detection_count = 0
    try:
        with Image.open(path) as source:
            image = source.convert("RGB")
    except Exception as error:
        return EmbeddingRecord(
            path=relative,
            status="failed",
            embedding=None,
            detection_count=0,
            detection_score=None,
            padding_ratio=None,
            attempts=0,
            model_name=None,
            embedding_dimension=None,
            elapsed_ms=round((time.perf_counter() - started) * 1000, 3),
            error=f"image_load_failed: {error}",
        )

    if args.embedding_mode == "synthetic-landmarks":
        return embed_with_synthetic_landmarks(
            image=image,
            relative=relative,
            args=args,
            started=started,
        )

    for ratio in args.padding_ratios:
        request_attempts += 1
        try:
            prepared = padded_image(image, ratio, args.padding_color)
            payload = call_face_api(
                api_url=args.api_url,
                api_token=args.api_token,
                endpoint_name="face_detection",
                payload={
                    "image_base64": image_data_url(prepared, args.jpeg_quality),
                    "include_embedding": True,
                },
                timeout=args.request_timeout,
                retries=args.request_retries,
            )
            detections = payload.get("detections")
            last_detection_count = len(detections) if isinstance(detections, list) else 0
            vector, count, score, model_name, dimension = extract_embedding(payload)
            return EmbeddingRecord(
                path=relative,
                status="ok",
                embedding=vector,
                detection_count=count,
                detection_score=score,
                padding_ratio=ratio,
                attempts=request_attempts,
                model_name=model_name,
                embedding_dimension=dimension,
                elapsed_ms=round((time.perf_counter() - started) * 1000, 3),
                error=None,
            )
        except LookupError as error:
            last_error = str(error)
        except Exception as error:
            last_error = f"{type(error).__name__}: {error}"
            break

    return EmbeddingRecord(
        path=relative,
        status="failed",
        embedding=None,
        detection_count=last_detection_count,
        detection_score=None,
        padding_ratio=None,
        attempts=request_attempts,
        model_name=None,
        embedding_dimension=None,
        elapsed_ms=round((time.perf_counter() - started) * 1000, 3),
        error=last_error or "embedding_failed",
    )


def collect_embeddings(
    *,
    paths: Sequence[Path],
    dataset_root: Path,
    cache_path: Path,
    args: argparse.Namespace,
) -> dict[str, EmbeddingRecord]:
    cached = {} if args.force else load_cache(cache_path)
    unique_paths = list(dict.fromkeys(path.resolve() for path in paths))
    pending: list[tuple[Path, str]] = []
    for path in unique_paths:
        relative = relative_path(path, dataset_root)
        record = cached.get(relative)
        if record is None or (args.retry_failures and record.status != "ok"):
            pending.append((path, relative))

    print(
        f"embedding cache: {len(unique_paths) - len(pending)} reused, "
        f"{len(pending)} API requests pending (up to {len(args.padding_ratios)} calls each)"
    )
    if not pending:
        return cached

    cache_path.parent.mkdir(parents=True, exist_ok=True)
    append_lock = threading.Lock()
    completed = 0
    ok_count = 0
    failure_count = 0
    started = time.perf_counter()

    def persist(record: EmbeddingRecord) -> None:
        line = json.dumps(asdict(record), ensure_ascii=False, separators=(",", ":"))
        with append_lock:
            with cache_path.open("a", encoding="utf-8") as handle:
                handle.write(line + "\n")

    with ThreadPoolExecutor(max_workers=args.concurrency, thread_name_prefix="fiw-face-api") as pool:
        futures: dict[Future[EmbeddingRecord], str] = {
            pool.submit(embed_one, path, relative, args): relative for path, relative in pending
        }
        for future in as_completed(futures):
            relative = futures[future]
            try:
                record = future.result()
            except Exception as error:
                record = EmbeddingRecord(
                    path=relative,
                    status="failed",
                    embedding=None,
                    detection_count=0,
                    detection_score=None,
                    padding_ratio=None,
                    attempts=0,
                    model_name=None,
                    embedding_dimension=None,
                    elapsed_ms=0.0,
                    error=f"worker_failed: {type(error).__name__}: {error}",
                )
            cached[relative] = record
            persist(record)
            completed += 1
            if record.status == "ok":
                ok_count += 1
            else:
                failure_count += 1
            if completed % args.progress_every == 0 or completed == len(pending):
                elapsed = max(0.001, time.perf_counter() - started)
                print(
                    f"embedded {completed}/{len(pending)}: ok={ok_count}, failed={failure_count}, "
                    f"rate={completed / elapsed:.2f} images/s"
                )
    return cached


def similarity_to_confidence(similarity: float) -> int:
    calibrated = 1.0 / (1.0 + math.exp(-12.0 * (similarity - 0.38)))
    return max(0, min(100, round(calibrated * 100.0)))


def confident_winner(best: float, second: float) -> bool:
    if best >= CONFIDENT_HIGH_SIMILARITY:
        return True
    if best < CONFIDENT_LOW_SIMILARITY:
        return False
    return best - second >= CONFIDENT_MIN_MARGIN


def record_vector(record: EmbeddingRecord | None) -> np.ndarray | None:
    if record is None or record.status != "ok" or record.embedding is None:
        return None
    vector = np.asarray(record.embedding, dtype=np.float32)
    if vector.shape != (EXPECTED_EMBEDDING_DIMENSION,):
        return None
    norm = float(np.linalg.norm(vector))
    if norm <= 0 or not math.isfinite(norm):
        return None
    return vector / norm


def percentile(values: Sequence[float], q: float) -> float | None:
    if not values:
        return None
    return round(float(np.percentile(np.asarray(values, dtype=np.float64), q)), 6)


def distribution(values: Sequence[float]) -> dict[str, float | int | None]:
    if not values:
        return {"count": 0, "min": None, "p05": None, "p50": None, "p95": None, "max": None}
    return {
        "count": len(values),
        "min": round(min(values), 6),
        "p05": percentile(values, 5),
        "p50": percentile(values, 50),
        "p95": percentile(values, 95),
        "max": round(max(values), 6),
    }


def make_failed_query(
    *,
    kind: str,
    path: str,
    identity: str,
    family_id: str,
    status: str,
    embedding_record: EmbeddingRecord | None,
    error: str,
) -> QueryResult:
    return QueryResult(
        kind=kind,
        path=path,
        true_identity=identity,
        true_family_id=family_id,
        status=status,
        predicted_identity="",
        predicted_family_id="",
        top1_similarity=None,
        second_similarity=None,
        margin=None,
        production_second_similarity=None,
        production_margin=None,
        true_similarity=None,
        true_rank=None,
        top1_correct=False,
        top3_correct=False,
        top5_correct=False,
        same_family_error=False,
        confidence=None,
        production_confident_winner=False,
        current_direct_accept=False,
        review_accept=False,
        detection_count=embedding_record.detection_count if embedding_record else 0,
        detection_score=embedding_record.detection_score if embedding_record else None,
        padding_ratio=embedding_record.padding_ratio if embedding_record else None,
        error=error,
    )


def classify_queries(
    *,
    members: Sequence[Member],
    unknown_paths: Sequence[Path],
    records: dict[str, EmbeddingRecord],
    dataset_root: Path,
    max_queries: int | None,
) -> tuple[list[QueryResult], dict[str, Any]]:
    enrolled_labels: list[str] = []
    enrolled_families: list[str] = []
    enrolled_vectors: list[np.ndarray] = []
    enrollment_failures: list[dict[str, str]] = []
    member_by_identity = {member.identity: member for member in members}

    for member in members:
        relative = relative_path(member.reference, dataset_root)
        record = records.get(relative)
        vector = record_vector(record)
        if vector is None:
            enrollment_failures.append(
                {
                    "identity": member.identity,
                    "reference": relative,
                    "error": record.error if record else "missing_embedding_record",
                }
            )
            continue
        enrolled_labels.append(member.identity)
        enrolled_families.append(member.family_id)
        enrolled_vectors.append(vector)

    if not enrolled_vectors:
        raise RuntimeError("No reference embeddings were produced")
    gallery = np.stack(enrolled_vectors, axis=0)
    label_to_index = {label: index for index, label in enumerate(enrolled_labels)}

    known_samples: list[tuple[Path, str, str]] = []
    for member in members:
        known_samples.extend((path, member.identity, member.family_id) for path in member.queries)
    if max_queries is not None:
        known_samples = known_samples[:max_queries]

    results: list[QueryResult] = []
    for path, identity, family_id in known_samples:
        relative = relative_path(path, dataset_root)
        record = records.get(relative)
        query = record_vector(record)
        if identity not in label_to_index:
            results.append(
                make_failed_query(
                    kind="known",
                    path=relative,
                    identity=identity,
                    family_id=family_id,
                    status="enrollment_failed",
                    embedding_record=record,
                    error="reference_embedding_unavailable",
                )
            )
            continue
        if query is None:
            results.append(
                make_failed_query(
                    kind="known",
                    path=relative,
                    identity=identity,
                    family_id=family_id,
                    status="query_embedding_failed",
                    embedding_record=record,
                    error=record.error if record else "missing_embedding_record",
                )
            )
            continue

        scores = gallery @ query
        order = np.argsort(-scores, kind="stable")
        best_index = int(order[0])
        best_score = float(scores[best_index])
        raw_second_score = float(scores[int(order[1])]) if len(order) > 1 else 0.0
        threshold_candidates = [int(index) for index in order if scores[index] >= REFERENCE_QUERY_THRESHOLD]
        production_second_score = (
            float(scores[threshold_candidates[1]]) if len(threshold_candidates) > 1 else 0.0
        )
        predicted_identity = enrolled_labels[best_index] if best_score >= REFERENCE_QUERY_THRESHOLD else ""
        predicted_family = enrolled_families[best_index] if predicted_identity else ""
        true_index = label_to_index[identity]
        true_score = float(scores[true_index])
        true_rank = int(np.where(order == true_index)[0][0]) + 1
        top1_correct = predicted_identity == identity
        confidence = similarity_to_confidence(best_score)

        results.append(
            QueryResult(
                kind="known",
                path=relative,
                true_identity=identity,
                true_family_id=family_id,
                status="ok",
                predicted_identity=predicted_identity,
                predicted_family_id=predicted_family,
                top1_similarity=best_score,
                second_similarity=raw_second_score,
                margin=best_score - raw_second_score,
                production_second_similarity=production_second_score,
                production_margin=best_score - production_second_score,
                true_similarity=true_score,
                true_rank=true_rank,
                top1_correct=top1_correct,
                top3_correct=true_rank <= 3,
                top5_correct=true_rank <= 5,
                same_family_error=(not top1_correct and predicted_family == family_id),
                confidence=confidence,
                production_confident_winner=(
                    best_score >= REFERENCE_QUERY_THRESHOLD
                    and confident_winner(best_score, production_second_score)
                ),
                current_direct_accept=best_score >= REFERENCE_QUERY_THRESHOLD,
                review_accept=confidence >= REVIEW_MIN_CONFIDENCE,
                detection_count=record.detection_count if record else 0,
                detection_score=record.detection_score if record else None,
                padding_ratio=record.padding_ratio if record else None,
                error=None,
            )
        )

    for path in unknown_paths:
        relative = relative_path(path, dataset_root)
        record = records.get(relative)
        query = record_vector(record)
        if query is None:
            results.append(
                make_failed_query(
                    kind="unknown",
                    path=relative,
                    identity="__unknown__",
                    family_id=path.parent.parent.name,
                    status="query_embedding_failed",
                    embedding_record=record,
                    error=record.error if record else "missing_embedding_record",
                )
            )
            continue
        scores = gallery @ query
        order = np.argsort(-scores, kind="stable")
        best_index = int(order[0])
        best_score = float(scores[best_index])
        raw_second_score = float(scores[int(order[1])]) if len(order) > 1 else 0.0
        threshold_candidates = [int(index) for index in order if scores[index] >= REFERENCE_QUERY_THRESHOLD]
        production_second_score = (
            float(scores[threshold_candidates[1]]) if len(threshold_candidates) > 1 else 0.0
        )
        predicted_identity = enrolled_labels[best_index] if best_score >= REFERENCE_QUERY_THRESHOLD else ""
        predicted_family = enrolled_families[best_index] if predicted_identity else ""
        confidence = similarity_to_confidence(best_score)
        results.append(
            QueryResult(
                kind="unknown",
                path=relative,
                true_identity="__unknown__",
                true_family_id=path.parent.parent.name,
                status="ok",
                predicted_identity=predicted_identity,
                predicted_family_id=predicted_family,
                top1_similarity=best_score,
                second_similarity=raw_second_score,
                margin=best_score - raw_second_score,
                production_second_similarity=production_second_score,
                production_margin=best_score - production_second_score,
                true_similarity=None,
                true_rank=None,
                top1_correct=False,
                top3_correct=False,
                top5_correct=False,
                same_family_error=False,
                confidence=confidence,
                production_confident_winner=(
                    best_score >= REFERENCE_QUERY_THRESHOLD
                    and confident_winner(best_score, production_second_score)
                ),
                current_direct_accept=best_score >= REFERENCE_QUERY_THRESHOLD,
                review_accept=confidence >= REVIEW_MIN_CONFIDENCE,
                detection_count=record.detection_count if record else 0,
                detection_score=record.detection_score if record else None,
                padding_ratio=record.padding_ratio if record else None,
                error=None,
            )
        )

    metadata = {
        "discovered_members": len(members),
        "members_with_queries": sum(bool(member.queries) for member in members),
        "enrolled_members": len(enrolled_labels),
        "enrollment_failures": enrollment_failures,
        "gallery_dimension": int(gallery.shape[1]),
        "known_query_images": len(known_samples),
        "unknown_query_images": len(unknown_paths),
        "member_image_count": sum(len(member.images) for member in members),
        "identities_without_queries": [
            member.identity for member in member_by_identity.values() if not member.queries
        ],
    }
    return results, metadata


def division(numerator: int | float, denominator: int | float) -> float | None:
    if denominator == 0:
        return None
    return round(float(numerator) / float(denominator), 6)


def rule_metrics(
    known: Sequence[QueryResult],
    unknown: Sequence[QueryResult],
    predicate,
) -> dict[str, Any]:
    known_ok = [row for row in known if row.status == "ok"]
    unknown_ok = [row for row in unknown if row.status == "ok"]
    accepted_known = [row for row in known_ok if predicate(row)]
    accepted_unknown = [row for row in unknown_ok if predicate(row)]
    correct_known = sum(row.top1_correct for row in accepted_known)
    return {
        "known_accepted": len(accepted_known),
        "known_coverage": division(len(accepted_known), len(known_ok)),
        "accepted_known_accuracy": division(correct_known, len(accepted_known)),
        "known_correct": correct_known,
        "unknown_accepted": len(accepted_unknown),
        "unknown_false_accept_rate": division(len(accepted_unknown), len(unknown_ok)),
        "combined_accepted_precision": division(
            correct_known,
            len(accepted_known) + len(accepted_unknown),
        ),
    }


def build_threshold_rows(results: Sequence[QueryResult]) -> list[dict[str, Any]]:
    known = [row for row in results if row.kind == "known" and row.status == "ok"]
    unknown = [row for row in results if row.kind == "unknown" and row.status == "ok"]
    rows: list[dict[str, Any]] = []
    for threshold in np.arange(0.25, 0.701, 0.01):
        for require_margin in (False, True):
            def accepted(row: QueryResult) -> bool:
                score_ok = row.top1_similarity is not None and row.top1_similarity >= threshold
                # Use the actual second-nearest gallery identity. Production currently
                # replaces sub-0.25 second scores with zero before calculating margin.
                margin_ok = row.margin is not None and row.margin >= CONFIDENT_MIN_MARGIN
                return score_ok and (margin_ok if require_margin else True)

            metrics = rule_metrics(known, unknown, accepted)
            rows.append(
                {
                    "threshold": round(float(threshold), 2),
                    "require_margin_0_06": require_margin,
                    "known_total": len(known),
                    "unknown_total": len(unknown),
                    **metrics,
                }
            )
    return rows


def summarize(
    *,
    results: Sequence[QueryResult],
    metadata: dict[str, Any],
    args: argparse.Namespace,
    cache_path: Path,
) -> dict[str, Any]:
    known = [row for row in results if row.kind == "known"]
    unknown = [row for row in results if row.kind == "unknown"]
    known_ok = [row for row in known if row.status == "ok"]
    unknown_ok = [row for row in unknown if row.status == "ok"]
    correct = [row for row in known_ok if row.top1_correct]
    incorrect = [row for row in known_ok if not row.top1_correct]
    raw_rank1 = [row for row in known_ok if row.true_rank == 1]
    model_names = sorted(
        {
            record.model_name
            for record in load_cache(cache_path).values()
            if record.status == "ok" and record.model_name
        }
    )

    threshold_rows = build_threshold_rows(results)
    candidates_at_one_percent_far = [
        row
        for row in threshold_rows
        if row["require_margin_0_06"] is True
        and row["unknown_false_accept_rate"] is not None
        and row["unknown_false_accept_rate"] <= 0.01
    ]
    recommended = max(
        candidates_at_one_percent_far,
        key=lambda row: (row["known_correct"], row["known_coverage"] or 0),
        default=None,
    )

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "protocol": {
            "reference": "naturally sorted first immediate image per F*/MID*",
            "known_queries": "remaining immediate images in the same member folder",
            "unknown_queries": "immediate images under unrelated_and_nonfaces",
            "padding_ratios": list(args.padding_ratios),
            "padding_color": args.padding_color,
            "embedding_mode": args.embedding_mode,
            "jpeg_quality": args.jpeg_quality,
            "production_vector_threshold": REFERENCE_QUERY_THRESHOLD,
            "production_confident_high_similarity": CONFIDENT_HIGH_SIMILARITY,
            "production_confident_low_similarity": CONFIDENT_LOW_SIMILARITY,
            "production_confident_min_margin": CONFIDENT_MIN_MARGIN,
            "review_min_confidence": REVIEW_MIN_CONFIDENCE,
        },
        "dataset": metadata,
        "embedding": {
            "model_names": model_names,
            "cache_file": str(cache_path),
            "known_query_embedding_failures": sum(row.status != "ok" for row in known),
            "unknown_query_embedding_failures": sum(row.status != "ok" for row in unknown),
        },
        "closed_set": {
            "known_query_total": len(known),
            "evaluable_known_queries": len(known_ok),
            "operational_raw_rank1_accuracy": division(len(raw_rank1), len(known)),
            "evaluable_raw_rank1_accuracy": division(len(raw_rank1), len(known_ok)),
            "operational_thresholded_top1_accuracy": division(len(correct), len(known)),
            "evaluable_thresholded_top1_accuracy": division(len(correct), len(known_ok)),
            "evaluable_top3_accuracy": division(sum(row.top3_correct for row in known_ok), len(known_ok)),
            "evaluable_top5_accuracy": division(sum(row.top5_correct for row in known_ok), len(known_ok)),
            "same_family_share_of_errors": division(
                sum(row.same_family_error for row in incorrect), len(incorrect)
            ),
            "correct_top1_similarity": distribution(
                [row.top1_similarity for row in correct if row.top1_similarity is not None]
            ),
            "incorrect_top1_similarity": distribution(
                [row.top1_similarity for row in incorrect if row.top1_similarity is not None]
            ),
            "true_identity_similarity": distribution(
                [row.true_similarity for row in known_ok if row.true_similarity is not None]
            ),
            "correct_margin": distribution([row.margin for row in correct if row.margin is not None]),
            "incorrect_margin": distribution(
                [row.margin for row in incorrect if row.margin is not None]
            ),
        },
        "open_set": {
            "unknown_query_total": len(unknown),
            "evaluable_unknown_queries": len(unknown_ok),
            "unknown_best_similarity": distribution(
                [row.top1_similarity for row in unknown_ok if row.top1_similarity is not None]
            ),
        },
        "acceptance_rules": {
            "current_direct_similarity_gte_0_25": rule_metrics(
                known, unknown, lambda row: row.current_direct_accept
            ),
            "production_confident_winner": rule_metrics(
                known, unknown, lambda row: row.production_confident_winner
            ),
            "review_confidence_gte_60": rule_metrics(known, unknown, lambda row: row.review_accept),
            "confident_winner_and_review_60": rule_metrics(
                known,
                unknown,
                lambda row: row.production_confident_winner and row.review_accept,
            ),
            "review_60_and_true_margin_0_06": rule_metrics(
                known,
                unknown,
                lambda row: row.review_accept and row.margin is not None and row.margin >= 0.06,
            ),
        },
        "threshold_recommendation": {
            "objective": "maximize correct accepted known queries with true top-1/top-2 margin >= 0.06 and unknown FAR <= 1%",
            "candidate": recommended,
            "warning": "FIW unrelated_and_nonfaces is only a proxy unknown set; validate on production-domain images before deployment.",
        },
    }


def write_csv(path: Path, rows: Sequence[dict[str, Any]], fieldnames: Sequence[str] | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    resolved_fields = list(fieldnames or rows[0].keys())
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=resolved_fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def build_identity_rows(results: Sequence[QueryResult]) -> list[dict[str, Any]]:
    grouped: dict[str, list[QueryResult]] = {}
    for row in results:
        if row.kind == "known":
            grouped.setdefault(row.true_identity, []).append(row)

    output: list[dict[str, Any]] = []
    for identity, rows in sorted(grouped.items(), key=lambda item: natural_key(item[0])):
        evaluable = [row for row in rows if row.status == "ok"]
        raw_rank1 = sum(row.true_rank == 1 for row in evaluable)
        thresholded_correct = sum(row.top1_correct for row in evaluable)
        output.append(
            {
                "identity": identity,
                "family_id": rows[0].true_family_id,
                "query_count": len(rows),
                "evaluable_query_count": len(evaluable),
                "raw_rank1_accuracy": division(raw_rank1, len(evaluable)),
                "thresholded_top1_accuracy": division(thresholded_correct, len(evaluable)),
                "top3_accuracy": division(sum(row.top3_correct for row in evaluable), len(evaluable)),
                "top5_accuracy": division(sum(row.top5_correct for row in evaluable), len(evaluable)),
                "mean_true_similarity": (
                    round(statistics.fmean(row.true_similarity for row in evaluable if row.true_similarity is not None), 6)
                    if any(row.true_similarity is not None for row in evaluable)
                    else None
                ),
                "current_direct_accepted": sum(row.current_direct_accept for row in evaluable),
                "production_confident_accepted": sum(
                    row.production_confident_winner for row in evaluable
                ),
                "same_family_errors": sum(row.same_family_error for row in evaluable),
            }
        )
    return output


def build_confusion_rows(results: Sequence[QueryResult]) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str], list[QueryResult]] = {}
    for row in results:
        if (
            row.kind == "known"
            and row.status == "ok"
            and not row.top1_correct
            and row.predicted_identity
        ):
            grouped.setdefault((row.true_identity, row.predicted_identity), []).append(row)

    output: list[dict[str, Any]] = []
    for (true_identity, predicted_identity), rows in grouped.items():
        similarities = [row.top1_similarity for row in rows if row.top1_similarity is not None]
        output.append(
            {
                "true_identity": true_identity,
                "predicted_identity": predicted_identity,
                "count": len(rows),
                "same_family": rows[0].true_family_id == rows[0].predicted_family_id,
                "mean_top1_similarity": round(statistics.fmean(similarities), 6),
                "max_top1_similarity": round(max(similarities), 6),
            }
        )
    return sorted(
        output,
        key=lambda row: (-row["count"], -row["mean_top1_similarity"], row["true_identity"]),
    )


def print_summary(summary: dict[str, Any]) -> None:
    closed = summary["closed_set"]
    rules = summary["acceptance_rules"]
    print("\nFIW person-tagging result")
    print(f"  enrolled identities: {summary['dataset']['enrolled_members']}/{summary['dataset']['discovered_members']}")
    print(
        f"  known queries: {closed['evaluable_known_queries']}/{closed['known_query_total']} evaluable"
    )
    print(f"  raw rank-1 accuracy: {closed['evaluable_raw_rank1_accuracy']}")
    print(f"  thresholded top-1 accuracy: {closed['evaluable_thresholded_top1_accuracy']}")
    print(f"  top-3 accuracy: {closed['evaluable_top3_accuracy']}")
    print(f"  top-5 accuracy: {closed['evaluable_top5_accuracy']}")
    for name, metrics in rules.items():
        print(
            f"  {name}: coverage={metrics['known_coverage']}, "
            f"accepted_accuracy={metrics['accepted_known_accuracy']}, "
            f"unknown_FAR={metrics['unknown_false_accept_rate']}"
        )
    candidate = summary["threshold_recommendation"]["candidate"]
    if candidate:
        print(
            "  threshold candidate: "
            f"similarity>={candidate['threshold']}, margin>=0.06, "
            f"coverage={candidate['known_coverage']}, "
            f"accuracy={candidate['accepted_known_accuracy']}, "
            f"unknown_FAR={candidate['unknown_false_accept_rate']}"
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

    members, all_unknowns = discover_dataset(args.dataset_root, args.max_members)
    unknowns = all_unknowns if args.include_unknown else []
    if args.unknown_limit is not None:
        unknowns = unknowns[: args.unknown_limit]
    known_queries = [path for member in members for path in member.queries]
    if args.max_queries is not None:
        known_queries = known_queries[: args.max_queries]
    selected_query_set = set(path.resolve() for path in known_queries)
    paths = [member.reference for member in members]
    paths.extend(
        path for member in members for path in member.queries if path.resolve() in selected_query_set
    )
    paths.extend(unknowns)

    print(
        f"discovered {len(members)} identities, {len(known_queries)} known queries, "
        f"{len(unknowns)} unknown queries"
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
        members=members,
        unknown_paths=unknowns,
        records=records,
        dataset_root=args.dataset_root,
        max_queries=args.max_queries,
    )
    run_name = args.run_name or datetime.now().strftime("fiw-%Y%m%d-%H%M%S")
    run_dir = args.output_root / run_name
    run_dir.mkdir(parents=True, exist_ok=True)

    result_rows = [asdict(row) for row in results]
    threshold_rows = build_threshold_rows(results)
    identity_rows = build_identity_rows(results)
    confusion_rows = build_confusion_rows(results)
    summary = summarize(
        results=results,
        metadata=metadata,
        args=args,
        cache_path=cache_path,
    )
    write_csv(run_dir / "query-results.csv", result_rows)
    write_csv(run_dir / "threshold-sweep.csv", threshold_rows)
    write_csv(run_dir / "identity-results.csv", identity_rows)
    write_csv(run_dir / "confusion-pairs.csv", confusion_rows)
    write_csv(
        run_dir / "enrollment-failures.csv",
        metadata["enrollment_failures"],
        fieldnames=("identity", "reference", "error"),
    )
    (run_dir / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print_summary(summary)
    print(f"  reports: {run_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
