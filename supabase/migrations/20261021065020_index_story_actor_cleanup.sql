-- Account deletion and cascades must find a viewer's/reaction actor's rows
-- without scanning the complete Story interaction history.
begin;
create index story_views_viewer_cleanup on private.story_views(viewer_id);
create index story_reactions_actor_cleanup on private.story_reactions(actor_id);
create index story_notification_receipts_actor_cleanup on private.story_notification_receipts(actor_id);
commit;
