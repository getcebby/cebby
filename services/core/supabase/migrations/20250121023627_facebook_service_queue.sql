select from pgmq.create('facebook-service');

grant select on table "pgmq"."a_facebook-service" to "pg_monitor";
grant delete on table "pgmq"."a_facebook-service" to "service_role";
grant insert on table "pgmq"."a_facebook-service" to "service_role";
grant references on table "pgmq"."a_facebook-service" to "service_role";
grant select on table "pgmq"."a_facebook-service" to "service_role";
grant trigger on table "pgmq"."a_facebook-service" to "service_role";
grant truncate on table "pgmq"."a_facebook-service" to "service_role";
grant update on table "pgmq"."a_facebook-service" to "service_role";

grant select on table "pgmq"."q_facebook-service" to "pg_monitor";
grant delete on table "pgmq"."q_facebook-service" to "service_role";
grant insert on table "pgmq"."q_facebook-service" to "service_role";
grant references on table "pgmq"."q_facebook-service" to "service_role";
grant select on table "pgmq"."q_facebook-service" to "service_role";
grant trigger on table "pgmq"."q_facebook-service" to "service_role";
grant truncate on table "pgmq"."q_facebook-service" to "service_role";
grant update on table "pgmq"."q_facebook-service" to "service_role";


