-- The subscriptions table learns about Mad Buddy Access.
--
-- WHY THIS EXISTS.
--
-- `subscriptions.plan` is a NOT NULL enum whose only values are the legacy
-- ladder: free, buddy_plus, buddy_pro. Mad Buddy Access is a different product
-- -- one price, one plan code, two features -- and it has to be recorded as
-- itself.
--
-- The tempting shortcut was to write Access subscriptions as `buddy_plus`,
-- since the resolver only cares whether a subscription is live. That would have
-- been a lie in the one place it matters most: every revenue report, cohort
-- analysis and support conversation would attribute Access income to a tier
-- nobody can buy any more, and reconciliation against Paystack would compare
-- our `buddy_plus` rows against their `PLN_pbpn6h7vprirvlu` and find no
-- correspondence at all. A payments ledger that misnames the product is worse
-- than one that fails loudly.
--
-- ADDITIVE ONLY. Existing values are untouched, so every historical row keeps
-- its meaning and no existing query changes behaviour.

-- `alter type ... add value` cannot run inside a transaction block in older
-- Postgres, and `if not exists` makes re-application safe.
alter type public.subscription_plan add value if not exists 'mad_buddy_access';

comment on type public.subscription_plan is
  'Consumer subscription products. free/buddy_plus/buddy_pro are the retired three-tier ladder, kept so historical rows stay truthful. mad_buddy_access is the current product (Linkr + UpFor).';

-- ROLLBACK (for the production application order; not run here):
--
-- Postgres cannot drop a value from an enum. Rolling this back means either
-- leaving the unused value in place -- which is harmless, as nothing reads it
-- unless rows use it -- or recreating the type, which requires rewriting every
-- dependent column and is not worth doing for an additive change.
--
-- If Access subscriptions must be unwound, update those ROWS rather than the
-- type:
--   update public.subscriptions set status = 'canceled'
--    where plan = 'mad_buddy_access';
--
-- Leaving the enum value present costs nothing and keeps historical rows
-- readable.
