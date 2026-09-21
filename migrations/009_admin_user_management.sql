CREATE TABLE key_transactions (
 id CHAR(36) PRIMARY KEY,
 user_id CHAR(36) NOT NULL,
 admin_id CHAR(36) NOT NULL,
 operation ENUM('admin_credit','admin_debit','admin_set_balance') NOT NULL,
 balance_before INT UNSIGNED NOT NULL,
 amount_delta INT NOT NULL,
 balance_after INT UNSIGNED NOT NULL,
 reason VARCHAR(500) NOT NULL,
 idempotency_key CHAR(36) NOT NULL UNIQUE,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
 FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE RESTRICT,
 INDEX key_transaction_user_time (user_id,created_at),
 INDEX key_transaction_admin_time (admin_id,created_at)
);
