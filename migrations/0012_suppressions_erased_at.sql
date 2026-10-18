-- 0012_suppressions_erased_at: an erasure is kept whatever suppression the address carries
-- (SPEC §7, Erasing a subscriber).
--
-- An address holds one suppression, and an erasure that found a bounce, a complaint, or a
-- block kept that one in place of its own do-not-contact marker. Lifting that suppression
-- then left the address with nothing on file, so an import or the publisher's hand could
-- add the erased person back without their confirming. `erased_at` records the erasure on
-- the address's one row whatever its reason: when it was erased, or null when it never was.
-- Lifting a suppression that has it turns the row back into the marker, at the erasure's
-- time, and only the person's own confirmation clears it.
--
-- Every marker already here (`reason = 'erased'`) takes its own time, and a trigger gives one
-- to every marker inserted without it, so a marker the previous release's Worker writes while
-- it still serves, between this migration and the deploy or after a rollback, is recorded too.
--
-- What can't be recovered: an erasure that found a bounce, a complaint, or a block before this
-- change wrote nothing of its own, so nothing says it happened. Such an address reads as never
-- erased, and lifting its suppression still leaves it with nothing on file. The same holds for
-- an erasure the previous release's Worker makes over another reason after this migration.

ALTER TABLE suppressions ADD COLUMN erased_at INTEGER;

UPDATE suppressions SET erased_at = created_at WHERE reason = 'erased';

CREATE TRIGGER suppressions_erased_at AFTER INSERT ON suppressions
  WHEN NEW.reason = 'erased' AND NEW.erased_at IS NULL
BEGIN
  UPDATE suppressions SET erased_at = NEW.created_at WHERE email = NEW.email;
END;
