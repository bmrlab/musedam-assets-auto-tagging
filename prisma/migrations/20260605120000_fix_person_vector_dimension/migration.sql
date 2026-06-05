-- Person face embeddings are ArcFace vectors from the face service. They are
-- 512-dimensional, unlike the multimodal Jina vectors used by other libraries.
DELETE FROM "PersonVector";

ALTER TABLE "PersonVector"
ALTER COLUMN "embedding" TYPE vector(512);
