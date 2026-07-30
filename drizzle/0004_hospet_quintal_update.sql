ALTER TABLE `customer_accounts` ADD `cpf` text;
ALTER TABLE `customer_accounts` ADD `birth_date` text;
ALTER TABLE `dogs` ADD `medication_notes` text;
ALTER TABLE `dogs` ADD `vaccines_json` text NOT NULL DEFAULT '[]';
ALTER TABLE `appointments` ADD `lodging_nights` integer;
ALTER TABLE `appointments` ADD `deposit_percent` integer;

UPDATE `service_catalog`
SET `name` = 'Banho e tosa', `base_price_cents` = 9000, `color_token` = '#E31C79'
WHERE `code` = 'hygienic_grooming';
UPDATE `service_catalog`
SET `name` = 'Taxi-dog', `base_price_cents` = 500, `color_token` = '#FFA300'
WHERE `code` = 'transport';
UPDATE `service_catalog` SET `color_token` = '#009CDE' WHERE `code` = 'daycare';
UPDATE `service_catalog` SET `color_token` = '#FF8200' WHERE `code` = 'hotel';
UPDATE `service_catalog` SET `color_token` = '#E31C79' WHERE `code` = 'bath';
