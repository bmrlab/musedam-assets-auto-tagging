#!/usr/bin/env python3
"""Create a padded copy of every image in the FIW dataset.

The relative directory layout and original filenames are preserved. Existing
outputs are skipped by default, which makes interrupted runs safely resumable.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
import uuid
from concurrent.futures import Future, ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

from PIL import Image, ImageOps


DEFAULT_SOURCE = Path("/Users/jayson/Downloads/Datasets/Family Dataset/FIW Dataset")
DEFAULT_DESTINATION = Path(
    "/Users/jayson/Downloads/Datasets/Family Dataset/FIW Dataset_padded dataset"
)
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


@dataclass(frozen=True)
class PadResult:
    source: Path
    destination: Path
    status: str
    original_size: tuple[int, int] | None = None
    padded_size: tuple[int, int] | None = None
    error: str | None = None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Recursively create a padded copy of the FIW image dataset.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--destination", type=Path, default=DEFAULT_DESTINATION)
    parser.add_argument(
        "--padding-ratio",
        type=float,
        default=0.5,
        help="Border size on each side relative to that image dimension",
    )
    parser.add_argument("--padding-color", choices=("white", "black"), default="white")
    parser.add_argument("--jpeg-quality", type=int, default=95)
    parser.add_argument("--workers", type=int, default=min(16, os.cpu_count() or 4))
    parser.add_argument("--progress-every", type=int, default=100)
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if args.padding_ratio < 0:
        parser.error("--padding-ratio must be nonnegative")
    if not 1 <= args.jpeg_quality <= 100:
        parser.error("--jpeg-quality must be between 1 and 100")
    if args.workers < 1:
        parser.error("--workers must be positive")
    if args.progress_every < 1:
        parser.error("--progress-every must be positive")
    return args


def validate_paths(source: Path, destination: Path) -> tuple[Path, Path]:
    source = source.expanduser().resolve()
    destination = destination.expanduser().resolve()
    if not source.is_dir():
        raise FileNotFoundError(f"source dataset directory not found: {source}")
    if source == destination:
        raise ValueError("destination must be different from source")
    if destination.is_relative_to(source):
        raise ValueError("destination cannot be inside the source dataset")
    if destination.exists() and not destination.is_dir():
        raise NotADirectoryError(f"destination exists and is not a directory: {destination}")
    return source, destination


def discover_images(source: Path) -> list[Path]:
    return sorted(
        (
            path
            for path in source.rglob("*")
            if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES
        ),
        key=lambda path: path.relative_to(source).as_posix().lower(),
    )


def add_padding(image: Image.Image, ratio: float, color: str) -> Image.Image:
    image = ImageOps.exif_transpose(image).convert("RGB")
    if ratio == 0:
        return image.copy()
    horizontal = max(1, round(image.width * ratio))
    vertical = max(1, round(image.height * ratio))
    fill = (255, 255, 255) if color == "white" else (0, 0, 0)
    return ImageOps.expand(
        image,
        border=(horizontal, vertical, horizontal, vertical),
        fill=fill,
    )


def save_image(image: Image.Image, destination: Path, jpeg_quality: int) -> None:
    suffix = destination.suffix.lower()
    if suffix in {".jpg", ".jpeg"}:
        image.save(destination, format="JPEG", quality=jpeg_quality, optimize=True)
    elif suffix == ".png":
        image.save(destination, format="PNG", optimize=True)
    elif suffix == ".webp":
        image.save(destination, format="WEBP", quality=jpeg_quality, method=4)
    elif suffix == ".bmp":
        image.save(destination, format="BMP")
    else:
        raise ValueError(f"unsupported output extension: {suffix}")


def pad_one(
    *,
    source: Path,
    destination: Path,
    padding_ratio: float,
    padding_color: str,
    jpeg_quality: int,
    overwrite: bool,
) -> PadResult:
    if destination.is_file() and not overwrite:
        return PadResult(source=source, destination=destination, status="skipped")

    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(
        f".{destination.stem}.{uuid.uuid4().hex}.tmp{destination.suffix}"
    )
    try:
        with Image.open(source) as opened:
            original_size = opened.size
            padded = add_padding(opened, padding_ratio, padding_color)
        padded_size = padded.size
        save_image(padded, temporary, jpeg_quality)

        with Image.open(temporary) as verification:
            verification.load()
            if verification.size != padded_size:
                raise ValueError(
                    f"saved dimensions {verification.size} do not match expected {padded_size}"
                )
        os.replace(temporary, destination)
        return PadResult(
            source=source,
            destination=destination,
            status="written",
            original_size=original_size,
            padded_size=padded_size,
        )
    except Exception as error:
        return PadResult(
            source=source,
            destination=destination,
            status="failed",
            error=f"{type(error).__name__}: {error}",
        )
    finally:
        temporary.unlink(missing_ok=True)


def pad_dataset(
    *,
    source: Path,
    destination: Path,
    images: Sequence[Path],
    padding_ratio: float,
    padding_color: str,
    jpeg_quality: int,
    workers: int,
    overwrite: bool,
    progress_every: int,
) -> list[PadResult]:
    results: list[PadResult] = []
    started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="fiw-padding") as pool:
        futures: dict[Future[PadResult], Path] = {}
        for image_path in images:
            output_path = destination / image_path.relative_to(source)
            future = pool.submit(
                pad_one,
                source=image_path,
                destination=output_path,
                padding_ratio=padding_ratio,
                padding_color=padding_color,
                jpeg_quality=jpeg_quality,
                overwrite=overwrite,
            )
            futures[future] = image_path

        for completed, future in enumerate(as_completed(futures), start=1):
            results.append(future.result())
            if completed % progress_every == 0 or completed == len(futures):
                elapsed = max(time.perf_counter() - started, 0.001)
                written = sum(result.status == "written" for result in results)
                skipped = sum(result.status == "skipped" for result in results)
                failed = sum(result.status == "failed" for result in results)
                print(
                    f"processed {completed}/{len(futures)}: written={written}, "
                    f"skipped={skipped}, failed={failed}, rate={completed / elapsed:.1f} images/s"
                )
    return results


def main() -> int:
    args = parse_args()
    try:
        source, destination = validate_paths(args.source, args.destination)
    except (FileNotFoundError, NotADirectoryError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2

    images = discover_images(source)
    print(f"source: {source}")
    print(f"destination: {destination}")
    print(f"images: {len(images)}")
    print(
        f"padding: {args.padding_ratio:.2f} per side, color={args.padding_color}, "
        f"workers={args.workers}"
    )
    if args.dry_run:
        return 0

    destination.mkdir(parents=True, exist_ok=True)
    results = pad_dataset(
        source=source,
        destination=destination,
        images=images,
        padding_ratio=args.padding_ratio,
        padding_color=args.padding_color,
        jpeg_quality=args.jpeg_quality,
        workers=args.workers,
        overwrite=args.overwrite,
        progress_every=args.progress_every,
    )
    written = sum(result.status == "written" for result in results)
    skipped = sum(result.status == "skipped" for result in results)
    failures = [result for result in results if result.status == "failed"]
    print(
        f"complete: total={len(results)}, written={written}, "
        f"skipped={skipped}, failed={len(failures)}"
    )
    for result in failures[:20]:
        print(
            f"failed: {result.source.relative_to(source)}: {result.error}",
            file=sys.stderr,
        )
    if len(failures) > 20:
        print(f"... {len(failures) - 20} additional failures", file=sys.stderr)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
