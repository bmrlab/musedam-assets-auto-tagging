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
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AssetObject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Tag" (
    "id" SERIAL NOT NULL,
    "teamId" INTEGER NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "parentId" INTEGER,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AssetObject_slug_key" ON "public"."AssetObject"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_teamId_level_name_key" ON "public"."Tag"("teamId", "level", "name");

-- AddForeignKey
ALTER TABLE "public"."AssetObject" ADD CONSTRAINT "AssetObject_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "public"."Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Tag" ADD CONSTRAINT "Tag_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "public"."Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Tag" ADD CONSTRAINT "Tag_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "public"."Tag"("id") ON DELETE SET NULL ON UPDATE CASCADE;
