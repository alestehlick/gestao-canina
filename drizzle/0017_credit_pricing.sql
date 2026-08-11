ALTER TABLE establishments ADD COLUMN daycare_under_4_unit_cents integer NOT NULL DEFAULT 6500;
ALTER TABLE establishments ADD COLUMN daycare_4_to_7_unit_cents integer NOT NULL DEFAULT 6000;
ALTER TABLE establishments ADD COLUMN daycare_8_to_11_unit_cents integer NOT NULL DEFAULT 5800;
ALTER TABLE establishments ADD COLUMN daycare_12_plus_unit_cents integer NOT NULL DEFAULT 5600;
ALTER TABLE establishments ADD COLUMN daycare_multi_dog_discount_percent integer NOT NULL DEFAULT 15;
ALTER TABLE establishments ADD COLUMN bath_under_4_regular_unit_cents integer NOT NULL DEFAULT 6000;
ALTER TABLE establishments ADD COLUMN bath_under_4_daycare_unit_cents integer NOT NULL DEFAULT 5500;
ALTER TABLE establishments ADD COLUMN bath_4_plus_regular_unit_cents integer NOT NULL DEFAULT 5500;
ALTER TABLE establishments ADD COLUMN bath_4_plus_daycare_unit_cents integer NOT NULL DEFAULT 5000;
ALTER TABLE establishments ADD COLUMN taxi_dog_short_unit_cents integer NOT NULL DEFAULT 500;
ALTER TABLE establishments ADD COLUMN taxi_dog_long_unit_cents integer NOT NULL DEFAULT 1000;

ALTER TABLE appointment_items ADD COLUMN billing_pricing_profile text;

ALTER TABLE credit_purchases ADD COLUMN pricing_profile_snapshot text NOT NULL DEFAULT 'legacy';
ALTER TABLE credit_purchases ADD COLUMN suggested_unit_price_cents integer;
ALTER TABLE credit_purchases ADD COLUMN suggested_amount_cents integer;

PRAGMA optimize;
