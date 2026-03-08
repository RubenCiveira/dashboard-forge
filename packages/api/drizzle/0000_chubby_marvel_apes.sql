CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`markdown_content` text NOT NULL,
	`tools` text DEFAULT '[]' NOT NULL,
	`model` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`source` text DEFAULT 'local' NOT NULL,
	`version` text DEFAULT '1.0.0' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `auto_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`playbook_id` text NOT NULL,
	`pattern` text NOT NULL,
	`action` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`playbook_id`) REFERENCES `playbooks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `job_events` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`event_type` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`prompt` text NOT NULL,
	`project_id` text NOT NULL,
	`playbook_id` text NOT NULL,
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
CREATE TABLE `mcps` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`config` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`health_status` text DEFAULT 'unknown' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `models` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`model_id` text NOT NULL,
	`display_name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `playbooks` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`permission_profile` text DEFAULT 'autonomous' NOT NULL,
	`permissions` text NOT NULL,
	`agent_ids` text DEFAULT '[]' NOT NULL,
	`skill_ids` text DEFAULT '[]' NOT NULL,
	`mcp_ids` text DEFAULT '[]' NOT NULL,
	`agents_rules` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`source_type` text NOT NULL,
	`source_path` text NOT NULL,
	`branch` text,
	`default_model` text DEFAULT 'ollama/qwen3:8b-16k' NOT NULL,
	`env_vars` text DEFAULT '{}' NOT NULL,
	`playbook_ids` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `skills` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`skill_md_content` text NOT NULL,
	`has_scripts` integer DEFAULT false NOT NULL,
	`has_templates` integer DEFAULT false NOT NULL,
	`archive_path` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`source` text DEFAULT 'local' NOT NULL,
	`version` text DEFAULT '1.0.0' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
