ALTER TABLE users ADD COLUMN role ENUM('reader','admin') NOT NULL DEFAULT 'reader';
CREATE TABLE heroines (
 id VARCHAR(64) PRIMARY KEY, name VARCHAR(120) NOT NULL, description TEXT NOT NULL,
 media JSON NOT NULL, archived BOOLEAN NOT NULL DEFAULT FALSE, edit_version INT NOT NULL DEFAULT 1
);
CREATE TABLE chapters (
 id VARCHAR(64) PRIMARY KEY, heroine_id VARCHAR(64) NOT NULL, title VARCHAR(200) NOT NULL,
 description TEXT NOT NULL, display_order INT NOT NULL DEFAULT 0, archived BOOLEAN NOT NULL DEFAULT FALSE,
 published_revision INT NULL, FOREIGN KEY (heroine_id) REFERENCES heroines(id)
);
CREATE TABLE chapter_versions (
 chapter_id VARCHAR(64) NOT NULL, revision INT NOT NULL,
 status ENUM('draft','published') NOT NULL DEFAULT 'draft', edit_version INT NOT NULL DEFAULT 1,
 document JSON NOT NULL, created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY(chapter_id,revision), FOREIGN KEY(chapter_id) REFERENCES chapters(id)
);
CREATE TABLE media_assets (
 id CHAR(36) PRIMARY KEY, filename VARCHAR(100) NOT NULL UNIQUE, mime VARCHAR(80) NOT NULL,
 size_bytes BIGINT NOT NULL, original_name VARCHAR(255) NOT NULL, created_by CHAR(36) NOT NULL,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), FOREIGN KEY(created_by) REFERENCES users(id)
);
CREATE TABLE version_media (
 chapter_id VARCHAR(64) NOT NULL, revision INT NOT NULL, media_id CHAR(36) NOT NULL,
 PRIMARY KEY(chapter_id,revision,media_id), FOREIGN KEY(chapter_id,revision) REFERENCES chapter_versions(chapter_id,revision),
 FOREIGN KEY(media_id) REFERENCES media_assets(id)
);
