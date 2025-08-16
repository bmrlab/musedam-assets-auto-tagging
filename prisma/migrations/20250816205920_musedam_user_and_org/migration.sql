-- CreateTable
CREATE TABLE "public"."MuseDAMUser" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MuseDAMUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MuseDAMOrganization" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MuseDAMOrganization_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MuseDAMUser_userId_key" ON "public"."MuseDAMUser"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MuseDAMOrganization_organizationId_key" ON "public"."MuseDAMOrganization"("organizationId");

-- AddForeignKey
ALTER TABLE "public"."MuseDAMUser" ADD CONSTRAINT "MuseDAMUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MuseDAMOrganization" ADD CONSTRAINT "MuseDAMOrganization_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
