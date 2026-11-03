-- PENDING REVIEW — DO NOT APPLY without explicit approval.
--
-- Creates `wacrm_management_credentials`: per-company encrypted
-- storage for the WhatsApp Max API key used by the CRM User Mapping
-- management UI (Settings → Integrations). The key is minted in
-- WhatsApp Max (Settings → API keys, `crm-mappings:manage` scope),
-- pasted once by a company administrator, and persisted only as an
-- AES-256-GCM envelope (DATA_ENCRYPTION_KEY). Plaintext is never
-- stored and never returned by any endpoint.
--
-- One row per company (UNIQUE companyId): the key inherently belongs
-- to exactly one WhatsApp Max workspace, which keeps tenants
-- isolated without trusting any browser-supplied account identifier.
-- To regenerate with a live database, delete this directory and run:
--   npm run db:migrate -- --name wacrm_management_credential

-- CreateTable
CREATE TABLE "wacrm_management_credentials" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "secretEncrypted" TEXT NOT NULL,
    "keyVersion" VARCHAR(30) NOT NULL,
    "keyPrefix" VARCHAR(32) NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wacrm_management_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wacrm_management_credentials_companyId_key" ON "wacrm_management_credentials"("companyId");
