CREATE TABLE guest_sessions (
 id CHAR(36) PRIMARY KEY,
 token_hash CHAR(64) NOT NULL UNIQUE,
 expires_at DATETIME(3) NOT NULL,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);
ALTER TABLE progress
 DROP PRIMARY KEY,
 MODIFY user_id CHAR(36) NULL,
 ADD COLUMN id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY FIRST,
 ADD COLUMN guest_id CHAR(36) NULL AFTER user_id,
 ADD COLUMN completed_at DATETIME(3) NULL AFTER save_version,
 ADD UNIQUE KEY progress_user_chapter (user_id,heroine_id,chapter_id),
 ADD UNIQUE KEY progress_guest_chapter (guest_id,heroine_id,chapter_id),
 ADD CONSTRAINT progress_guest_fk FOREIGN KEY (guest_id) REFERENCES guest_sessions(id) ON DELETE CASCADE,
 ADD CONSTRAINT progress_one_owner CHECK ((user_id IS NULL) <> (guest_id IS NULL));
