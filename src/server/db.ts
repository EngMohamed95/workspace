// better-sqlite3 is an optional dependency, loaded only for the local SQLite fallback
// (see createDatabase), so a failed native install never blocks a MySQL deployment.
import type Database from 'better-sqlite3';
import mysql, { type Pool, type PoolConnection, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise';
import fs from 'fs';
import path from 'path';

export interface ExecResult {
  insertId: number;
  affectedRows: number;
}

export interface SqlExecutor {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  execute(sql: string, params?: unknown[]): Promise<ExecResult>;
}

export interface SqlDatabase extends SqlExecutor {
  readonly dialect: 'mysql' | 'sqlite';
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const DEFAULT_EXPENSE_CATEGORIES = [
  'الإيجار',
  'الكهرباء',
  'الإنترنت',
  'المرتبات',
  'أجر المدرب',
  'مشتريات المشروبات',
  'النظافة',
  'الصيانة',
  'التسويق',
];

const DEFAULT_DRINKS: Array<{ name: string; pricePiasters: number }> = [
  { name: 'قهوة تركي', pricePiasters: 2500 },
  { name: 'شاي', pricePiasters: 1500 },
  { name: 'نسكافيه', pricePiasters: 3000 },
  { name: 'إسبريسو', pricePiasters: 3500 },
  { name: 'كابتشينو', pricePiasters: 4500 },
  { name: 'عصير فريش', pricePiasters: 4000 },
  { name: 'مياه معدنية', pricePiasters: 1000 },
];

// ==================== MYSQL ADAPTER (PRIMARY) ====================

const MYSQL_SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS settings (
    id INT PRIMARY KEY,
    workspace_name VARCHAR(120) NOT NULL DEFAULT 'Stack Space',
    hourly_rate_piasters INT NOT NULL DEFAULT 3000,
    phone VARCHAR(40) NOT NULL DEFAULT '',
    address VARCHAR(255) NOT NULL DEFAULT 'القاهرة، مصر',
    receipt_footer VARCHAR(300) NOT NULL DEFAULT 'شكرًا لزيارتكم Stack Space — نتمنى لكم وقتًا مثمرًا!',
    updated_at VARCHAR(40) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(60) NOT NULL UNIQUE,
    display_name VARCHAR(120) NOT NULL,
    role ENUM('admin', 'receptionist') NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at VARCHAR(40) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS auth_tokens (
    token_hash CHAR(64) PRIMARY KEY,
    user_id INT NOT NULL,
    expires_at VARCHAR(40) NOT NULL,
    created_at VARCHAR(40) NOT NULL,
    INDEX idx_auth_tokens_user (user_id),
    CONSTRAINT fk_auth_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS drinks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    price_piasters INT NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at VARCHAR(40) NOT NULL,
    updated_at VARCHAR(40) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS expense_categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL UNIQUE,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at VARCHAR(40) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS customers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(140) NOT NULL,
    phone VARCHAR(40) NOT NULL UNIQUE,
    created_by_user_id INT NOT NULL,
    created_at VARCHAR(40) NOT NULL,
    updated_at VARCHAR(40) NOT NULL,
    INDEX idx_customers_name (name),
    CONSTRAINT fk_customers_user FOREIGN KEY (created_by_user_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    session_number INT NOT NULL UNIQUE,
    customer_id INT NULL,
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
    INDEX idx_sessions_customer (customer_id),
    CONSTRAINT fk_sessions_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
    CONSTRAINT fk_sessions_opened_by FOREIGN KEY (opened_by_user_id) REFERENCES users(id),
    CONSTRAINT fk_sessions_closed_by FOREIGN KEY (closed_by_user_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS session_drinks (
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
    CONSTRAINT fk_session_drinks_user FOREIGN KEY (added_by_user_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS direct_drink_sales (
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
    CONSTRAINT fk_direct_sales_user FOREIGN KEY (created_by_user_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS direct_drink_sale_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    sale_id INT NOT NULL,
    drink_id INT NOT NULL,
    drink_name_snapshot VARCHAR(120) NOT NULL,
    unit_price_piasters INT NOT NULL,
    quantity INT NOT NULL,
    INDEX idx_direct_sale_items_sale (sale_id),
    CONSTRAINT fk_direct_sale_items_sale FOREIGN KEY (sale_id) REFERENCES direct_drink_sales(id) ON DELETE CASCADE,
    CONSTRAINT fk_direct_sale_items_drink FOREIGN KEY (drink_id) REFERENCES drinks(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS course_groups (
    id INT AUTO_INCREMENT PRIMARY KEY,
    course_name VARCHAR(140) NOT NULL,
    group_name VARCHAR(140) NOT NULL,
    instructor_name VARCHAR(120) NOT NULL,
    schedule VARCHAR(200) NOT NULL,
    price_piasters INT NOT NULL,
    status ENUM('active', 'completed', 'archived') NOT NULL DEFAULT 'active',
    created_by_user_id INT NOT NULL,
    created_at VARCHAR(40) NOT NULL,
    CONSTRAINT fk_course_groups_user FOREIGN KEY (created_by_user_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS student_enrollments (
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
    CONSTRAINT fk_enrollments_user FOREIGN KEY (enrolled_by_user_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS course_payments (
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
    CONSTRAINT fk_course_payments_user FOREIGN KEY (received_by_user_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS ledger_entries (
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
    CONSTRAINT fk_ledger_user FOREIGN KEY (created_by_user_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS audit_logs (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

class MySqlConnectionExecutor implements SqlExecutor {
  constructor(private readonly conn: Pool | PoolConnection) {}

  async query<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ): Promise<T[]> {
    const [rows] = await this.conn.query<RowDataPacket[]>(sql, params);
    return rows as T[];
  }

  async queryOne<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ): Promise<T | undefined> {
    const rows = await this.query<T>(sql, params);
    return rows[0];
  }

  async execute(sql: string, params: unknown[] = []): Promise<ExecResult> {
    const [res] = await this.conn.query<ResultSetHeader>(sql, params);
    return {
      insertId: Number(res.insertId || 0),
      affectedRows: Number(res.affectedRows || 0),
    };
  }
}

class MySqlDatabase extends MySqlConnectionExecutor implements SqlDatabase {
  readonly dialect = 'mysql' as const;

  constructor(private readonly pool: Pool) {
    super(pool);
  }

  async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const txExec = new MySqlConnectionExecutor(conn);
      const result = await fn(txExec);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

// ==================== SQLITE FALLBACK ADAPTER (LOCAL PREVIEW / TESTS) ====================

class SqliteDatabase implements SqlDatabase {
  readonly dialect = 'sqlite' as const;
  private txChain: Promise<unknown> = Promise.resolve();

  constructor(private readonly db: Database.Database) {}

  async query<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ): Promise<T[]> {
    return this.db.prepare(sql).all(...params) as T[];
  }

  async queryOne<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ): Promise<T | undefined> {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  async execute(sql: string, params: unknown[] = []): Promise<ExecResult> {
    const info = this.db.prepare(sql).run(...params);
    return {
      insertId: Number(info.lastInsertRowid || 0),
      affectedRows: Number(info.changes || 0),
    };
  }

  async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    // Serialize async transactions cleanly on single SQLite connection
    const run = async (): Promise<T> => {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const result = await fn(this);
        this.db.exec('COMMIT');
        return result;
      } catch (err) {
        if (this.db.inTransaction) {
          this.db.exec('ROLLBACK');
        }
        throw err;
      }
    };

    const next = this.txChain.then(run, run);
    this.txChain = next.catch(() => {});
    return next;
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

function initializeSqliteSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      workspace_name TEXT NOT NULL DEFAULT 'Stack Space',
      hourly_rate_piasters INTEGER NOT NULL DEFAULT 3000 CHECK (hourly_rate_piasters >= 0),
      phone TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT 'القاهرة، مصر',
      receipt_footer TEXT NOT NULL DEFAULT 'شكرًا لزيارتكم Stack Space — نتمنى لكم وقتًا مثمرًا!',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'receptionist')),
      password_hash TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens(user_id);

    CREATE TABLE IF NOT EXISTS drinks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price_piasters INTEGER NOT NULL CHECK (price_piasters >= 0),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS expense_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL UNIQUE,
      created_by_user_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_number INTEGER NOT NULL UNIQUE,
      customer_id INTEGER REFERENCES customers(id),
      client_name TEXT,
      hourly_rate_piasters INTEGER NOT NULL CHECK (hourly_rate_piasters >= 0),
      started_at TEXT NOT NULL,
      ended_at TEXT,
      duration_minutes INTEGER,
      session_cost_piasters INTEGER,
      drinks_total_piasters INTEGER NOT NULL DEFAULT 0,
      total_piasters INTEGER,
      payment_method TEXT CHECK (payment_method IN ('cash', 'instapay', 'e_wallet', 'card')),
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'cancelled')),
      opened_by_user_id INTEGER NOT NULL REFERENCES users(id),
      closed_by_user_id INTEGER REFERENCES users(id),
      checkout_idempotency_key TEXT UNIQUE,
      notes TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
    CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_customer ON sessions(customer_id);

    CREATE TABLE IF NOT EXISTS session_drinks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      drink_id INTEGER NOT NULL REFERENCES drinks(id),
      drink_name_snapshot TEXT NOT NULL,
      unit_price_piasters INTEGER NOT NULL CHECK (unit_price_piasters >= 0),
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      added_by_user_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_session_drinks_session ON session_drinks(session_id);

    CREATE TABLE IF NOT EXISTS direct_drink_sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_number INTEGER NOT NULL UNIQUE,
      customer_name TEXT,
      total_piasters INTEGER NOT NULL CHECK (total_piasters > 0),
      payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'instapay', 'e_wallet', 'card')),
      idempotency_key TEXT UNIQUE,
      created_by_user_id INTEGER NOT NULL REFERENCES users(id),
      occurred_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_direct_sales_occurred ON direct_drink_sales(occurred_at);

    CREATE TABLE IF NOT EXISTS direct_drink_sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL REFERENCES direct_drink_sales(id) ON DELETE CASCADE,
      drink_id INTEGER NOT NULL REFERENCES drinks(id),
      drink_name_snapshot TEXT NOT NULL,
      unit_price_piasters INTEGER NOT NULL CHECK (unit_price_piasters >= 0),
      quantity INTEGER NOT NULL CHECK (quantity > 0)
    );
    CREATE INDEX IF NOT EXISTS idx_direct_sale_items_sale ON direct_drink_sale_items(sale_id);

    CREATE TABLE IF NOT EXISTS course_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_name TEXT NOT NULL,
      group_name TEXT NOT NULL,
      instructor_name TEXT NOT NULL,
      schedule TEXT NOT NULL,
      price_piasters INTEGER NOT NULL CHECK (price_piasters >= 0),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
      created_by_user_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS student_enrollments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_group_id INTEGER NOT NULL REFERENCES course_groups(id),
      student_name TEXT NOT NULL,
      student_phone TEXT NOT NULL,
      agreed_price_piasters INTEGER NOT NULL CHECK (agreed_price_piasters >= 0),
      notes TEXT,
      enrolled_by_user_id INTEGER NOT NULL REFERENCES users(id),
      enrolled_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_enrollments_group ON student_enrollments(course_group_id);

    CREATE TABLE IF NOT EXISTS course_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      enrollment_id INTEGER NOT NULL REFERENCES student_enrollments(id),
      amount_piasters INTEGER NOT NULL CHECK (amount_piasters > 0),
      payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'instapay', 'e_wallet', 'card')),
      paid_at TEXT NOT NULL,
      notes TEXT,
      idempotency_key TEXT UNIQUE,
      received_by_user_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_course_payments_enrollment ON course_payments(enrollment_id);

    CREATE TABLE IF NOT EXISTS ledger_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_type TEXT NOT NULL CHECK (entry_type IN (
        'session_revenue',
        'drinks_revenue',
        'course_payment',
        'other_revenue',
        'expense',
        'refund',
        'owner_deposit',
        'owner_withdrawal'
      )),
      direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
      amount_piasters INTEGER NOT NULL CHECK (amount_piasters > 0),
      payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'instapay', 'e_wallet', 'card')),
      category_id INTEGER REFERENCES expense_categories(id),
      description TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      cairo_date TEXT NOT NULL,
      cairo_month TEXT NOT NULL,
      source_type TEXT NOT NULL CHECK (source_type IN ('session', 'direct_sale', 'course_payment', 'manual', 'refund')),
      source_id INTEGER,
      original_ledger_id INTEGER REFERENCES ledger_entries(id),
      idempotency_key TEXT UNIQUE,
      created_by_user_id INTEGER NOT NULL REFERENCES users(id),
      created_by_name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ledger_month ON ledger_entries(cairo_month);
    CREATE INDEX IF NOT EXISTS idx_ledger_date ON ledger_entries(cairo_date);
    CREATE INDEX IF NOT EXISTS idx_ledger_type ON ledger_entries(entry_type);
    CREATE INDEX IF NOT EXISTS idx_ledger_original ON ledger_entries(original_ledger_id);
    CREATE INDEX IF NOT EXISTS idx_ledger_source ON ledger_entries(source_type, source_id);

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_user_id INTEGER REFERENCES users(id),
      actor_name TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      details_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
  `);
}

async function seedReferenceDefaults(db: SqlDatabase): Promise<void> {
  const now = new Date().toISOString();

  const existingSettings = await db.queryOne<{ id: number }>(
    'SELECT id FROM settings WHERE id = 1'
  );
  if (!existingSettings) {
    await db.execute(
      `INSERT INTO settings (id, workspace_name, hourly_rate_piasters, phone, address, receipt_footer, updated_at)
       VALUES (1, 'Stack Space', 3000, '', 'القاهرة، مصر', 'شكرًا لزيارتكم Stack Space — نتمنى لكم وقتًا مثمرًا!', ?)`,
      [now]
    );
  }

  const catRow = await db.queryOne<{ count: number }>(
    'SELECT COUNT(*) as count FROM expense_categories'
  );
  if (Number(catRow?.count || 0) === 0) {
    await db.transaction(async (tx) => {
      for (const name of DEFAULT_EXPENSE_CATEGORIES) {
        const exists = await tx.queryOne<{ id: number }>(
          'SELECT id FROM expense_categories WHERE name = ?',
          [name]
        );
        if (!exists) {
          await tx.execute(
            'INSERT INTO expense_categories (name, is_active, created_at) VALUES (?, 1, ?)',
            [name, now]
          );
        }
      }
    });
  }

  const drinkRow = await db.queryOne<{ count: number }>(
    'SELECT COUNT(*) as count FROM drinks'
  );
  if (Number(drinkRow?.count || 0) === 0) {
    await db.transaction(async (tx) => {
      for (const drink of DEFAULT_DRINKS) {
        await tx.execute(
          'INSERT INTO drinks (name, price_piasters, is_active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)',
          [drink.name, drink.pricePiasters, now, now]
        );
      }
    });
  }
}

async function ensureCustomerSchema(db: SqlDatabase): Promise<void> {
  if (db.dialect === 'mysql') {
    const column = await db.queryOne<{ column_name: string }>(
      `SELECT COLUMN_NAME as column_name
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'sessions'
         AND COLUMN_NAME = 'customer_id'`
    );
    if (!column) {
      await db.execute(
        `ALTER TABLE sessions
         ADD COLUMN customer_id INT NULL AFTER session_number,
         ADD INDEX idx_sessions_customer (customer_id),
         ADD CONSTRAINT fk_sessions_customer
           FOREIGN KEY (customer_id) REFERENCES customers(id)`
      );
    }
    return;
  }

  const columns = await db.query<{ name: string }>('PRAGMA table_info(sessions)');
  if (!columns.some((column) => column.name === 'customer_id')) {
    await db.execute(
      'ALTER TABLE sessions ADD COLUMN customer_id INTEGER REFERENCES customers(id)'
    );
  }
  await db.execute(
    'CREATE INDEX IF NOT EXISTS idx_sessions_customer ON sessions(customer_id)'
  );
}

export async function createDatabase(options?: {
  sqlitePath?: string;
  forceSqlite?: boolean;
}): Promise<SqlDatabase> {
  const mysqlHost = process.env.MYSQL_HOST?.trim();
  const useMySql =
    !options?.forceSqlite &&
    Boolean(mysqlHost) &&
    process.env.DB_DRIVER !== 'sqlite';

  if (useMySql && mysqlHost) {
    const pool = mysql.createPool({
      host: mysqlHost,
      port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER || 'root',
      password: process.env.MYSQL_PASSWORD || '',
      database: process.env.MYSQL_DATABASE || 'stack_space',
      charset: 'utf8mb4',
      decimalNumbers: true,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      ssl:
        process.env.MYSQL_SSL === 'true'
          ? { rejectUnauthorized: true }
          : undefined,
    });

    const db = new MySqlDatabase(pool);
    for (const stmt of MYSQL_SCHEMA_STATEMENTS) {
      await db.execute(stmt);
    }
    await ensureCustomerSchema(db);
    await seedReferenceDefaults(db);
    console.log(
      `Stack Space connected to MySQL database "${process.env.MYSQL_DATABASE || 'stack_space'}" on ${mysqlHost}`
    );
    return db;
  }

  // Local SQLite fallback when MYSQL_HOST is not configured yet (e.g. sandbox preview or isolated unit test)
  const resolvedPath =
    options?.sqlitePath ||
    path.resolve(process.cwd(), process.env.DB_PATH || 'data/stackspace.db');

  if (resolvedPath !== ':memory:') {
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const { default: BetterSqlite3 } = await import('better-sqlite3');
  const rawSqlite = new BetterSqlite3(resolvedPath);
  rawSqlite.pragma('journal_mode = WAL');
  rawSqlite.pragma('foreign_keys = ON');
  rawSqlite.pragma('busy_timeout = 5000');
  initializeSqliteSchema(rawSqlite);

  const db = new SqliteDatabase(rawSqlite);
  await ensureCustomerSchema(db);
  await seedReferenceDefaults(db);
  return db;
}
