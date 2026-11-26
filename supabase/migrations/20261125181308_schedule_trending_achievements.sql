-- Enable only after the notification payload handler and audio metadata rollout.
-- pg_cron runs this small chart snapshot every five minutes. The ledger makes retries idempotent.
select cron.schedule('sautilink-trending-achievements-v1','*/5 * * * *',
 'select private.notify_trending_achievements_v1();');
