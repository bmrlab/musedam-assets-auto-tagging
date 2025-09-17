-- CreateEnum
CREATE TYPE "public"."TaggingTaskType" AS ENUM ('default', 'test');

-- AlterTable
ALTER TABLE "public"."TaggingQueueItem" ADD COLUMN "taskType" "public"."TaggingTaskType" NOT NULL DEFAULT 'default';

-- DropColumn (if onlyTest column exists)
-- ALTER TABLE "public"."TaggingQueueItem" DROP COLUMN IF EXISTS "onlyTest";
