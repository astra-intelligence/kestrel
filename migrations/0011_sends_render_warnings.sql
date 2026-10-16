-- 0011_sends_render_warnings: what the render said about a send's frozen copy (SPEC §5, §6).
--
-- The render answers its email with warnings, such as an image the post references but never
-- uploaded. A draft's preview and test show them from a live render, but once the post was
-- scheduled the instruments read the frozen copy and had nothing to say, so a test of a copy
-- missing its image answered clean. The freeze and the re-make now store the warnings their
-- render gave, as a JSON array of strings, beside the copy they describe.
--
-- A send frozen before this column existed reads as `[]`: its render's warnings were never
-- kept, and rendering it again could disagree with the bytes it holds. Adding a column with a
-- constant default rewrites no rows.

ALTER TABLE sends ADD COLUMN render_warnings TEXT NOT NULL DEFAULT '[]';
