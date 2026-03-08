PRAGMA foreign_keys=OFF;--> statement-breakpoint
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
	`summary` text,
	`cost` text,
	`started_at` text,
	`completed_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`playbook_id`) REFERENCES `playbooks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_jobs`("id", "prompt", "project_id", "playbook_id", "agent_id", "agent_override", "model_override", "status", "parent_job_id", "context_from", "session_id", "summary", "cost", "started_at", "completed_at", "created_at") SELECT "id", "prompt", "project_id", "playbook_id", "agent_id", "agent_override", "model_override", "status", "parent_job_id", "context_from", "session_id", "summary", "cost", "started_at", "completed_at", "created_at" FROM `jobs`;--> statement-breakpoint
DROP TABLE `jobs`;--> statement-breakpoint
ALTER TABLE `__new_jobs` RENAME TO `jobs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;