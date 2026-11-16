CREATE TYPE "public"."AssetReferenceMatchStrategy" AS ENUM ('highest', 'average');

ALTER TABLE "public"."AssetProduct"
ADD COLUMN "referenceMatchStrategy" "public"."AssetReferenceMatchStrategy" NOT NULL DEFAULT 'highest';

ALTER TABLE "public"."AssetIp"
ADD COLUMN "referenceMatchStrategy" "public"."AssetReferenceMatchStrategy" NOT NULL DEFAULT 'highest';
