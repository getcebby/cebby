-- ============================================================================
-- Cleanup: drop individual-user FB accounts that were misclassified as fb_page
-- ============================================================================
--
-- pfbid... is Facebook's modern user-profile id format. The fb-scraper's
-- isLikelyPage() heuristic earlier accepted pfbid-id hosts as Pages
-- (it only excluded /profile.php and pure-numeric paths), so 10 individual
-- users landed in `accounts` as kind=fb_page with 12 event_organizers rows
-- across 11 events.
--
-- The heuristic is fixed in services/facebook/supabase/functions/_shared/organizers.ts
-- (this commit) — pfbid hosts are now rejected at scrape time. This migration
-- cleans up the existing rows.
--
-- Order matters:
--   1. capture affected event_ids before the deletes
--   2. drop event_organizers entries for pfbid accounts
--   3. bump events.updated_at on the affected rows so the typesense trigger
--      fires AFTER the organizer deletion lands — search docs lose the
--      individual organizer name without operator action
--   4. drop the 10 accounts rows
-- ============================================================================

DO $$
DECLARE
    affected_event_ids bigint[];
BEGIN
    SELECT array_agg(DISTINCT event_id) INTO affected_event_ids
    FROM public.event_organizers
    WHERE account_id LIKE 'pfbid%';

    DELETE FROM public.event_organizers WHERE account_id LIKE 'pfbid%';

    IF affected_event_ids IS NOT NULL THEN
        UPDATE public.events
           SET updated_at = now()
         WHERE id = ANY(affected_event_ids);

        RAISE NOTICE 'cleaned up pfbid organizers — bumped % events for typesense resync', array_length(affected_event_ids, 1);
    END IF;

    DELETE FROM public.accounts
     WHERE type = 'facebook'
       AND account_id LIKE 'pfbid%';
END
$$;
