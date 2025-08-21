-- CreateTable
CREATE TABLE "public"."AssetTag" (
    "id" SERIAL NOT NULL,
    "teamId" INTEGER NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "slug" VARCHAR(64),
    "level" INTEGER NOT NULL DEFAULT 1,
    "parentId" INTEGER,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AssetTag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AssetTag_teamId_parentId_name_key" ON "public"."AssetTag"("teamId", "parentId", "name");
-- 人工添加, 约束 parentId 为空是的 name 唯一
CREATE UNIQUE INDEX "AssetTag_teamId_name_key" ON "public"."AssetTag"("teamId", "name") WHERE "parentId" IS NULL;

-- AddForeignKey
ALTER TABLE "public"."AssetTag" ADD CONSTRAINT "AssetTag_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "public"."Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AssetTag" ADD CONSTRAINT "AssetTag_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "public"."AssetTag"("id") ON DELETE SET NULL ON UPDATE CASCADE;
