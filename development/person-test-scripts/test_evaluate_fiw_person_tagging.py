"""Offline unit tests for the FIW person-tagging evaluator.

These tests exercise dataset selection, image padding, score calibration, and
nearest-neighbour behavior. They never call the deployed face service.
"""

from __future__ import annotations

import argparse
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))

from evaluate_fiw_person_tagging import (  # noqa: E402
    EmbeddingRecord,
    Member,
    QueryResult,
    build_threshold_rows,
    cache_signature,
    classify_queries,
    confident_winner,
    discover_dataset,
    natural_key,
    padded_image,
    similarity_to_confidence,
)


def write_image(path: Path, color: tuple[int, int, int] = (120, 80, 40)) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (8, 10), color).save(path)


def embedding_record(path: str, vector: np.ndarray) -> EmbeddingRecord:
    return EmbeddingRecord(
        path=path,
        status="ok",
        embedding=vector.astype(float).tolist(),
        detection_count=1,
        detection_score=0.99,
        padding_ratio=0.5,
        attempts=1,
        model_name="buffalo_l",
        embedding_dimension=512,
        elapsed_ms=1.0,
        error=None,
    )


def query_result(*, score: float, second: float) -> QueryResult:
    return QueryResult(
        kind="known",
        path="query.jpg",
        true_identity="F1/MID1",
        true_family_id="F1",
        status="ok",
        predicted_identity="F1/MID1",
        predicted_family_id="F1",
        top1_similarity=score,
        second_similarity=second,
        margin=score - second,
        production_second_similarity=second,
        production_margin=score - second,
        true_similarity=score,
        true_rank=1,
        top1_correct=True,
        top3_correct=True,
        top5_correct=True,
        same_family_error=False,
        confidence=similarity_to_confidence(score),
        production_confident_winner=confident_winner(score, second),
        current_direct_accept=score >= 0.25,
        review_accept=similarity_to_confidence(score) >= 60,
        detection_count=1,
        detection_score=0.99,
        padding_ratio=0.5,
        error=None,
    )


class DatasetDiscoveryTests(unittest.TestCase):
    def test_natural_sort_and_first_image_enrollment(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            write_image(root / "FIDs/F10/MID2/face10.jpg")
            write_image(root / "FIDs/F10/MID2/face2.jpg")
            write_image(root / "FIDs/F10/MID2/nested/face1.jpg")
            write_image(root / "FIDs/F2/MID10/face1.png")
            write_image(root / "FIDs/F2/MID3/face2.jpeg")
            write_image(root / "FIDs/F2/MID3/face1.jpg")
            write_image(root / "FIDs/F2/unrelated_and_nonfaces/person2.jpg")

            members, unknowns = discover_dataset(root, max_members=None)

            self.assertEqual(
                [member.identity for member in members],
                ["F2/MID3", "F2/MID10", "F10/MID2"],
            )
            self.assertEqual(members[0].reference.name, "face1.jpg")
            self.assertEqual([path.name for path in members[2].images], ["face2.jpg", "face10.jpg"])
            self.assertEqual([path.name for path in unknowns], ["person2.jpg"])
            self.assertNotIn("nested", {path.parent.name for path in members[2].images})

    def test_natural_key_orders_numeric_components(self) -> None:
        values = ["face10.jpg", "face2.jpg", "face1.jpg"]
        self.assertEqual(sorted(values, key=natural_key), ["face1.jpg", "face2.jpg", "face10.jpg"])


class ImageAndScoreTests(unittest.TestCase):
    def test_padding_is_per_side_and_preserves_original_center(self) -> None:
        image = Image.new("RGB", (8, 10), (20, 30, 40))
        result = padded_image(image, 0.5, "white")

        self.assertEqual(result.size, (16, 20))
        self.assertEqual(result.getpixel((0, 0)), (255, 255, 255))
        self.assertEqual(result.getpixel((4, 5)), (20, 30, 40))

    def test_confidence_and_winner_boundaries_match_production(self) -> None:
        self.assertEqual(similarity_to_confidence(0.38), 50)
        self.assertTrue(confident_winner(0.55, 0.54))
        self.assertFalse(confident_winner(0.35, 0.0))
        self.assertFalse(confident_winner(0.40, 0.35))
        self.assertTrue(confident_winner(0.42, 0.35))


class ClassificationTests(unittest.TestCase):
    def test_classification_uses_one_reference_and_keeps_true_second_score(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            paths = {
                name: root / name
                for name in (
                    "FIDs/F1/MID1/ref.jpg",
                    "FIDs/F1/MID1/query.jpg",
                    "FIDs/F2/MID1/ref.jpg",
                    "FIDs/F2/MID1/query.jpg",
                )
            }
            for path in paths.values():
                write_image(path)

            members = [
                Member("F1", "MID1", "F1/MID1", (paths["FIDs/F1/MID1/ref.jpg"], paths["FIDs/F1/MID1/query.jpg"])),
                Member("F2", "MID1", "F2/MID1", (paths["FIDs/F2/MID1/ref.jpg"], paths["FIDs/F2/MID1/query.jpg"])),
            ]
            first = np.zeros(512, dtype=np.float32)
            first[0] = 1.0
            second = np.zeros(512, dtype=np.float32)
            second[1] = 1.0
            first_query = np.zeros(512, dtype=np.float32)
            first_query[0] = 0.995
            first_query[1] = 0.1

            records = {
                "FIDs/F1/MID1/ref.jpg": embedding_record("FIDs/F1/MID1/ref.jpg", first),
                "FIDs/F1/MID1/query.jpg": embedding_record("FIDs/F1/MID1/query.jpg", first_query),
                "FIDs/F2/MID1/ref.jpg": embedding_record("FIDs/F2/MID1/ref.jpg", second),
                "FIDs/F2/MID1/query.jpg": embedding_record("FIDs/F2/MID1/query.jpg", second),
            }

            results, metadata = classify_queries(
                members=members,
                unknown_paths=[],
                records=records,
                dataset_root=root,
                max_queries=None,
            )

            first_result = results[0]
            self.assertEqual(first_result.predicted_identity, "F1/MID1")
            self.assertTrue(first_result.top1_correct)
            self.assertAlmostEqual(first_result.second_similarity or 0.0, 0.099999, places=4)
            self.assertEqual(first_result.production_second_similarity, 0.0)
            self.assertGreater(first_result.production_margin or 0.0, first_result.margin or 0.0)
            self.assertEqual(metadata["enrolled_members"], 2)

    def test_threshold_sweep_uses_true_margin(self) -> None:
        rows = build_threshold_rows([query_result(score=0.62, second=0.58)])
        without_margin = next(
            row for row in rows if row["threshold"] == 0.6 and not row["require_margin_0_06"]
        )
        with_margin = next(
            row for row in rows if row["threshold"] == 0.6 and row["require_margin_0_06"]
        )

        self.assertEqual(without_margin["known_accepted"], 1)
        self.assertEqual(with_margin["known_accepted"], 0)

    def test_cache_signature_separates_embedding_modes(self) -> None:
        common = {
            "api_url": "https://face.example.test",
            "padding_ratios": (0.5, 0.75, 1.0),
            "padding_color": "white",
            "jpeg_quality": 95,
        }
        padded = argparse.Namespace(**common, embedding_mode="padded-detect")
        synthetic = argparse.Namespace(**common, embedding_mode="synthetic-landmarks")
        self.assertNotEqual(cache_signature(padded), cache_signature(synthetic))


if __name__ == "__main__":
    unittest.main()
