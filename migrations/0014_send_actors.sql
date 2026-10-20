-- 0014_send_actors: who acted on a send (SPEC §6, §11, Who acted).
--
-- A send records who scheduled it (by Schedule or Send now), last moved its fire time,
-- canceled it, and last resolved it while it was wedged: the latest of each act, beside the
-- times the send already keeps, rather than a log of every act. Each is the who-acted shape as
-- JSON, `{"kind":"human","email":…,"client":…}` or `{"kind":"service","token_id":…,"client":null}`,
-- written by the same statement as the change it records.
--
-- What can't be recovered: no actor was recorded before this, so every existing send reads as
-- acted on by no one recorded, and nothing is backfilled.

ALTER TABLE sends ADD COLUMN scheduled_by TEXT
  CHECK (json_valid(scheduled_by) AND json_extract(scheduled_by, '$.kind') IN ('human', 'service'));
ALTER TABLE sends ADD COLUMN moved_by TEXT
  CHECK (json_valid(moved_by) AND json_extract(moved_by, '$.kind') IN ('human', 'service'));
ALTER TABLE sends ADD COLUMN canceled_by TEXT
  CHECK (json_valid(canceled_by) AND json_extract(canceled_by, '$.kind') IN ('human', 'service'));
ALTER TABLE sends ADD COLUMN resolved_by TEXT
  CHECK (json_valid(resolved_by) AND json_extract(resolved_by, '$.kind') IN ('human', 'service'));
