ALTER TABLE `game_interactions` ADD `assignment_id` text REFERENCES daily_assignments(id) ON DELETE SET NULL;
