ALTER TABLE establishments ADD COLUMN bath_grooming_addon_cents integer NOT NULL DEFAULT 3000;

PRAGMA optimize;
