CREATE TABLE IF NOT EXISTS source_analytics_migrations (
  name VARCHAR(100) PRIMARY KEY,
  applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS source_tracking_sources (
  id CHAR(36) PRIMARY KEY,
  display_name VARCHAR(160) NOT NULL,
  source_name VARCHAR(100) NOT NULL,
  campaign VARCHAR(160) NULL,
  publication VARCHAR(160) NULL,
  match_key VARCHAR(430) NOT NULL,
  short_code VARCHAR(64) NOT NULL,
  target_path VARCHAR(500) NOT NULL,
  visible_metrics JSON NOT NULL,
  goal_type ENUM('none','scene','chapter_complete') NOT NULL DEFAULT 'none',
  goal_heroine_id VARCHAR(64) NULL,
  goal_chapter_id VARCHAR(64) NULL,
  goal_scene_id VARCHAR(64) NULL,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_source_tracking_match (match_key),
  UNIQUE KEY uq_source_tracking_short_code (short_code),
  KEY ix_source_tracking_status (archived, source_name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS source_tracking_visitors (
  visitor_key CHAR(64) PRIMARY KEY,
  first_source_id CHAR(36) NULL,
  user_id CHAR(36) NULL,
  first_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_source_visitor_user (user_id),
  CONSTRAINT fk_source_visitor_first_source FOREIGN KEY (first_source_id) REFERENCES source_tracking_sources(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS source_tracking_clicks (
  token_hash CHAR(64) PRIMARY KEY,
  source_id CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  confirmed_at DATETIME(3) NULL,
  KEY ix_source_click_created (created_at),
  CONSTRAINT fk_source_click_source FOREIGN KEY (source_id) REFERENCES source_tracking_sources(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS source_tracking_visits (
  id CHAR(36) PRIMARY KEY,
  visitor_key CHAR(64) NOT NULL,
  source_id CHAR(36) NULL,
  attribution_kind ENUM('short','utm','referrer','direct','unassigned_utm') NOT NULL,
  attribution_key VARCHAR(430) NOT NULL,
  utm_source VARCHAR(100) NULL,
  utm_medium VARCHAR(100) NULL,
  utm_campaign VARCHAR(160) NULL,
  utm_content VARCHAR(160) NULL,
  referrer_host VARCHAR(253) NULL,
  user_id CHAR(36) NULL,
  started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_activity_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_source_visit_source_time (source_id, started_at),
  KEY ix_source_visit_visitor_time (visitor_key, last_activity_at),
  KEY ix_source_visit_user (user_id),
  CONSTRAINT fk_source_visit_visitor FOREIGN KEY (visitor_key) REFERENCES source_tracking_visitors(visitor_key),
  CONSTRAINT fk_source_visit_source FOREIGN KEY (source_id) REFERENCES source_tracking_sources(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS source_tracking_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  event_key CHAR(36) NOT NULL,
  dedupe_key VARCHAR(255) NOT NULL,
  visitor_key CHAR(64) NOT NULL,
  visit_id CHAR(36) NOT NULL,
  user_id CHAR(36) NULL,
  event_type ENUM('reading_started','scene_reached','chapter_completed','registration_completed') NOT NULL,
  heroine_id VARCHAR(64) NULL,
  chapter_id VARCHAR(64) NULL,
  scene_id VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_source_event_key (event_key),
  UNIQUE KEY uq_source_event_dedupe (dedupe_key),
  KEY ix_source_event_visit_type_time (visit_id, event_type, created_at),
  KEY ix_source_event_goal (event_type, heroine_id, chapter_id, scene_id, created_at),
  KEY ix_source_event_user (user_id),
  CONSTRAINT fk_source_event_visitor FOREIGN KEY (visitor_key) REFERENCES source_tracking_visitors(visitor_key),
  CONSTRAINT fk_source_event_visit FOREIGN KEY (visit_id) REFERENCES source_tracking_visits(id)
) ENGINE=InnoDB;

INSERT IGNORE INTO source_analytics_migrations(name) VALUES ('001_source_behavior_analytics');
