select from pgmq.create('facebook-service');

grant select on table "pgmq"."a_facebook-service" to "pg_monitor";

grant select on table "pgmq"."q_facebook-service" to "pg_monitor";


