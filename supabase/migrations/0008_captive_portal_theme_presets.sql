-- ---------------------------------------------------------------------------
-- Captive portal theme presets — doodle_set was a schema hook for a
-- "background doodle variant" that never got a second file built for it;
-- it's been dead end-to-end (no UI control ever wrote to it, no code ever
-- read it) since 0001. Renaming now, while it's provably unused, is far
-- cheaper than renaming later once orgs have real theme selections stored.
-- ---------------------------------------------------------------------------
alter table captive_portal_themes rename column doodle_set to theme;

alter table captive_portal_themes drop constraint if exists captive_portal_themes_theme_check;
alter table captive_portal_themes add constraint captive_portal_themes_theme_check
  check (theme in ('waves', 'mono', 'sunrise', 'circuit', 'garden', 'midnight'));
