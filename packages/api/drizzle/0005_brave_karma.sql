CREATE TABLE `runners` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'unknown' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_auto_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`playbook_id` text NOT NULL,
	`pattern` text NOT NULL,
	`action` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_auto_rules`("id", "playbook_id", "pattern", "action", "description", "created_at") SELECT "id", "playbook_id", "pattern", "action", "description", "created_at" FROM `auto_rules`;--> statement-breakpoint
DROP TABLE `auto_rules`;--> statement-breakpoint
ALTER TABLE `__new_auto_rules` RENAME TO `auto_rules`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`prompt` text NOT NULL,
	`project_id` text NOT NULL,
	`playbook_id` text,
	`agent_id` text,
	`agent_override` text,
	`model_override` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`parent_job_id` text,
	`context_from` text,
	`session_id` text,
	`pid` integer,
	`summary` text,
	`cost` text,
	`started_at` text,
	`completed_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_jobs`("id", "prompt", "project_id", "playbook_id", "agent_id", "agent_override", "model_override", "status", "parent_job_id", "context_from", "session_id", "pid", "summary", "cost", "started_at", "completed_at", "created_at") SELECT "id", "prompt", "project_id", "playbook_id", "agent_id", "agent_override", "model_override", "status", "parent_job_id", "context_from", "session_id", "pid", "summary", "cost", "started_at", "completed_at", "created_at" FROM `jobs`;--> statement-breakpoint
DROP TABLE `jobs`;--> statement-breakpoint
ALTER TABLE `__new_jobs` RENAME TO `jobs`;--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `default_model`;