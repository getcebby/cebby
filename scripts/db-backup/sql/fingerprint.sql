-- One line per object in the app schemas (public, private): tables, columns, functions,
-- views, policies, triggers, indexes, constraints, and who may use each of them.
-- backup.sh records it from production and verify.sh requires a restore to match it
-- exactly, so a restore can't quietly lose a policy or reopen a revoked grant.
--
-- ACLs are compared by effect: a NULL ACL is replaced by acldefault(), so "stored
-- explicitly" and "left at the default" match when they grant the same rights.
-- Run with search_path = pg_catalog (lib.sh does), because definitions print
-- relative to the search_path.
with s as (select oid, nspname from pg_namespace where nspname in ('public', 'private'))
select 'schema ' || s.nspname || ' ' || coalesce(n.nspacl, acldefault('n', n.nspowner))::text
  from s join pg_namespace n on n.oid = s.oid
union all
select 'rel ' || s.nspname || '.' || c.relname || ' ' || c.relkind::text
       || ' rls=' || c.relrowsecurity::text || '/' || c.relforcerowsecurity::text || ' '
       || coalesce(c.relacl, acldefault((case when c.relkind = 'S' then 's' else 'r' end)::"char", c.relowner))::text
  from pg_class c join s on s.oid = c.relnamespace
 where c.relkind in ('r', 'v', 'm', 'S', 'p', 'f')
union all
select 'col ' || s.nspname || '.' || c.relname || '.' || a.attname || ' '
       || format_type(a.atttypid, a.atttypmod) || ' ' || coalesce(a.attacl::text, '-')
  from pg_attribute a join pg_class c on c.oid = a.attrelid join s on s.oid = c.relnamespace
 where c.relkind in ('r', 'v', 'm', 'p', 'f') and a.attnum > 0 and not a.attisdropped
union all
select 'fn ' || s.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
       || ' secdef=' || p.prosecdef::text || ' src=' || md5(p.prosrc) || ' '
       || coalesce(p.proacl, acldefault('f', p.proowner))::text
  from pg_proc p join s on s.oid = p.pronamespace
union all
select 'view ' || schemaname || '.' || viewname || ' ' || md5(definition)
  from pg_views where schemaname in ('public', 'private')
union all
select 'policy ' || schemaname || '.' || tablename || '.' || policyname || ' ' || cmd || ' ' || roles::text
       || ' ' || md5(coalesce(qual, '') || '|' || coalesce(with_check, ''))
  from pg_policies where schemaname in ('public', 'private')
union all
select 'trigger ' || s.nspname || '.' || c.relname || '.' || t.tgname || ' ' || md5(pg_get_triggerdef(t.oid))
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join s on s.oid = c.relnamespace
 where not t.tgisinternal
union all
select 'index ' || schemaname || '.' || indexname || ' ' || md5(indexdef)
  from pg_indexes where schemaname in ('public', 'private')
union all
select 'constraint ' || s.nspname || '.' || c.relname || '.' || k.conname || ' ' || md5(pg_get_constraintdef(k.oid))
  from pg_constraint k join pg_class c on c.oid = k.conrelid join s on s.oid = c.relnamespace
union all
select 'defacl ' || n.nspname || ' ' || d.defaclobjtype::text || ' ' || d.defaclacl::text
  from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
 where n.nspname in ('public', 'private') and pg_get_userbyid(d.defaclrole) = 'postgres'
order by 1;
