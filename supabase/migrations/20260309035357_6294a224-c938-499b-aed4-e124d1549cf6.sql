-- Add unique constraint on score_history to prevent duplicate upserts
ALTER TABLE public.score_history
ADD CONSTRAINT score_history_user_asset_date_unique
UNIQUE (user_id, asset_id, snapshot_date);