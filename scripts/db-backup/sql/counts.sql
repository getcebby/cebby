-- Exact row count of every table in the app schemas, as "schema.table|rows".
-- query_to_xml runs one count(*) per table inside a single read-only statement.
select n.nspname || '.' || c.relname || '|'
       || (xpath('/row/c/text()',
                 query_to_xml(format('select count(*) as c from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname in ('public', 'private') and c.relkind in ('r', 'p')
 order by 1;
