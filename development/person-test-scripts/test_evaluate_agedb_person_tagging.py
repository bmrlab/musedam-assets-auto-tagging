"""Offline regression tests for the AgeDB person-tagging evaluator."""

from __future__ import annotations

import shutil
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))

from evaluate_agedb_person_tagging import (  # noqa: E402
    AgeDbIdentity,
    AgeDbImage,
    auto_tag_decision,
    classify_queries,
    discover_dataset,
    parse_agedb_filename,
    production_candidates,
    rank_identity_scores,
    score_identity,
)
from evaluate_fiw_person_tagging import EmbeddingRecord  # noqa: E402


def write_image(path: Path, color: tuple[int, int, int] = (100, 80, 60)) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (12, 10), color).save(path)


def normalized(*values: float) -> np.ndarray:
    vector = np.zeros(512, dtype=np.float32)
    vector[: len(values)] = values
    return vector / np.linalg.norm(vector)


def embedding_record(path: str, vector: np.ndarray) -> EmbeddingRecord:
    return EmbeddingRecord(
        path=path,
        status="ok",
        embedding=vector.astype(float).tolist(),
        detection_count=1,
        detection_score=0.99,
        padding_ratio=0.0,
        attempts=1,
        model_name="buffalo_l",
        embedding_dimension=512,
        elapsed_ms=1.0,
        error=None,
    )


def sample(path: Path, image_id: int, identity: str, age: int, split: str) -> AgeDbImage:
    return AgeDbImage(
        path=path,
        image_id=image_id,
        identity=identity,
        age=age,
        sex="f",
        split=split,
        sha256=f"hash-{image_id}",
    )


class FilenameAndDiscoveryTests(unittest.TestCase):
    def test_parser_preserves_internal_underscores_and_trims_identity(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "430_Morgan_Freeman _17_m.jpg"
            write_image(path)
            parsed = parse_agedb_filename(path, "reference")

            self.assertEqual(parsed.image_id, 430)
            self.assertEqual(parsed.identity, "Morgan_Freeman")
            self.assertEqual(parsed.age, 17)
            self.assertEqual(parsed.sex, "m")

    def test_discovers_separate_multi_reference_and_test_sets(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            write_image(root / "reference/1_Alice_7_f.jpg")
            write_image(root / "reference/2_Alice_10_f.jpg")
            write_image(root / "test/3_Alice_15_f.jpg")
            write_image(root / "test/4_Bob_12_m.jpg")
            write_image(root / "reference/not-valid.jpg")

            manifest = discover_dataset(root)

            self.assertEqual([identity.identity for identity in manifest.identities], ["Alice", "Bob"])
            self.assertEqual(len(manifest.identities[0].references), 2)
            self.assertEqual(len(manifest.identities[0].tests), 1)
            self.assertEqual(len(manifest.identities[1].references), 0)
            self.assertEqual(len(manifest.invalid_filenames), 1)

    def test_exact_reference_test_content_is_detectable(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            reference = root / "reference/1_Alice_7_f.jpg"
            test = root / "test/2_Alice_9_f.jpg"
            write_image(reference)
            test.parent.mkdir(parents=True)
            shutil.copyfile(reference, test)

            manifest = discover_dataset(root)

            identity = manifest.identities[0]
            self.assertEqual(identity.references[0].sha256, identity.tests[0].sha256)


class ProductionPolicyTests(unittest.TestCase):
    def test_support_bonus_ranks_identities_but_raw_threshold_still_rejects(self) -> None:
        query = normalized(1.0)
        a_references = [
            (sample(Path("reference/a1.jpg"), 1, "A", 10, "reference"), normalized(0.54, 0.841665)),
            (sample(Path("reference/a2.jpg"), 2, "A", 12, "reference"), normalized(0.54, -0.841665)),
        ]
        b_references = [
            (sample(Path("reference/b1.jpg"), 3, "B", 11, "reference"), normalized(0.55, 0.835165)),
        ]
        scores = [
            score_identity(identity="A", references=a_references, query=query),
            score_identity(identity="B", references=b_references, query=query),
        ]

        ranked = rank_identity_scores(scores)
        candidates = production_candidates(scores)
        accepted, reason, margin = auto_tag_decision(candidates[0], candidates[1])

        self.assertEqual(ranked[0].identity, "A")
        self.assertAlmostEqual(ranked[0].raw_similarity, 0.54, places=4)
        self.assertAlmostEqual(ranked[0].adjusted_similarity, 0.555, places=4)
        self.assertFalse(accepted)
        self.assertEqual(reason, "below_similarity_threshold")
        self.assertLess(margin or 0.0, 0.0)

    def test_all_references_can_succeed_when_first_reference_baseline_fails(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            a1 = sample(root / "reference/1_A_5_f.jpg", 1, "A", 5, "reference")
            a2 = sample(root / "reference/2_A_15_f.jpg", 2, "A", 15, "reference")
            b1 = sample(root / "reference/3_B_10_f.jpg", 3, "B", 10, "reference")
            query = sample(root / "test/4_A_16_f.jpg", 4, "A", 16, "test")
            for image in (a1, a2, b1, query):
                write_image(image.path)

            identities = [
                AgeDbIdentity("A", (a1, a2), (query,)),
                AgeDbIdentity("B", (b1,), ()),
            ]
            vectors = {
                "reference/1_A_5_f.jpg": normalized(1.0, 0.0),
                "reference/2_A_15_f.jpg": normalized(0.0, 1.0),
                "reference/3_B_10_f.jpg": normalized(0.6, 0.8),
                "test/4_A_16_f.jpg": normalized(0.0, 1.0),
            }
            records = {path: embedding_record(path, vector) for path, vector in vectors.items()}

            all_results, _ = classify_queries(
                identities=identities,
                tests=[query],
                records=records,
                dataset_root=root,
            )
            baseline_results, _ = classify_queries(
                identities=identities,
                tests=[query],
                records=records,
                dataset_root=root,
                max_references_per_identity=1,
            )

            self.assertEqual(all_results[0].predicted_identity, "A")
            self.assertTrue(all_results[0].top1_correct)
            self.assertEqual(all_results[0].reference_age_gap, 1)
            self.assertEqual(all_results[0].true_best_reference_age, 15)
            self.assertEqual(baseline_results[0].predicted_identity, "B")
            self.assertFalse(baseline_results[0].top1_correct)


if __name__ == "__main__":
    unittest.main()
