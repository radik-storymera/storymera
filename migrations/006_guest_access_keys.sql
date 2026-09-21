ALTER TABLE users ADD COLUMN key_balance INT UNSIGNED NOT NULL DEFAULT 0;
ALTER TABLE chapters
 ADD COLUMN key_cost INT UNSIGNED NOT NULL DEFAULT 0,
 ADD COLUMN guest_free BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE progress ADD COLUMN completed_scenes JSON NOT NULL DEFAULT (JSON_ARRAY()) AFTER scene_id;

UPDATE chapters SET key_cost=1;
UPDATE chapters
SET key_cost=0,guest_free=TRUE
WHERE id=(
 SELECT id FROM (
  SELECT c.id
  FROM chapters c
  JOIN heroines h ON h.id=c.heroine_id
  WHERE c.archived=FALSE AND c.published_revision IS NOT NULL
  ORDER BY CASE WHEN h.id='jessica' THEN 0 ELSE 1 END,h.name,c.display_order,c.id
  LIMIT 1
 ) AS guest_entry
);

CREATE TABLE chapter_unlocks (
 user_id CHAR(36) NOT NULL,
 chapter_id VARCHAR(64) NOT NULL,
 key_cost INT UNSIGNED NOT NULL,
 unlocked_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY (user_id,chapter_id),
 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
 FOREIGN KEY (chapter_id) REFERENCES chapters(id)
);

CREATE TABLE poll_progress (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 poll_id BIGINT UNSIGNED NOT NULL,
 user_id CHAR(36) NULL,
 guest_id CHAR(36) NULL,
 status ENUM('available','voted','skipped') NOT NULL DEFAULT 'available',
 first_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 UNIQUE KEY poll_progress_user (poll_id,user_id),
 UNIQUE KEY poll_progress_guest (poll_id,guest_id),
 FOREIGN KEY (poll_id) REFERENCES polls(id),
 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
 FOREIGN KEY (guest_id) REFERENCES guest_sessions(id) ON DELETE CASCADE,
 CONSTRAINT poll_progress_one_owner CHECK ((user_id IS NULL) <> (guest_id IS NULL))
);

CREATE TABLE analytics_events (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 event_type VARCHAR(64) CHARACTER SET ascii NOT NULL,
 user_id CHAR(36) NULL,
 guest_id CHAR(36) NULL,
 heroine_id VARCHAR(64) NULL,
 chapter_id VARCHAR(64) NULL,
 scene_id VARCHAR(64) NULL,
 poll_id BIGINT UNSIGNED NULL,
 device_type ENUM('desktop','tablet','mobile','unknown') NOT NULL DEFAULT 'unknown',
 source VARCHAR(120) NOT NULL DEFAULT 'reader',
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
 FOREIGN KEY (guest_id) REFERENCES guest_sessions(id) ON DELETE SET NULL,
 FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE SET NULL,
 INDEX analytics_event_time (event_type,created_at),
 INDEX analytics_user_time (user_id,created_at),
 INDEX analytics_guest_time (guest_id,created_at)
);
