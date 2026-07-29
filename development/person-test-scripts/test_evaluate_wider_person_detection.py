"""Offline regression tests for the WIDER validation count evaluator."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))

from evaluate_wider_person_detection import (  # noqa: E402
    DetectionRecord,
    build_bucket_rows,
    build_image_result,
    detect_observed_cap,
    discover_dataset,
    metric_block,
    parse_detection_response,
)


def write_dataset(root: Path, groups: list[tuple[str, list[str]]]) -> None:
    image_dir = root / "images"
    annotation_path = root / "wider_face_split" / "wider_face_val_bbx_gt.txt"
    annotation_path.parent.mkdir(parents=True, exist_ok=True)
    lines: list[str] = []
    for relative, annotations in groups:
        path = image_dir / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        Image.new("RGB", (100, 80), (100, 80, 60)).save(path)
        lines.extend((relative, str(len(annotations)), *annotations))
    annotation_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def ok_detection(path: str, count: int, image_sha256: str) -> DetectionRecord:
    return DetectionRecord(
        path=path,
        image_sha256=image_sha256,
        status="ok",
        predicted_count=count,
        response_detection_count=count,
        confidence_min=0.5,
        confidence_mean=0.7,
        confidence_max=0.9,
        elapsed_ms=10.0,
        error=None,
    )


class DatasetTests(unittest.TestCase):
    def test_discovers_wider_blocks_and_excludes_invalid_or_zero_size_faces(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            write_dataset(
                root,
                [
                    (
                        "0--Parade/first.jpg",
                        [
                            "2 3 4 5 0 0 0 0 0 0",
                            "2 3 7 8 0 0 0 1 0 0",
                            "2 3 0 6 0 0 0 0 0 0",
                        ],
                    ),
                    ("1--Handshaking/second.jpg", ["1 2 10 12 0 0 0 0 0 0"]),
                ],
            )

            manifest = discover_dataset(root)

            self.assertEqual(
                [item.image_id for item in manifest.images],
                ["0--Parade/first", "1--Handshaking/second"],
            )
            self.assertEqual(manifest.images[0].ground_truth_count, 1)
            self.assertEqual(manifest.images[0].raw_annotation_count, 3)
            self.assertEqual(manifest.images[0].invalid_annotation_count, 1)
            self.assertEqual(manifest.images[0].nonpositive_box_count, 1)


class ResponseTests(unittest.TestCase):
    def test_accepts_face_count_and_detections(self) -> None:
        count, response_count, confidences = parse_detection_response(
            {"face_count": 2, "detections": [{"confidence": 0.7}, {"confidence": 0.8}]}
        )
        self.assertEqual((count, response_count), (2, 2))
        self.assertEqual(confidences, [0.7, 0.8])

    def test_rejects_count_detection_length_mismatch(self) -> None:
        with self.assertRaisesRegex(ValueError, "does not match"):
            parse_detection_response({"face_count": 3, "detections": [{}, {}]})


class MetricTests(unittest.TestCase):
    def build_rows(self):
        temporary = tempfile.TemporaryDirectory()
        root = Path(temporary.name)
        write_dataset(
            root,
            [
                (
                    "0--Parade/first.jpg",
                    [f"{index} 0 10 10 0 0 0 0 0 0" for index in range(10)],
                ),
                (
                    "1--Handshaking/second.jpg",
                    [f"{index} 0 10 10 0 0 0 0 0 0" for index in range(5)],
                ),
            ],
        )
        items = discover_dataset(root).images
        rows = [
            build_image_result(items[0], ok_detection(items[0].relative_path, 8, items[0].image_sha256)),
            build_image_result(items[1], ok_detection(items[1].relative_path, 7, items[1].image_sha256)),
        ]
        self.addCleanup(temporary.cleanup)
        return rows

    def test_count_proxy_aggregates_within_each_image(self) -> None:
        metrics = metric_block(self.build_rows())

        self.assertEqual(metrics["matched_count_proxy"], 13)
        self.assertEqual(metrics["false_positive_count_proxy"], 2)
        self.assertEqual(metrics["false_negative_count_proxy"], 2)
        self.assertEqual(metrics["count_proxy_precision"], round(13 / 15, 6))
        self.assertEqual(metrics["count_proxy_recall"], round(13 / 15, 6))
        self.assertEqual(metrics["mean_absolute_error"], 2.0)

    def test_bucket_and_saturation_diagnostics(self) -> None:
        rows = self.build_rows()
        rows[0].predicted_count = 7
        rows[1].predicted_count = 7
        buckets = build_bucket_rows(rows)
        saturation = detect_observed_cap(rows)

        self.assertEqual(
            {bucket["ground_truth_face_bucket"] for bucket in buckets}, {"0-10"}
        )
        self.assertIsNotNone(saturation)
        self.assertEqual(saturation["observed_maximum_predicted_count"], 7)

    def test_secondary_raw_metrics_include_invalid_rows(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            write_dataset(
                root,
                [
                    (
                        "0--Parade/first.jpg",
                        [
                            "1 1 10 10 0 0 0 0 0 0",
                            "2 2 10 10 0 0 0 1 0 0",
                        ],
                    )
                ],
            )
            item = discover_dataset(root).images[0]
            row = build_image_result(
                item, ok_detection(item.relative_path, 2, item.image_sha256)
            )

            primary = metric_block([row])
            raw = metric_block([row], truth_field="raw_annotation_count")

            self.assertEqual(primary["false_positive_count_proxy"], 1)
            self.assertEqual(raw["exact_count_accuracy"], 1.0)


if __name__ == "__main__":
    unittest.main()
