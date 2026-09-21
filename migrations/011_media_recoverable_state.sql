ALTER TABLE media_assets
 ADD COLUMN trashed_at DATETIME(3) NULL,
 ADD COLUMN trashed_by CHAR(36) NULL,
 ADD INDEX idx_media_assets_trashed_at (trashed_at),
 ADD CONSTRAINT fk_media_assets_trashed_by FOREIGN KEY (trashed_by) REFERENCES users(id) ON DELETE SET NULL;
