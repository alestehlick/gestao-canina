ALTER TABLE `appointments` ADD `primary_service_catalog_id` text REFERENCES service_catalog(id) ON DELETE restrict;

-- Existing duplicate entries remain visible for manual review. The oldest
-- active entry in each duplicate group becomes the canonical protected row;
-- cancelled entries do not participate in the active uniqueness rule.
UPDATE `appointments`
SET `primary_service_catalog_id` = (
  SELECT ai.service_catalog_id
  FROM appointment_items ai
  WHERE ai.appointment_id = appointments.id
  ORDER BY ai.created_at, ai.id
  LIMIT 1
)
WHERE `status` = 'cancelled'
   OR `id` IN (
     SELECT ranked.id
     FROM (
       SELECT a.id,
         row_number() OVER (
           PARTITION BY a.establishment_id, a.dog_id, a.start_date, ai.service_catalog_id
           ORDER BY a.created_at, a.id
         ) AS duplicate_rank
       FROM appointments a
       INNER JOIN appointment_items ai ON ai.appointment_id = a.id
       WHERE a.status <> 'cancelled'
     ) ranked
     WHERE ranked.duplicate_rank = 1
   );

CREATE UNIQUE INDEX `appointments_active_service_day_unique`
ON `appointments` (
  `establishment_id`, `dog_id`, `start_date`, `primary_service_catalog_id`
)
WHERE `status` <> 'cancelled' AND `primary_service_catalog_id` IS NOT NULL;

CREATE TRIGGER `appointments_prevent_lodging_overlap_insert`
BEFORE INSERT ON `appointments`
WHEN NEW.status <> 'cancelled'
  AND EXISTS (
    SELECT 1 FROM service_catalog requested_service
    WHERE requested_service.id = NEW.primary_service_catalog_id
      AND requested_service.code = 'hotel'
  )
  AND EXISTS (
    SELECT 1
    FROM appointments existing
    INNER JOIN service_catalog existing_service
      ON existing_service.id = existing.primary_service_catalog_id
    WHERE existing.establishment_id = NEW.establishment_id
      AND existing.dog_id = NEW.dog_id
      AND existing.status <> 'cancelled'
      AND existing_service.code = 'hotel'
      AND existing.start_date <= NEW.end_date
      AND existing.end_date >= NEW.start_date
  )
BEGIN
  SELECT RAISE(ABORT, 'lodging_overlap');
END;

CREATE TRIGGER `appointments_prevent_lodging_overlap_update`
BEFORE UPDATE OF establishment_id, dog_id, start_date, end_date, status, primary_service_catalog_id
ON `appointments`
WHEN NEW.status <> 'cancelled'
  AND EXISTS (
    SELECT 1 FROM service_catalog requested_service
    WHERE requested_service.id = NEW.primary_service_catalog_id
      AND requested_service.code = 'hotel'
  )
  AND EXISTS (
    SELECT 1
    FROM appointments existing
    INNER JOIN service_catalog existing_service
      ON existing_service.id = existing.primary_service_catalog_id
    WHERE existing.id <> NEW.id
      AND existing.establishment_id = NEW.establishment_id
      AND existing.dog_id = NEW.dog_id
      AND existing.status <> 'cancelled'
      AND existing_service.code = 'hotel'
      AND existing.start_date <= NEW.end_date
      AND existing.end_date >= NEW.start_date
  )
BEGIN
  SELECT RAISE(ABORT, 'lodging_overlap');
END;

PRAGMA optimize;
