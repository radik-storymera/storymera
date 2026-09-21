CREATE TABLE plan_analytics_events (
 id CHAR(36) PRIMARY KEY,
 user_id CHAR(36) NULL,
 event_type ENUM('plans_page_viewed','plan_selected','checkout_clicked','payment_unavailable_shown','returned_to_stories') NOT NULL,
 plan_id VARCHAR(32) CHARACTER SET ascii NULL,
 plan_keys INT UNSIGNED NULL,
 price_minor INT UNSIGNED NULL,
 currency CHAR(3) CHARACTER SET ascii NULL,
 user_key_balance INT UNSIGNED NOT NULL,
 heroine_id VARCHAR(64) NULL,
 chapter_id VARCHAR(64) NULL,
 source ENUM('locked_chapter','header_balance','profile','chapter_completed','other') NOT NULL DEFAULT 'other',
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
 INDEX plan_event_type_time (event_type,created_at),
 INDEX plan_event_user_time (user_id,created_at),
 INDEX plan_event_plan_time (plan_id,created_at)
);
