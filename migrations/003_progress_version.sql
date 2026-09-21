ALTER TABLE progress ADD CONSTRAINT progress_chapter_version FOREIGN KEY(chapter_id,story_revision) REFERENCES chapter_versions(chapter_id,revision);
