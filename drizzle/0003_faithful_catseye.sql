-- Tighten user.role from free-form text to the user_role enum (created in 0002).
-- Existing rows hold values like 'owner' which already match the enum, so the
-- USING cast is safe; new rows are constrained by the enum from this migration on.
ALTER TABLE "user"
  ALTER COLUMN "role" DROP DEFAULT,
  ALTER COLUMN "role" SET DATA TYPE user_role USING role::user_role,
  ALTER COLUMN "role" SET DEFAULT 'owner'::user_role;