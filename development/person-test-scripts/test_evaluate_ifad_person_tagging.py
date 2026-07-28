"""Offline regression tests for the IFAD person-tagging evaluator."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))

from evaluate_ifad_person_tagging import (  # noqa: E402
    _add_tagging_metrics,
    _threshold_policy_metrics,
    discover_dataset,
    parse_ifad_filename,
)


def write_image(path: Path, color: tuple[int, int, int] = (100, 80, 60)) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (12, 10), color).save(path)


class FilenameTests(unittest.TestCase):
    def test_parser_accepts_ifad_filename(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "364-6-30.jpg"
            write_image(path)

            parsed = parse_ifad_filename(path)

            self.assertEqual(parsed.identity, "6")
            self.assertEqual(parsed.image_id, 364)
            self.assertEqual(parsed.age, 30)
            self.assertEqual(parsed.sex, "unknown")

    def test_parser_normalizes_numeric_person_id(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "004-006-030.JPG"
            write_image(path)

            parsed = parse_ifad_filename(path)

            self.assertEqual(parsed.identity, "6")
            self.assertEqual(parsed.image_id, 4)
            self.assertEqual(parsed.age, 30)

    def test_parser_rejects_whitespace_in_age(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "364-6- 30.jpg"
            write_image(path)

            with self.assertRaisesRegex(ValueError, "imageID-personID-age"):
                parse_ifad_filename(path)


class ReferenceSelectionTests(unittest.TestCase):
    def test_six_images_use_first_middle_and_fifth_positions(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for image_id, age in enumerate((6, 1, 5, 2, 4, 3), start=1):
                write_image(root / f"{image_id}-1-{age}.jpg", color=(age, age, age))

            manifest = discover_dataset(root, references_per_person=3)
            identity = manifest.identities[0]

            self.assertEqual([image.age for image in identity.references], [1, 3, 5])
            self.assertEqual([image.age for image in identity.tests], [2, 4, 6])

    def test_one_reference_uses_middle_position(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for image_id, age in enumerate(range(1, 7), start=1):
                write_image(root / f"{image_id}-1-{age}.jpg")

            identity = discover_dataset(root, references_per_person=1).identities[0]

            self.assertEqual([image.age for image in identity.references], [3])
            self.assertEqual([image.age for image in identity.tests], [1, 2, 4, 5, 6])

    def test_two_references_use_first_and_penultimate_positions(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for image_id, age in enumerate(range(1, 7), start=1):
                write_image(root / f"{image_id}-1-{age}.jpg")

            identity = discover_dataset(root, references_per_person=2).identities[0]

            self.assertEqual([image.age for image in identity.references], [1, 5])
            self.assertEqual([image.age for image in identity.tests], [2, 3, 4, 6])

    def test_discovery_keeps_same_age_images_and_reports_invalid_names(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name in (
                "1-1-10.jpg",
                "2-1-10.jpg",
                "3-1-20.jpg",
                "4-1-30.jpg",
                "5-2-10.jpg",
                "6-2-20.jpg",
            ):
                write_image(root / name)
            write_image(root / "7-2- 30.jpg")

            manifest = discover_dataset(root, references_per_person=1)

            self.assertEqual([item.identity for item in manifest.identities], ["1", "2"])
            first_source = [
                image.path.name
                for image in (*manifest.identities[0].references, *manifest.identities[0].tests)
            ]
            self.assertIn("2-1-10.jpg", first_source)
            self.assertEqual(len(manifest.invalid_filenames), 1)


class MetricTests(unittest.TestCase):
    def test_explicit_precision_recall_and_f1(self) -> None:
        metrics = {
            "auto_tag_accepted_accuracy": 0.75,
            "auto_tag_correct": 3,
            "evaluable_queries": 5,
            "query_total": 6,
        }

        result = _add_tagging_metrics(metrics)

        self.assertEqual(result["auto_tag_precision"], 0.75)
        self.assertEqual(result["auto_tag_recall"], 0.6)
        self.assertEqual(result["operational_auto_tag_recall"], 0.5)
        self.assertEqual(result["auto_tag_f1"], 0.666667)

    def test_threshold_policy_reports_coverage_precision_and_recall(self) -> None:
        results = [
            SimpleNamespace(
                status="ok",
                top1_raw_similarity=0.50,
                raw_runner_up_margin=0.10,
                top1_correct=True,
            ),
            SimpleNamespace(
                status="ok",
                top1_raw_similarity=0.45,
                raw_runner_up_margin=0.10,
                top1_correct=False,
            ),
            SimpleNamespace(
                status="ok",
                top1_raw_similarity=0.39,
                raw_runner_up_margin=0.10,
                top1_correct=True,
            ),
            SimpleNamespace(
                status="ok",
                top1_raw_similarity=0.60,
                raw_runner_up_margin=0.05,
                top1_correct=True,
            ),
        ]

        result = _threshold_policy_metrics(results, 0.40)

        self.assertEqual(result["accepted"], 2)
        self.assertEqual(result["auto_tag_coverage"], 0.5)
        self.assertEqual(result["auto_tag_precision"], 0.5)
        self.assertEqual(result["auto_tag_recall"], 0.25)


if __name__ == "__main__":
    unittest.main()
