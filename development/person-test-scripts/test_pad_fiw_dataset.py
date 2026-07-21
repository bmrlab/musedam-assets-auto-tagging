"""Offline tests for the FIW dataset padding utility."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pad_fiw_dataset import discover_images, pad_dataset, validate_paths  # noqa: E402


class PadFiwDatasetTests(unittest.TestCase):
    def test_preserves_relative_paths_and_adds_half_size_border(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"
            destination = root / "destination"
            input_path = source / "FIDs/F0010/MID1/face.png"
            input_path.parent.mkdir(parents=True)
            Image.new("RGB", (10, 6), (20, 30, 40)).save(input_path)

            source, destination = validate_paths(source, destination)
            images = discover_images(source)
            results = pad_dataset(
                source=source,
                destination=destination,
                images=images,
                padding_ratio=0.5,
                padding_color="white",
                jpeg_quality=95,
                workers=1,
                overwrite=False,
                progress_every=1,
            )

            output_path = destination / "FIDs/F0010/MID1/face.png"
            self.assertEqual(len(results), 1)
            self.assertEqual(results[0].status, "written")
            self.assertTrue(output_path.is_file())
            with Image.open(output_path) as output:
                self.assertEqual(output.size, (20, 12))
                self.assertEqual(output.getpixel((0, 0)), (255, 255, 255))
                self.assertEqual(output.getpixel((5, 3)), (20, 30, 40))

    def test_existing_output_is_resumable_and_skipped(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"
            destination = root / "destination"
            input_path = source / "face.jpg"
            output_path = destination / "face.jpg"
            input_path.parent.mkdir(parents=True)
            output_path.parent.mkdir(parents=True)
            Image.new("RGB", (8, 8), "red").save(input_path)
            Image.new("RGB", (4, 4), "blue").save(output_path)

            results = pad_dataset(
                source=source,
                destination=destination,
                images=[input_path],
                padding_ratio=0.5,
                padding_color="white",
                jpeg_quality=95,
                workers=1,
                overwrite=False,
                progress_every=1,
            )

            self.assertEqual(results[0].status, "skipped")
            with Image.open(output_path) as output:
                self.assertEqual(output.size, (4, 4))

    def test_destination_cannot_be_inside_source(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "source"
            source.mkdir()
            with self.assertRaises(ValueError):
                validate_paths(source, source / "padded")


if __name__ == "__main__":
    unittest.main()
