-- CreateTable
CREATE TABLE "public"."AssetObject" (
    "id" SERIAL NOT NULL,
    "teamId" INTEGER NOT NULL,
    "slug" VARCHAR(64) NOT NULL,
    "materializedPath" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "tags" JSONB NOT NULL DEFAULT '[]',
    "content" JSONB NOT NULL DEFAULT '{}',
    "extra" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AssetObject_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AssetObject_slug_key" ON "public"."AssetObject"("slug");

-- AddForeignKey
ALTER TABLE "public"."AssetObject" ADD CONSTRAINT "AssetObject_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "public"."Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
