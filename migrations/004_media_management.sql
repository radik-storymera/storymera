ALTER TABLE media_assets ADD COLUMN poster_id CHAR(36) NULL;
ALTER TABLE media_assets ADD CONSTRAINT fk_media_poster FOREIGN KEY (poster_id) REFERENCES media_assets(id) ON DELETE RESTRICT;
CREATE TABLE media_trash (
 id CHAR(36) PRIMARY KEY,
 filename VARCHAR(100) NOT NULL UNIQUE,
 mime VARCHAR(80) NOT NULL,
 size_bytes BIGINT NOT NULL,
 original_name VARCHAR(255) NOT NULL,
 created_by CHAR(36) NOT NULL,
 poster_id CHAR(36) NULL,
 deleted_by CHAR(36) NOT NULL,
 deleted_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);
