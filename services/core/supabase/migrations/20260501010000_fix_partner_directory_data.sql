-- ============================================================================
-- Partner directory cleanup
-- ============================================================================
--
-- The /partners page is account-backed today. This fixes the account data that
-- caused duplicate/stale cards after adding Meetup sources:
--   - keep the active Notion Cebu account, not the stale 0-event account
--   - give seeded AWS Cloud Club Meetup accounts a shared logo asset
--   - keep duplicate source accounts verified so UI aggregation can merge them
--
-- The AWS asset is served by the PWA from apps/pwa/public/partners.
-- ============================================================================

-- Notion Cebu: events currently attach to "Notion Cebu Community"; the older
-- verified account has no organizer rows. Move the curated partner marker and
-- display logo to the active account.
UPDATE public.accounts
   SET is_verified = false
 WHERE account_id = '412631465270287'
   AND type = 'facebook';

UPDATE public.accounts
   SET is_verified = true,
       name = 'Notion Cebu',
       primary_photo = COALESCE(primary_photo, 'https://images.getcebby.com/partners/notioncebu.jpg')
 WHERE account_id = '61566184891202'
   AND type = 'facebook';

-- AWS Cloud Club Meetup groups were seeded from vetted Cebu Meetup groups and
-- intentionally remain visible, but Meetup did not provide avatars in the
-- scraped account payload. Use one shared brand mark instead of initials.
UPDATE public.accounts
   SET primary_photo = COALESCE(primary_photo, 'https://getcebby.com/partners/aws-cloud-club.svg')
 WHERE type = 'meetup'
   AND kind = 'meetup_group'
   AND account_id LIKE 'aws-cloud-club-at-%';
