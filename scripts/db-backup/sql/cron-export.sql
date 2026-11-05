-- Production's pg_cron jobs as statements that recreate them. `db dump` leaves cron.job
-- out, so a restore has no cron jobs unless this file is applied.
select format('select cron.schedule(%L, %L, %L);', jobname, schedule, command)
       || case when active then '' else format(E'\nupdate cron.job set active = false where jobname = %L;', jobname) end
  from cron.job
 order by jobid;
