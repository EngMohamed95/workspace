-- Stack Space — Relational MySQL 8 / MariaDB Schema
-- Character Set: utf8mb4 (Full Arabic support) | Storage Engine: InnoDB (ACID Transactions & Foreign Keys)
-- Currency stored strictly as integer piasters (1 EGP = 100 piasters) to avoid floating-point errors.

CREATE DATABASE IF NOT EXISTS stack_space
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE stack_space;

CREATE TABLE IF NOT EXISTS settings (
  id INT PRIMARY KEY,
  workspace_name VARCHAR(120) NOT NULL DEFAULT 'Stack Space',
  hourly_rate_piasters INT NOT NULL DEFAULT 3000,
  phone VARCHAR(40) NOT NULL DEFAULT '',
  address VARCHAR(255) NOT NULL DEFAULT 'القاهرة، مصر',
  receipt_footer VARCHAR(300) NOT NULL DEFAULT 'شكرًا لزيارتكم Stack Space — نتمنى لكم وقتًا مثمرًا!',
  updated_at VARCHAR(40) NOT NULL,
  CONSTRAINT chk_settings_singleton CHECK (id = 1),
  CONSTRAINT chk_settings_rate CHECK (hourly_rate_piasters >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(60) NOT NULL UNIQUE,
  display_name VARCHAR(120) NOT NULL,
  role ENUM('admin', 'receptionist') NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at VARCHAR(40) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auth_tokens (
  token_hash CHAR(64) PRIMARY KEY,
  user_id INT NOT NULL,
  expires_at VARCHAR(40) NOT NULL,
  created_at VARCHAR(40) NOT NULL,
  INDEX idx_auth_tokens_user (user_id),
  CONSTRAINT fk_auth_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS drinks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  price_piasters INT NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at VARCHAR(40) NOT NULL,
  updated_at VARCHAR(40) NOT NULL,
  CONSTRAINT chk_drinks_price CHECK (price_piasters >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS expense_categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL UNIQUE,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at VARCHAR(40) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_number INT NOT NULL UNIQUE,
  client_name VARCHAR(120) NULL,
  hourly_rate_piasters INT NOT NULL,
  started_at VARCHAR(40) NOT NULL,
  ended_at VARCHAR(40) NULL,
  duration_minutes INT NULL,
  session_cost_piasters INT NULL,
  drinks_total_piasters INT NOT NULL DEFAULT 0,
  total_piasters INT NULL,
  payment_method ENUM('cash', 'instapay', 'e_wallet', 'card') NULL,
  status ENUM('open', 'closed', 'cancelled') NOT NULL DEFAULT 'open',
  opened_by_user_id INT NOT NULL,
  closed_by_user_id INT NULL,
  checkout_idempotency_key VARCHAR(160) NULL UNIQUE,
  notes VARCHAR(300) NULL,
  created_at VARCHAR(40) NOT NULL,
  INDEX idx_sessions_status (status),
  INDEX idx_sessions_started_at (started_at),
  CONSTRAINT fk_sessions_opened_by FOREIGN KEY (opened_by_user_id) REFERENCES users(id),
  CONSTRAINT fk_sessions_closed_by FOREIGN KEY (closed_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS session_drinks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  drink_id INT NOT NULL,
  drink_name_snapshot VARCHAR(120) NOT NULL,
  unit_price_piasters INT NOT NULL,
  quantity INT NOT NULL,
  added_by_user_id INT NOT NULL,
  created_at VARCHAR(40) NOT NULL,
  INDEX idx_session_drinks_session (session_id),
  CONSTRAINT fk_session_drinks_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_session_drinks_drink FOREIGN KEY (drink_id) REFERENCES drinks(id),
  CONSTRAINT fk_session_drinks_user FOREIGN KEY (added_by_user_id) REFERENCES users(id),
  CONSTRAINT chk_session_drinks_qty CHECK (quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS direct_drink_sales (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sale_number INT NOT NULL UNIQUE,
  customer_name VARCHAR(120) NULL,
  total_piasters INT NOT NULL,
  payment_method ENUM('cash', 'instapay', 'e_wallet', 'card') NOT NULL,
  idempotency_key VARCHAR(160) NULL UNIQUE,
  created_by_user_id INT NOT NULL,
  occurred_at VARCHAR(40) NOT NULL,
  created_at VARCHAR(40) NOT NULL,
  INDEX idx_direct_sales_occurred (occurred_at),
  CONSTRAINT fk_direct_sales_user FOREIGN KEY (created_by_user_id) REFERENCES users(id),
  CONSTRAINT chk_direct_sales_total CHECK (total_piasters > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS direct_drink_sale_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sale_id INT NOT NULL,
  drink_id INT NOT NULL,
  drink_name_snapshot VARCHAR(120) NOT NULL,
  unit_price_piasters INT NOT NULL,
  quantity INT NOT NULL,
  INDEX idx_direct_sale_items_sale (sale_id),
  CONSTRAINT fk_direct_sale_items_sale FOREIGN KEY (sale_id) REFERENCES direct_drink_sales(id) ON DELETE CASCADE,
  CONSTRAINT fk_direct_sale_items_drink FOREIGN KEY (drink_id) REFERENCES drinks(id),
  CONSTRAINT chk_direct_sale_items_qty CHECK (quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS course_groups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  course_name VARCHAR(140) NOT NULL,
  group_name VARCHAR(140) NOT NULL,
  instructor_name VARCHAR(120) NOT NULL,
  schedule VARCHAR(200) NOT NULL,
  price_piasters INT NOT NULL,
  status ENUM('active', 'completed', 'archived') NOT NULL DEFAULT 'active',
  created_by_user_id INT NOT NULL,
  created_at VARCHAR(40) NOT NULL,
  CONSTRAINT fk_course_groups_user FOREIGN KEY (created_by_user_id) REFERENCES users(id),
  CONSTRAINT chk_course_groups_price CHECK (price_piasters >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS student_enrollments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  course_group_id INT NOT NULL,
  student_name VARCHAR(140) NOT NULL,
  student_phone VARCHAR(40) NOT NULL,
  agreed_price_piasters INT NOT NULL,
  notes VARCHAR(300) NULL,
  enrolled_by_user_id INT NOT NULL,
  enrolled_at VARCHAR(40) NOT NULL,
  INDEX idx_enrollments_group (course_group_id),
  CONSTRAINT fk_enrollments_group FOREIGN KEY (course_group_id) REFERENCES course_groups(id),
  CONSTRAINT fk_enrollments_user FOREIGN KEY (enrolled_by_user_id) REFERENCES users(id),
  CONSTRAINT chk_enrollments_price CHECK (agreed_price_piasters >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS course_payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  enrollment_id INT NOT NULL,
  amount_piasters INT NOT NULL,
  payment_method ENUM('cash', 'instapay', 'e_wallet', 'card') NOT NULL,
  paid_at VARCHAR(40) NOT NULL,
  notes VARCHAR(300) NULL,
  idempotency_key VARCHAR(160) NULL UNIQUE,
  received_by_user_id INT NOT NULL,
  created_at VARCHAR(40) NOT NULL,
  INDEX idx_course_payments_enrollment (enrollment_id),
  CONSTRAINT fk_course_payments_enrollment FOREIGN KEY (enrollment_id) REFERENCES student_enrollments(id),
  CONSTRAINT fk_course_payments_user FOREIGN KEY (received_by_user_id) REFERENCES users(id),
  CONSTRAINT chk_course_payments_amount CHECK (amount_piasters > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ledger_entries (
  id INT AUTO_INCREMENT PRIMARY KEY,
  entry_type ENUM(
    'session_revenue',
    'drinks_revenue',
    'course_payment',
    'other_revenue',
    'expense',
    'refund',
    'owner_deposit',
    'owner_withdrawal'
  ) NOT NULL,
  direction ENUM('in', 'out') NOT NULL,
  amount_piasters INT NOT NULL,
  payment_method ENUM('cash', 'instapay', 'e_wallet', 'card') NOT NULL,
  category_id INT NULL,
  description VARCHAR(400) NOT NULL,
  occurred_at VARCHAR(40) NOT NULL,
  cairo_date CHAR(10) NOT NULL,
  cairo_month CHAR(7) NOT NULL,
  source_type ENUM('session', 'direct_sale', 'course_payment', 'manual', 'refund') NOT NULL,
  source_id INT NULL,
  original_ledger_id INT NULL,
  idempotency_key VARCHAR(180) NULL UNIQUE,
  created_by_user_id INT NOT NULL,
  created_by_name VARCHAR(120) NOT NULL,
  created_at VARCHAR(40) NOT NULL,
  INDEX idx_ledger_month (cairo_month),
  INDEX idx_ledger_date (cairo_date),
  INDEX idx_ledger_type (entry_type),
  INDEX idx_ledger_original (original_ledger_id),
  INDEX idx_ledger_source (source_type, source_id),
  CONSTRAINT fk_ledger_category FOREIGN KEY (category_id) REFERENCES expense_categories(id),
  CONSTRAINT fk_ledger_original FOREIGN KEY (original_ledger_id) REFERENCES ledger_entries(id),
  CONSTRAINT fk_ledger_user FOREIGN KEY (created_by_user_id) REFERENCES users(id),
  CONSTRAINT chk_ledger_amount CHECK (amount_piasters > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  actor_user_id INT NULL,
  actor_name VARCHAR(120) NOT NULL,
  actor_role VARCHAR(30) NOT NULL,
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(60) NOT NULL,
  entity_id INT NULL,
  details_json TEXT NOT NULL,
  created_at VARCHAR(40) NOT NULL,
  INDEX idx_audit_created (created_at),
  CONSTRAINT fk_audit_user FOREIGN KEY (actor_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
