-- CreateTable
CREATE TABLE "destination_stylish_covers" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "destinationId" UUID NOT NULL,
    "cards" JSONB NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "destination_stylish_covers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "destination_stylish_covers_companyId_destinationId_key" ON "destination_stylish_covers"("companyId", "destinationId");

-- CreateIndex
CREATE INDEX "destination_stylish_covers_destinationId_idx" ON "destination_stylish_covers"("destinationId");

-- AddForeignKey
ALTER TABLE "destination_stylish_covers" ADD CONSTRAINT "destination_stylish_covers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "destination_stylish_covers" ADD CONSTRAINT "destination_stylish_covers_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "destinations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "destination_stylish_covers" ADD CONSTRAINT "destination_stylish_covers_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "destination_stylish_covers" ADD CONSTRAINT "destination_stylish_covers_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
