-- Recreate `jobs` without FK on playbook_id (playbooks are now file-backed, not DB rows)
--> statement-breakpoint
PRAGMA foreign_keys = OFF;
--> statement-breakpoint
CREATE TABLE `jobs_new` (
	`id` text PRIMARY KEY NOT NULL,
	`prompt` text NOT NULL,
	`project_id` text NOT NULL,
	`playbook_id` text,
	`agent_override` text,
	`model_override` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`parent_job_id` text,
	`context_from` text,
	`session_id` text,
	`summary` text,
	`cost` text,
	`started_at` text,
	`completed_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `jobs_new` SELECT * FROM `jobs`;
--> statement-breakpoint
DROP TABLE `jobs`;
--> statement-breakpoint
ALTER TABLE `jobs_new` RENAME TO `jobs`;
--> statement-breakpoint

-- Recreate `auto_rules` without FK on playbook_id
--> statement-breakpoint
CREATE TABLE `auto_rules_new` (
	`id` text PRIMARY KEY NOT NULL,
	`playbook_id` text NOT NULL,
	`pattern` text NOT NULL,
	`action` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `auto_rules_new` SELECT * FROM `auto_rules`;
--> statement-breakpoint
DROP TABLE `auto_rules`;
--> statement-breakpoint
ALTER TABLE `auto_rules_new` RENAME TO `auto_rules`;
--> statement-breakpoint
PRAGMA foreign_keys = ON;
