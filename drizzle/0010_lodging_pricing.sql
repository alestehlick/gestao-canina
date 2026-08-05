ALTER TABLE establishments ADD COLUMN hotel_standard_daily_rate_cents integer NOT NULL DEFAULT 11000;
ALTER TABLE establishments ADD COLUMN hotel_daycare_daily_rate_cents integer NOT NULL DEFAULT 10000;
ALTER TABLE establishments ADD COLUMN hotel_additional_dog_daily_rate_cents integer NOT NULL DEFAULT 9900;
ALTER TABLE establishments ADD COLUMN hotel_daycare_additional_dog_daily_rate_cents integer NOT NULL DEFAULT 9000;
ALTER TABLE establishments ADD COLUMN hotel_long_stay_discount_percent integer NOT NULL DEFAULT 5;

ALTER TABLE appointments ADD COLUMN lodging_rate_profile text;
ALTER TABLE appointments ADD COLUMN lodging_table_daily_rate_cents integer;

ALTER TABLE invoice_items ADD COLUMN lodging_long_stay_discount_percent integer;
ALTER TABLE invoice_items ADD COLUMN lodging_long_stay_discount_cents integer NOT NULL DEFAULT 0;

PRAGMA optimize;
