-- Add pid column to jobs for process lifecycle tracking
ALTER TABLE `jobs` ADD COLUMN `pid` integer;
