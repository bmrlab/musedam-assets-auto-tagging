-- CreateTable
CREATE TABLE "public"."Team" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."User" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(64) NOT NULL DEFAULT '',
    "email" TEXT,
    "password" TEXT NOT NULL,
    "slug" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Membership" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "teamId" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Team_slug_key" ON "public"."Team"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_slug_key" ON "public"."User"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_key" ON "public"."Membership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_teamId_key" ON "public"."Membership"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_teamId_key" ON "public"."Membership"("userId", "teamId");

-- AddForeignKey
ALTER TABLE "public"."Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Membership" ADD CONSTRAINT "Membership_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "public"."Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
