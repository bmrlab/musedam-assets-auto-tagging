-- CreateTable
CREATE TABLE "public"."TeamConfig" (
    "id" SERIAL NOT NULL,
    "teamId" INTEGER NOT NULL,
    "key" VARCHAR(255) NOT NULL,
    "value" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "TeamConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TeamConfig_teamId_key_key" ON "public"."TeamConfig"("teamId", "key");

-- AddForeignKey
ALTER TABLE "public"."TeamConfig" ADD CONSTRAINT "TeamConfig_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "public"."Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
