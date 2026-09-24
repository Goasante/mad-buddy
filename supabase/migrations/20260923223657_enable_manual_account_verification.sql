-- The admin verification workflow uses manual_review, but the original table
-- constraint predates that workflow and rejects every decision. Preserve the
-- original verification types and explicitly add the admin-reviewed type.

alter table public.account_verifications
  drop constraint if exists account_verifications_verification_type_check;

alter table public.account_verifications
  add constraint account_verifications_verification_type_check check (
    verification_type in ('email', 'phone', 'institution', 'organisation', 'manual_review')
  );
