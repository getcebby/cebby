UPDATE events
SET slug = CONCAT(
    LOWER(
        REGEXP_REPLACE(
            REGEXP_REPLACE(
                TRIM(name),
                '[^a-z0-9\s]', '', 'gi'
            ),
            '\s+', '-', 'g'
        )
    ),
    '--',
    id
);

INSERT INTO event_slugs (event_id, slug)
SELECT id, slug FROM events;
