"""Offline regression tests for the FG-NET person-tagging evaluator."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))

from evaluate_fgnet_person_tagging import (  # noqa: E402
    discover_dataset,
    evenly_spaced_reference_indices,
    parse_fgnet_filename,
)


def write_image(path: Path, color: tuple[int, int, int] = (100, 80, 60)) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (12, 10), color).save(path)


class FilenameTests(unittest.TestCase):
    def test_parser_accepts_fgnet_variant_suffix(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "066A06a.JPG"
            write_image(path)

            parsed = parse_fgnet_filename(path)

            self.assertEqual(parsed.identity, "066")
            self.assertEqual(parsed.image_id, 66)
            self.assertEqual(parsed.age, 6)
            self.assertEqual(parsed.sex, "unknown")

    def test_parser_rejects_non_fgnet_image_name(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "66_age_06.JPG"
            write_image(path)

            with self.assertRaisesRegex(ValueError, "personIDAage"):
                parse_fgnet_filename(path)


class ReferenceSelectionTests(unittest.TestCase):
    def test_six_images_use_first_middle_and_fifth_positions(self) -> None:
        self.assertEqual(evenly_spaced_reference_indices(6, 3), (0, 2, 4))

    def test_single_reference_uses_middle_position(self) -> None:
        self.assertEqual(evenly_spaced_reference_indices(6, 1), (2,))

    def test_two_references_span_first_to_penultimate_position(self) -> None:
        self.assertEqual(evenly_spaced_reference_indices(6, 2), (0, 4))

    def test_references_are_chosen_after_sorting_by_age(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for age in (6, 1, 5, 2, 4, 3):
                write_image(root / f"001A{age:02d}.JPG", color=(age, age, age))

            manifest = discover_dataset(root, references_per_person=3)
            identity = manifest.identities[0]

            self.assertEqual([image.age for image in identity.references], [1, 3, 5])
            self.assertEqual([image.age for image in identity.tests], [2, 4, 6])

    def test_discovery_keeps_same_age_variants_and_reports_invalid_names(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name in (
                "001A01.JPG",
                "001A02.JPG",
                "001A02a.JPG",
                "001A03.JPG",
                "002A10.JPG",
                "002A20.JPG",
            ):
                write_image(root / name)
            write_image(root / "invalid.JPG")

            manifest = discover_dataset(root, references_per_person=1)

            self.assertEqual([item.identity for item in manifest.identities], ["001", "002"])
            first_source = [
                image.path.name
                for image in (*manifest.identities[0].references, *manifest.identities[0].tests)
            ]
            self.assertIn("001A02a.JPG", first_source)
            self.assertEqual(len(manifest.invalid_filenames), 1)


if __name__ == "__main__":
    unittest.main()
