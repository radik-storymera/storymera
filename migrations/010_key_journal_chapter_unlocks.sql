ALTER TABLE key_transactions
 MODIFY admin_id CHAR(36) NULL,
 MODIFY operation ENUM('admin_credit','admin_debit','admin_set_balance','chapter_unlock') NOT NULL,
 ADD COLUMN chapter_id VARCHAR(64) NULL AFTER admin_id,
 ADD FOREIGN KEY (chapter_id) REFERENCES chapters(id),
 ADD INDEX key_transaction_chapter (chapter_id);
