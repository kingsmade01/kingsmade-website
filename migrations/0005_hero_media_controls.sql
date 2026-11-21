-- Per-slide video playback and image presentation controls for the CMS.
ALTER TABLE km_hero_sections ADD COLUMN video_autoplay INTEGER NOT NULL DEFAULT 1 CHECK (video_autoplay IN (0,1));
ALTER TABLE km_hero_sections ADD COLUMN video_loop INTEGER NOT NULL DEFAULT 1 CHECK (video_loop IN (0,1));
ALTER TABLE km_hero_sections ADD COLUMN overlay_opacity REAL NOT NULL DEFAULT 0.68 CHECK (overlay_opacity >= 0 AND overlay_opacity <= 1);
ALTER TABLE km_hero_sections ADD COLUMN media_position TEXT NOT NULL DEFAULT 'center center';
