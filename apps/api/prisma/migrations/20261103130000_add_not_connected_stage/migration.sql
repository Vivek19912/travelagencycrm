-- PENDING REVIEW — DO NOT APPLY without explicit approval.
--
-- Adds the NOT_CONNECTED value to the native LeadStage enum backing
-- Query.leadStage (plus ReminderRule.leadStage, QueryNote.leadStage
-- and the stage-history columns that share the type). Additive only:
-- no existing rows are touched and no values are renamed or removed.
--
-- Apply with: npx prisma migrate deploy (production DATABASE_URL).
-- To regenerate with a live database, delete this directory and run:
--   npm run db:migrate -- --name add_not_connected_stage

-- AlterEnum
ALTER TYPE "LeadStage" ADD VALUE 'NOT_CONNECTED';
