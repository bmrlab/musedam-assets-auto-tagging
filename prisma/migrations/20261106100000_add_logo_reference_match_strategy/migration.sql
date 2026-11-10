CREATE TYPE "public"."AssetLogoReferenceMatchStrategy" AS ENUM ('highest', 'average');

ALTER TABLE "public"."AssetLogo"
ADD COLUMN "referenceMatchStrategy" "public"."AssetLogoReferenceMatchStrategy" NOT NULL DEFAULT 'highest';
