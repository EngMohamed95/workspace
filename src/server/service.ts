import type { SqlDatabase, SqlExecutor } from './db.ts';
import {
  constantTimeStringEquals,
  createAuthToken,
  getConfiguredAdminPasscode,
  hashPassword,
  mapUserRow,
  requireRole,
  verifyPassword,
} from './auth.ts';
import {
  calculateDurationMinutes,
  calculateSessionCostPiasters,
  formatDurationArabic,
  getCairoDateParts,
  getCurrentCairoMonth,
} from '../shared/format.ts';
import type {
  AuditLogItem,
  AuthUser,
  CourseGroup,
  CoursePayment,
  Customer,
  DirectDrinkSale,
  DirectDrinkSaleItem,
  DrinkItem,
  ExpenseCategory,
  LedgerEntry,
  LedgerEntryType,
  MonthlyExpenseCategoryBreakdown,
  MonthlyProfitReport,
  MonthlyReportLine,
  PaymentMethod,
  ReceiptData,
  SessionDrinkItem,
  StudentEnrollment,
  UserRole,
  WorkspaceSession,
  WorkspaceSettings,
} from '../shared/types.ts';

export class AppError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export class StackSpaceService {
  constructor(private readonly db: SqlDatabase) {}

  private async logAudit(
    exec: SqlExecutor,
    actor: Pick<AuthUser, 'id' | 'displayName' | 'role'> | null,
    action: string,
    entityType: string,
    entityId: number | null,
    details: Record<string, unknown>
  ): Promise<void> {
    await exec.execute(
      `INSERT INTO audit_logs (actor_user_id, actor_name, actor_role, action, entity_type, entity_id, details_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        actor ? actor.id : null,
        actor ? actor.displayName : 'النظام',
        actor ? actor.role : 'system',
        action,
        entityType,
        entityId,
        JSON.stringify(details),
        new Date().toISOString(),
      ]
    );
  }

  // ==================== AUTH & USERS ====================

  async getAuthStatus(): Promise<{
    needsSetup: boolean;
    envAdminConfigured: boolean;
  }> {
    const row = await this.db.queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM users'
    );
    const count = Number(row?.count || 0);
    const envAdminConfigured = Boolean(getConfiguredAdminPasscode());
    return {
      needsSetup: count === 0 && !envAdminConfigured,
      envAdminConfigured,
    };
  }

  async bootstrapAdmin(input: {
    username: string;
    displayName: string;
    password: string;
    receptionist?: {
      username: string;
      displayName: string;
      password: string;
    };
  }): Promise<{ token: string; user: AuthUser }> {
    if (getConfiguredAdminPasscode()) {
      throw new AppError(
        'تم إعداد رمز دخول المدير مسبقًا عبر متغيرات البيئة.',
        403
      );
    }

    return this.db.transaction(async (tx) => {
      const countRow = await tx.queryOne<{ count: number }>(
        'SELECT COUNT(*) as count FROM users'
      );
      if (Number(countRow?.count || 0) > 0) {
        throw new AppError('تم إعداد حساب المدير مسبقًا.', 403);
      }

      const now = new Date().toISOString();
      const adminUsername = input.username.trim().toLowerCase();
      const adminHash = hashPassword(input.password);
      const adminInsert = await tx.execute(
        `INSERT INTO users (username, display_name, role, password_hash, is_active, created_at)
         VALUES (?, ?, 'admin', ?, 1, ?)`,
        [adminUsername, input.displayName.trim(), adminHash, now]
      );

      const adminId = adminInsert.insertId;
      const adminRow = await tx.queryOne<{
        id: number;
        username: string;
        display_name: string;
        role: UserRole;
        is_active: number;
        created_at: string;
      }>('SELECT * FROM users WHERE id = ?', [adminId]);
      const adminUser = mapUserRow(adminRow!);

      await this.logAudit(tx, adminUser, 'bootstrap_admin', 'user', adminId, {
        username: adminUsername,
      });

      if (input.receptionist && input.receptionist.username.trim()) {
        const recUsername = input.receptionist.username.trim().toLowerCase();
        if (recUsername === adminUsername) {
          throw new AppError(
            'اسم مستخدم موظف الاستقبال يجب أن يختلف عن اسم مستخدم المدير.',
            400
          );
        }
        const recHash = hashPassword(input.receptionist.password);
        const recInsert = await tx.execute(
          `INSERT INTO users (username, display_name, role, password_hash, is_active, created_at)
           VALUES (?, ?, 'receptionist', ?, 1, ?)`,
          [
            recUsername,
            input.receptionist.displayName.trim(),
            recHash,
            now,
          ]
        );
        await this.logAudit(
          tx,
          adminUser,
          'create_user',
          'user',
          recInsert.insertId,
          { username: recUsername, role: 'receptionist' }
        );
      }

      const token = await createAuthToken(tx, adminId);
      return { token, user: adminUser };
    });
  }

  async login(
    username: string,
    password: string
  ): Promise<{ token: string; user: AuthUser }> {
    const cleanUsername = username.trim().toLowerCase();
    const envPasscode = getConfiguredAdminPasscode();

    if (
      envPasscode &&
      cleanUsername === 'admin' &&
      constantTimeStringEquals(password, envPasscode)
    ) {
      return this.db.transaction(async (tx) => {
        let row = await tx.queryOne<{
          id: number;
          username: string;
          display_name: string;
          role: UserRole;
          is_active: number;
          created_at: string;
        }>('SELECT * FROM users WHERE LOWER(username) = ?', ['admin']);

        if (!row) {
          const now = new Date().toISOString();
          const res = await tx.execute(
            `INSERT INTO users (username, display_name, role, password_hash, is_active, created_at)
             VALUES ('admin', 'مدير المكان', 'admin', ?, 1, ?)`,
            [hashPassword(envPasscode), now]
          );
          row = await tx.queryOne('SELECT * FROM users WHERE id = ?', [
            res.insertId,
          ]);
        }
        if (!row || Number(row.is_active) !== 1) {
          throw new AppError('هذا الحساب موقوف حاليًا.', 403);
        }
        const user = mapUserRow(row);
        const token = await createAuthToken(tx, user.id);
        await this.logAudit(tx, user, 'login', 'user', user.id, {
          viaEnvPasscode: true,
        });
        return { token, user };
      });
    }

    const row = await this.db.queryOne<{
      id: number;
      username: string;
      display_name: string;
      role: UserRole;
      password_hash: string;
      is_active: number;
      created_at: string;
    }>('SELECT * FROM users WHERE LOWER(username) = ?', [cleanUsername]);

    if (!row || !verifyPassword(password, row.password_hash)) {
      throw new AppError('اسم المستخدم أو كلمة المرور غير صحيحة.', 401);
    }
    if (Number(row.is_active) !== 1) {
      throw new AppError('هذا الحساب موقوف حاليًا، يرجى مراجعة المدير.', 403);
    }

    const user = mapUserRow(row);
    const token = await createAuthToken(this.db, user.id);
    await this.logAudit(this.db, user, 'login', 'user', user.id, {});
    return { token, user };
  }

  async listUsers(actor: AuthUser): Promise<AuthUser[]> {
    requireRole(actor, ['admin']);
    const rows = await this.db.query<{
      id: number;
      username: string;
      display_name: string;
      role: UserRole;
      is_active: number;
      created_at: string;
    }>(
      'SELECT id, username, display_name, role, is_active, created_at FROM users ORDER BY id ASC'
    );
    return rows.map(mapUserRow);
  }

  async createUser(
    actor: AuthUser,
    input: {
      username: string;
      displayName: string;
      role: UserRole;
      password: string;
    }
  ): Promise<AuthUser> {
    requireRole(actor, ['admin']);
    const cleanUsername = input.username.trim().toLowerCase();
    const existing = await this.db.queryOne<{ id: number }>(
      'SELECT id FROM users WHERE LOWER(username) = ?',
      [cleanUsername]
    );
    if (existing) {
      throw new AppError('اسم المستخدم مستخدم بالفعل.', 409);
    }

    const now = new Date().toISOString();
    const res = await this.db.execute(
      `INSERT INTO users (username, display_name, role, password_hash, is_active, created_at)
       VALUES (?, ?, ?, ?, 1, ?)`,
      [
        cleanUsername,
        input.displayName.trim(),
        input.role,
        hashPassword(input.password),
        now,
      ]
    );

    const id = res.insertId;
    await this.logAudit(this.db, actor, 'create_user', 'user', id, {
      username: cleanUsername,
      role: input.role,
    });

    const row = await this.db.queryOne<{
      id: number;
      username: string;
      display_name: string;
      role: UserRole;
      is_active: number;
      created_at: string;
    }>(
      'SELECT id, username, display_name, role, is_active, created_at FROM users WHERE id = ?',
      [id]
    );
    return mapUserRow(row!);
  }

  async updateUser(
    actor: AuthUser,
    userId: number,
    input: {
      displayName?: string;
      role?: UserRole;
      isActive?: boolean;
      password?: string;
    }
  ): Promise<AuthUser> {
    requireRole(actor, ['admin']);
    const existing = await this.db.queryOne<{
      id: number;
      username: string;
      display_name: string;
      role: UserRole;
      is_active: number;
      created_at: string;
    }>('SELECT * FROM users WHERE id = ?', [userId]);
    if (!existing) {
      throw new AppError('المستخدم غير موجود.', 404);
    }
    if (userId === actor.id && input.isActive === false) {
      throw new AppError('لا يمكنك إيقاف حسابك الحالي.', 400);
    }
    if (userId === actor.id && input.role && input.role !== 'admin') {
      throw new AppError('لا يمكنك تغيير دور حسابك الحالي.', 400);
    }

    const nextDisplayName = input.displayName?.trim() || existing.display_name;
    const nextRole = input.role || existing.role;
    const nextActive =
      input.isActive !== undefined
        ? input.isActive
          ? 1
          : 0
        : Number(existing.is_active);

    await this.db.transaction(async (tx) => {
      if (input.password && input.password.trim().length > 0) {
        await tx.execute(
          'UPDATE users SET display_name = ?, role = ?, is_active = ?, password_hash = ? WHERE id = ?',
          [
            nextDisplayName,
            nextRole,
            nextActive,
            hashPassword(input.password),
            userId,
          ]
        );
      } else {
        await tx.execute(
          'UPDATE users SET display_name = ?, role = ?, is_active = ? WHERE id = ?',
          [nextDisplayName, nextRole, nextActive, userId]
        );
      }

      if (nextActive === 0) {
        await tx.execute('DELETE FROM auth_tokens WHERE user_id = ?', [userId]);
      }

      await this.logAudit(tx, actor, 'update_user', 'user', userId, {
        displayName: nextDisplayName,
        role: nextRole,
        isActive: nextActive === 1,
        passwordChanged: Boolean(input.password),
      });
    });

    const updated = await this.db.queryOne<typeof existing>(
      'SELECT id, username, display_name, role, is_active, created_at FROM users WHERE id = ?',
      [userId]
    );
    return mapUserRow(updated!);
  }

  // ==================== SETTINGS ====================

  async getSettings(exec: SqlExecutor = this.db): Promise<WorkspaceSettings> {
    const row = await exec.queryOne<{
      workspace_name: string;
      hourly_rate_piasters: number;
      phone: string;
      address: string;
      receipt_footer: string;
      updated_at: string;
    }>('SELECT * FROM settings WHERE id = 1');

    return {
      workspaceName: row!.workspace_name,
      hourlyRatePiasters: Number(row!.hourly_rate_piasters),
      phone: row!.phone,
      address: row!.address,
      receiptFooter: row!.receipt_footer,
      updatedAt: row!.updated_at,
    };
  }

  async updateSettings(
    actor: AuthUser,
    input: {
      workspaceName?: string;
      hourlyRatePiasters?: number;
      phone?: string;
      address?: string;
      receiptFooter?: string;
    }
  ): Promise<WorkspaceSettings> {
    requireRole(actor, ['admin']);
    const current = await this.getSettings();
    const now = new Date().toISOString();

    const next = {
      workspaceName: input.workspaceName?.trim() || current.workspaceName,
      hourlyRatePiasters:
        input.hourlyRatePiasters !== undefined
          ? Math.round(input.hourlyRatePiasters)
          : current.hourlyRatePiasters,
      phone: input.phone !== undefined ? input.phone.trim() : current.phone,
      address:
        input.address !== undefined ? input.address.trim() : current.address,
      receiptFooter:
        input.receiptFooter !== undefined
          ? input.receiptFooter.trim()
          : current.receiptFooter,
    };

    if (next.hourlyRatePiasters < 0) {
      throw new AppError('سعر الساعة لا يمكن أن يكون سالبًا.', 400);
    }

    await this.db.execute(
      `UPDATE settings
       SET workspace_name = ?, hourly_rate_piasters = ?, phone = ?, address = ?, receipt_footer = ?, updated_at = ?
       WHERE id = 1`,
      [
        next.workspaceName,
        next.hourlyRatePiasters,
        next.phone,
        next.address,
        next.receiptFooter,
        now,
      ]
    );

    await this.logAudit(this.db, actor, 'update_settings', 'settings', 1, {
      previousHourlyRatePiasters: current.hourlyRatePiasters,
      newHourlyRatePiasters: next.hourlyRatePiasters,
      workspaceName: next.workspaceName,
    });

    return this.getSettings();
  }

  // ==================== DRINKS ====================

  async listDrinks(includeInactive = true): Promise<DrinkItem[]> {
    const query = includeInactive
      ? 'SELECT * FROM drinks ORDER BY is_active DESC, id ASC'
      : 'SELECT * FROM drinks WHERE is_active = 1 ORDER BY id ASC';
    const rows = await this.db.query<{
      id: number;
      name: string;
      price_piasters: number;
      is_active: number;
      created_at: string;
      updated_at: string;
    }>(query);
    return rows.map((r) => ({
      id: Number(r.id),
      name: r.name,
      pricePiasters: Number(r.price_piasters),
      isActive: Number(r.is_active) === 1,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async createDrink(
    actor: AuthUser,
    input: { name: string; pricePiasters: number }
  ): Promise<DrinkItem> {
    requireRole(actor, ['admin']);
    const now = new Date().toISOString();
    const res = await this.db.execute(
      'INSERT INTO drinks (name, price_piasters, is_active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)',
      [input.name.trim(), Math.round(input.pricePiasters), now, now]
    );

    const id = res.insertId;
    await this.logAudit(this.db, actor, 'create_drink', 'drink', id, {
      name: input.name.trim(),
      pricePiasters: Math.round(input.pricePiasters),
    });

    const list = await this.listDrinks(true);
    return list.find((d) => d.id === id)!;
  }

  async updateDrink(
    actor: AuthUser,
    drinkId: number,
    input: { name?: string; pricePiasters?: number; isActive?: boolean }
  ): Promise<DrinkItem> {
    requireRole(actor, ['admin']);
    const existing = await this.db.queryOne<{
      id: number;
      name: string;
      price_piasters: number;
      is_active: number;
    }>('SELECT * FROM drinks WHERE id = ?', [drinkId]);
    if (!existing) {
      throw new AppError('الصنف غير موجود.', 404);
    }

    const nextName = input.name?.trim() || existing.name;
    const nextPrice =
      input.pricePiasters !== undefined
        ? Math.round(input.pricePiasters)
        : Number(existing.price_piasters);
    const nextActive =
      input.isActive !== undefined
        ? input.isActive
          ? 1
          : 0
        : Number(existing.is_active);

    if (nextPrice < 0) {
      throw new AppError('سعر المشروب لا يمكن أن يكون سالبًا.', 400);
    }

    await this.db.execute(
      'UPDATE drinks SET name = ?, price_piasters = ?, is_active = ?, updated_at = ? WHERE id = ?',
      [nextName, nextPrice, nextActive, new Date().toISOString(), drinkId]
    );

    await this.logAudit(this.db, actor, 'update_drink', 'drink', drinkId, {
      previousPricePiasters: Number(existing.price_piasters),
      newPricePiasters: nextPrice,
      name: nextName,
      isActive: nextActive === 1,
    });

    const list = await this.listDrinks(true);
    return list.find((d) => d.id === drinkId)!;
  }

  // ==================== EXPENSE CATEGORIES ====================

  async listExpenseCategories(
    includeInactive = true
  ): Promise<ExpenseCategory[]> {
    const query = includeInactive
      ? 'SELECT * FROM expense_categories ORDER BY is_active DESC, id ASC'
      : 'SELECT * FROM expense_categories WHERE is_active = 1 ORDER BY id ASC';
    const rows = await this.db.query<{
      id: number;
      name: string;
      is_active: number;
      created_at: string;
    }>(query);
    return rows.map((r) => ({
      id: Number(r.id),
      name: r.name,
      isActive: Number(r.is_active) === 1,
      createdAt: r.created_at,
    }));
  }

  async createExpenseCategory(
    actor: AuthUser,
    name: string
  ): Promise<ExpenseCategory> {
    requireRole(actor, ['admin']);
    const clean = name.trim();
    const existing = await this.db.queryOne<{ id: number }>(
      'SELECT id FROM expense_categories WHERE name = ?',
      [clean]
    );
    if (existing) {
      throw new AppError('هذا التصنيف موجود بالفعل.', 409);
    }

    const now = new Date().toISOString();
    const res = await this.db.execute(
      'INSERT INTO expense_categories (name, is_active, created_at) VALUES (?, 1, ?)',
      [clean, now]
    );
    const id = res.insertId;
    await this.logAudit(
      this.db,
      actor,
      'create_expense_category',
      'expense_category',
      id,
      { name: clean }
    );
    const list = await this.listExpenseCategories(true);
    return list.find((c) => c.id === id)!;
  }

  async updateExpenseCategory(
    actor: AuthUser,
    categoryId: number,
    input: { name?: string; isActive?: boolean }
  ): Promise<ExpenseCategory> {
    requireRole(actor, ['admin']);
    const existing = await this.db.queryOne<{
      id: number;
      name: string;
      is_active: number;
    }>('SELECT * FROM expense_categories WHERE id = ?', [categoryId]);
    if (!existing) {
      throw new AppError('تصنيف المصروف غير موجود.', 404);
    }
    const nextName = input.name?.trim() || existing.name;
    const nextActive =
      input.isActive !== undefined
        ? input.isActive
          ? 1
          : 0
        : Number(existing.is_active);

    try {
      await this.db.execute(
        'UPDATE expense_categories SET name = ?, is_active = ? WHERE id = ?',
        [nextName, nextActive, categoryId]
      );
    } catch {
      throw new AppError('يوجد تصنيف آخر بنفس الاسم.', 409);
    }

    await this.logAudit(
      this.db,
      actor,
      'update_expense_category',
      'expense_category',
      categoryId,
      { name: nextName, isActive: nextActive === 1 }
    );
    const list = await this.listExpenseCategories(true);
    return list.find((c) => c.id === categoryId)!;
  }

  // ==================== SESSIONS ====================

  async listCustomers(search = '', limit = 100): Promise<Customer[]> {
    const cleanSearch = search.trim();
    const where = cleanSearch
      ? 'WHERE c.name LIKE ? OR c.phone LIKE ?'
      : '';
    const params: unknown[] = cleanSearch
      ? [`%${cleanSearch}%`, `%${cleanSearch}%`, limit]
      : [limit];
    const rows = await this.db.query<{
      id: number;
      name: string;
      phone: string;
      visit_count: number;
      last_visit_at: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT c.id, c.name, c.phone, c.created_at, c.updated_at,
              COUNT(s.id) as visit_count, MAX(s.started_at) as last_visit_at
       FROM customers c
       LEFT JOIN sessions s ON s.customer_id = c.id
       ${where}
       GROUP BY c.id, c.name, c.phone, c.created_at, c.updated_at
       ORDER BY CASE WHEN MAX(s.started_at) IS NULL THEN 1 ELSE 0 END,
                MAX(s.started_at) DESC, c.name ASC
       LIMIT ?`,
      params
    );

    return rows.map((row) => ({
      id: Number(row.id),
      name: row.name,
      phone: row.phone,
      visitCount: Number(row.visit_count),
      lastVisitAt: row.last_visit_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  private async hydrateSessions(
    exec: SqlExecutor,
    rows: Array<{
      id: number;
      session_number: number;
      customer_id: number | null;
      customer_phone: string | null;
      client_name: string | null;
      hourly_rate_piasters: number;
      started_at: string;
      ended_at: string | null;
      duration_minutes: number | null;
      session_cost_piasters: number | null;
      drinks_total_piasters: number;
      total_piasters: number | null;
      payment_method: PaymentMethod | null;
      status: 'open' | 'closed' | 'cancelled';
      opened_by_user_id: number;
      opened_by_name: string;
      closed_by_user_id: number | null;
      closed_by_name: string | null;
      notes: string | null;
    }>
  ): Promise<WorkspaceSession[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => Number(r.id));
    const placeholders = ids.map(() => '?').join(',');
    const drinkRows = await exec.query<{
      id: number;
      session_id: number;
      drink_id: number;
      drink_name_snapshot: string;
      unit_price_piasters: number;
      quantity: number;
      added_by_user_id: number;
      created_at: string;
    }>(
      `SELECT * FROM session_drinks WHERE session_id IN (${placeholders}) ORDER BY id ASC`,
      ids
    );

    const drinksBySession = new Map<number, SessionDrinkItem[]>();
    for (const d of drinkRows) {
      const sid = Number(d.session_id);
      const unitPrice = Number(d.unit_price_piasters);
      const qty = Number(d.quantity);
      const list = drinksBySession.get(sid) || [];
      list.push({
        id: Number(d.id),
        sessionId: sid,
        drinkId: Number(d.drink_id),
        drinkNameSnapshot: d.drink_name_snapshot,
        unitPricePiasters: unitPrice,
        quantity: qty,
        lineTotalPiasters: unitPrice * qty,
        addedByUserId: Number(d.added_by_user_id),
        createdAt: d.created_at,
      });
      drinksBySession.set(sid, list);
    }

    return rows.map((r) => ({
      id: Number(r.id),
      sessionNumber: Number(r.session_number),
      customerId:
        r.customer_id !== null ? Number(r.customer_id) : null,
      customerPhone: r.customer_phone,
      clientName: r.client_name,
      hourlyRatePiasters: Number(r.hourly_rate_piasters),
      startedAt: r.started_at,
      endedAt: r.ended_at,
      durationMinutes:
        r.duration_minutes !== null ? Number(r.duration_minutes) : null,
      sessionCostPiasters:
        r.session_cost_piasters !== null
          ? Number(r.session_cost_piasters)
          : null,
      drinksTotalPiasters: Number(r.drinks_total_piasters),
      totalPiasters: r.total_piasters !== null ? Number(r.total_piasters) : null,
      paymentMethod: r.payment_method,
      status: r.status,
      openedByUserId: Number(r.opened_by_user_id),
      openedByName: r.opened_by_name,
      closedByUserId:
        r.closed_by_user_id !== null ? Number(r.closed_by_user_id) : null,
      closedByName: r.closed_by_name,
      notes: r.notes,
      drinks: drinksBySession.get(Number(r.id)) || [],
    }));
  }

  async getSessionById(
    sessionId: number,
    exec: SqlExecutor = this.db
  ): Promise<WorkspaceSession | null> {
    const row = await exec.queryOne<{
      id: number;
      session_number: number;
      customer_id: number | null;
      customer_phone: string | null;
      client_name: string | null;
      hourly_rate_piasters: number;
      started_at: string;
      ended_at: string | null;
      duration_minutes: number | null;
      session_cost_piasters: number | null;
      drinks_total_piasters: number;
      total_piasters: number | null;
      payment_method: PaymentMethod | null;
      status: 'open' | 'closed' | 'cancelled';
      opened_by_user_id: number;
      opened_by_name: string;
      closed_by_user_id: number | null;
      closed_by_name: string | null;
      notes: string | null;
    }>(
      `SELECT s.*, customer.phone as customer_phone,
              ou.display_name as opened_by_name, cu.display_name as closed_by_name
       FROM sessions s
       LEFT JOIN customers customer ON customer.id = s.customer_id
       INNER JOIN users ou ON ou.id = s.opened_by_user_id
       LEFT JOIN users cu ON cu.id = s.closed_by_user_id
       WHERE s.id = ?`,
      [sessionId]
    );
    if (!row) return null;
    const hydrated = await this.hydrateSessions(exec, [row]);
    return hydrated[0];
  }

  async listSessions(
    status: 'open' | 'closed' | 'all' = 'open',
    limit = 50
  ): Promise<WorkspaceSession[]> {
    const whereClause = status === 'all' ? '' : 'WHERE s.status = ?';
    const orderClause =
      status === 'open'
        ? 'ORDER BY s.started_at ASC'
        : 'ORDER BY COALESCE(s.ended_at, s.started_at) DESC';
    const sql = `
      SELECT s.*, customer.phone as customer_phone,
             ou.display_name as opened_by_name, cu.display_name as closed_by_name
      FROM sessions s
      LEFT JOIN customers customer ON customer.id = s.customer_id
      INNER JOIN users ou ON ou.id = s.opened_by_user_id
      LEFT JOIN users cu ON cu.id = s.closed_by_user_id
      ${whereClause}
      ${orderClause}
      LIMIT ?
    `;
    const params = status === 'all' ? [limit] : [status, limit];
    const rows = await this.db.query<{
      id: number;
      session_number: number;
      customer_id: number | null;
      customer_phone: string | null;
      client_name: string | null;
      hourly_rate_piasters: number;
      started_at: string;
      ended_at: string | null;
      duration_minutes: number | null;
      session_cost_piasters: number | null;
      drinks_total_piasters: number;
      total_piasters: number | null;
      payment_method: PaymentMethod | null;
      status: 'open' | 'closed' | 'cancelled';
      opened_by_user_id: number;
      opened_by_name: string;
      closed_by_user_id: number | null;
      closed_by_name: string | null;
      notes: string | null;
    }>(sql, params);
    return this.hydrateSessions(this.db, rows);
  }

  async startSession(
    actor: AuthUser,
    input: {
      customerId?: number | null;
      clientName?: string | null;
      customerPhone?: string | null;
      notes?: string | null;
      startedAt?: string;
    }
  ): Promise<WorkspaceSession> {
    return this.db.transaction(async (tx) => {
      const settings = await this.getSettings(tx);
      const maxRow = await tx.queryOne<{ max_num: number }>(
        'SELECT COALESCE(MAX(session_number), 100) as max_num FROM sessions'
      );
      const sessionNumber = Number(maxRow?.max_num || 100) + 1;
      const now = new Date().toISOString();
      const startedAt =
        input.startedAt && !Number.isNaN(new Date(input.startedAt).getTime())
          ? new Date(input.startedAt).toISOString()
          : now;
      let customerId = input.customerId || null;
      let cleanName = input.clientName?.trim() || null;
      const cleanPhone =
        input.customerPhone?.trim().replace(/[\s()-]/g, '') || null;
      const cleanNotes = input.notes?.trim() || null;

      if (customerId) {
        const customer = await tx.queryOne<{ id: number; name: string }>(
          'SELECT id, name FROM customers WHERE id = ?',
          [customerId]
        );
        if (!customer) {
          throw new AppError('العميل المحدد غير موجود.', 404);
        }
        cleanName = customer.name;
      } else if (cleanName && cleanPhone) {
        const existing = await tx.queryOne<{ id: number; name: string }>(
          'SELECT id, name FROM customers WHERE phone = ?',
          [cleanPhone]
        );
        if (existing) {
          customerId = Number(existing.id);
          cleanName = existing.name;
        } else {
          const customerInsert = await tx.execute(
            `INSERT INTO customers
               (name, phone, created_by_user_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?)`,
            [cleanName, cleanPhone, actor.id, now, now]
          );
          customerId = customerInsert.insertId;
          await this.logAudit(
            tx,
            actor,
            'create_customer',
            'customer',
            customerId,
            { name: cleanName, phone: cleanPhone }
          );
        }
      }

      const res = await tx.execute(
        `INSERT INTO sessions (
           session_number, customer_id, client_name, hourly_rate_piasters, started_at,
           drinks_total_piasters, status, opened_by_user_id, notes, created_at
         ) VALUES (?, ?, ?, ?, ?, 0, 'open', ?, ?, ?)`,
        [
          sessionNumber,
          customerId,
          cleanName,
          settings.hourlyRatePiasters,
          startedAt,
          actor.id,
          cleanNotes,
          now,
        ]
      );

      const sessionId = res.insertId;
      await this.logAudit(tx, actor, 'start_session', 'session', sessionId, {
        sessionNumber,
        customerId,
        clientName: cleanName,
        hourlyRatePiasters: settings.hourlyRatePiasters,
        startedAt,
      });

      return (await this.getSessionById(sessionId, tx))!;
    });
  }

  async addDrinkToSession(
    actor: AuthUser,
    sessionId: number,
    input: { drinkId: number; quantity: number }
  ): Promise<WorkspaceSession> {
    return this.db.transaction(async (tx) => {
      const session = await tx.queryOne<{
        id: number;
        status: string;
        session_number: number;
      }>('SELECT id, status, session_number FROM sessions WHERE id = ?', [
        sessionId,
      ]);
      if (!session) throw new AppError('الجلسة غير موجودة.', 404);
      if (session.status !== 'open') {
        throw new AppError('لا يمكن تعديل مشروبات جلسة مغلقة.', 409);
      }

      const drink = await tx.queryOne<{
        id: number;
        name: string;
        price_piasters: number;
        is_active: number;
      }>('SELECT * FROM drinks WHERE id = ?', [input.drinkId]);
      if (!drink) throw new AppError('المشروب غير موجود.', 404);
      if (Number(drink.is_active) !== 1) {
        throw new AppError('هذا المشروب غير متاح حاليًا.', 400);
      }

      const qty = Math.round(input.quantity);
      if (qty <= 0) throw new AppError('الكمية يجب أن تكون 1 على الأقل.', 400);

      const drinkPrice = Number(drink.price_piasters);
      const existingItem = await tx.queryOne<{ id: number; quantity: number }>(
        `SELECT id, quantity FROM session_drinks
         WHERE session_id = ? AND drink_id = ? AND unit_price_piasters = ? AND drink_name_snapshot = ?`,
        [sessionId, Number(drink.id), drinkPrice, drink.name]
      );

      if (existingItem) {
        await tx.execute('UPDATE session_drinks SET quantity = ? WHERE id = ?', [
          Number(existingItem.quantity) + qty,
          Number(existingItem.id),
        ]);
      } else {
        await tx.execute(
          `INSERT INTO session_drinks (
             session_id, drink_id, drink_name_snapshot, unit_price_piasters,
             quantity, added_by_user_id, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            sessionId,
            Number(drink.id),
            drink.name,
            drinkPrice,
            qty,
            actor.id,
            new Date().toISOString(),
          ]
        );
      }

      await this.recalculateSessionDrinksTotal(tx, sessionId);

      await this.logAudit(tx, actor, 'add_session_drink', 'session', sessionId, {
        sessionNumber: Number(session.session_number),
        drinkId: Number(drink.id),
        drinkName: drink.name,
        unitPricePiasters: drinkPrice,
        quantity: qty,
      });

      return (await this.getSessionById(sessionId, tx))!;
    });
  }

  async updateSessionDrinkQuantity(
    actor: AuthUser,
    sessionId: number,
    itemId: number,
    quantity: number
  ): Promise<WorkspaceSession> {
    return this.db.transaction(async (tx) => {
      const session = await tx.queryOne<{
        id: number;
        status: string;
        session_number: number;
      }>('SELECT id, status, session_number FROM sessions WHERE id = ?', [
        sessionId,
      ]);
      if (!session) throw new AppError('الجلسة غير موجودة.', 404);
      if (session.status !== 'open') {
        throw new AppError('لا يمكن تعديل مشروبات جلسة مغلقة.', 409);
      }

      const item = await tx.queryOne<{
        id: number;
        drink_name_snapshot: string;
        quantity: number;
      }>('SELECT * FROM session_drinks WHERE id = ? AND session_id = ?', [
        itemId,
        sessionId,
      ]);
      if (!item) throw new AppError('بند المشروب غير موجود.', 404);

      const qty = Math.round(quantity);
      if (qty <= 0) {
        await tx.execute('DELETE FROM session_drinks WHERE id = ?', [itemId]);
      } else {
        await tx.execute('UPDATE session_drinks SET quantity = ? WHERE id = ?', [
          qty,
          itemId,
        ]);
      }

      await this.recalculateSessionDrinksTotal(tx, sessionId);

      await this.logAudit(
        tx,
        actor,
        'update_session_drink',
        'session',
        sessionId,
        {
          sessionNumber: Number(session.session_number),
          itemId,
          drinkName: item.drink_name_snapshot,
          previousQuantity: Number(item.quantity),
          newQuantity: qty,
        }
      );

      return (await this.getSessionById(sessionId, tx))!;
    });
  }

  private async recalculateSessionDrinksTotal(
    exec: SqlExecutor,
    sessionId: number
  ): Promise<number> {
    const row = await exec.queryOne<{ total: number }>(
      'SELECT COALESCE(SUM(unit_price_piasters * quantity), 0) as total FROM session_drinks WHERE session_id = ?',
      [sessionId]
    );
    const total = Number(row?.total || 0);
    await exec.execute(
      'UPDATE sessions SET drinks_total_piasters = ? WHERE id = ?',
      [total, sessionId]
    );
    return total;
  }

  private buildSessionReceipt(session: WorkspaceSession): ReceiptData {
    return {
      kind: 'session',
      referenceNumber: `جلسة #${session.sessionNumber}`,
      customerLabel:
        session.clientName || `زائر عابر — جلسة #${session.sessionNumber}`,
      dateTimeIso: session.endedAt || session.startedAt,
      paymentMethod: session.paymentMethod || 'cash',
      cashierName: session.closedByName || session.openedByName,
      startedAt: session.startedAt,
      endedAt: session.endedAt || undefined,
      durationMinutes: session.durationMinutes ?? 0,
      hourlyRatePiasters: session.hourlyRatePiasters,
      sessionCostPiasters: session.sessionCostPiasters ?? 0,
      items: session.drinks.map((d) => ({
        name: d.drinkNameSnapshot,
        quantity: d.quantity,
        unitPricePiasters: d.unitPricePiasters,
        lineTotalPiasters: d.lineTotalPiasters,
      })),
      totalPiasters: session.totalPiasters ?? 0,
    };
  }

  async checkoutSession(
    actor: AuthUser,
    sessionId: number,
    input: {
      paymentMethod: PaymentMethod;
      idempotencyKey: string;
      endedAt?: string;
      notes?: string | null;
    }
  ): Promise<{
    session: WorkspaceSession;
    receipt: ReceiptData;
    alreadyProcessed: boolean;
  }> {
    return this.db.transaction(async (tx) => {
      const already = await tx.queryOne<{ id: number }>(
        'SELECT id FROM sessions WHERE checkout_idempotency_key = ?',
        [input.idempotencyKey]
      );
      if (already) {
        const existingSession = (await this.getSessionById(
          Number(already.id),
          tx
        ))!;
        return {
          session: existingSession,
          receipt: this.buildSessionReceipt(existingSession),
          alreadyProcessed: true,
        };
      }

      const rawSession = await tx.queryOne<{
        id: number;
        session_number: number;
        client_name: string | null;
        hourly_rate_piasters: number;
        started_at: string;
        status: string;
        notes: string | null;
      }>('SELECT * FROM sessions WHERE id = ?', [sessionId]);
      if (!rawSession) {
        throw new AppError('الجلسة غير موجودة.', 404);
      }
      if (rawSession.status !== 'open') {
        throw new AppError('تم إغلاق ومحاسبة هذه الجلسة بالفعل.', 409);
      }

      const nowIso = new Date().toISOString();
      const endedAtIso =
        input.endedAt && !Number.isNaN(new Date(input.endedAt).getTime())
          ? new Date(input.endedAt).toISOString()
          : nowIso;

      if (
        new Date(endedAtIso).getTime() <
        new Date(rawSession.started_at).getTime()
      ) {
        throw new AppError('وقت الخروج لا يمكن أن يكون قبل وقت الدخول.', 400);
      }

      const durationMinutes = calculateDurationMinutes(
        rawSession.started_at,
        endedAtIso
      );
      const sessionCostPiasters = calculateSessionCostPiasters(
        durationMinutes,
        Number(rawSession.hourly_rate_piasters)
      );
      const drinksTotalPiasters = await this.recalculateSessionDrinksTotal(
        tx,
        sessionId
      );
      const totalPiasters = sessionCostPiasters + drinksTotalPiasters;
      const { cairoDate, cairoMonth } = getCairoDateParts(endedAtIso);
      const sessionNum = Number(rawSession.session_number);
      const label = rawSession.client_name
        ? `جلسة #${sessionNum} - ${rawSession.client_name}`
        : `جلسة #${sessionNum}`;

      await tx.execute(
        `UPDATE sessions
         SET status = 'closed',
             ended_at = ?,
             duration_minutes = ?,
             session_cost_piasters = ?,
             drinks_total_piasters = ?,
             total_piasters = ?,
             payment_method = ?,
             closed_by_user_id = ?,
             checkout_idempotency_key = ?,
             notes = COALESCE(?, notes)
         WHERE id = ? AND status = 'open'`,
        [
          endedAtIso,
          durationMinutes,
          sessionCostPiasters,
          drinksTotalPiasters,
          totalPiasters,
          input.paymentMethod,
          actor.id,
          input.idempotencyKey,
          input.notes?.trim() || null,
          sessionId,
        ]
      );

      if (sessionCostPiasters > 0) {
        await tx.execute(
          `INSERT INTO ledger_entries (
             entry_type, direction, amount_piasters, payment_method, category_id,
             description, occurred_at, cairo_date, cairo_month, source_type,
             source_id, original_ledger_id, idempotency_key, created_by_user_id,
             created_by_name, created_at
           ) VALUES (
             'session_revenue', 'in', ?, ?, NULL,
             ?, ?, ?, ?, 'session',
             ?, NULL, ?, ?,
             ?, ?
           )`,
          [
            sessionCostPiasters,
            input.paymentMethod,
            `${label} (${formatDurationArabic(durationMinutes)})`,
            endedAtIso,
            cairoDate,
            cairoMonth,
            sessionId,
            `session-checkout:${input.idempotencyKey}:session`,
            actor.id,
            actor.displayName,
            nowIso,
          ]
        );
      }

      if (drinksTotalPiasters > 0) {
        await tx.execute(
          `INSERT INTO ledger_entries (
             entry_type, direction, amount_piasters, payment_method, category_id,
             description, occurred_at, cairo_date, cairo_month, source_type,
             source_id, original_ledger_id, idempotency_key, created_by_user_id,
             created_by_name, created_at
           ) VALUES (
             'drinks_revenue', 'in', ?, ?, NULL,
             ?, ?, ?, ?, 'session',
             ?, NULL, ?, ?,
             ?, ?
           )`,
          [
            drinksTotalPiasters,
            input.paymentMethod,
            `مشروبات ${label}`,
            endedAtIso,
            cairoDate,
            cairoMonth,
            sessionId,
            `session-checkout:${input.idempotencyKey}:drinks`,
            actor.id,
            actor.displayName,
            nowIso,
          ]
        );
      }

      await this.logAudit(tx, actor, 'checkout_session', 'session', sessionId, {
        sessionNumber: sessionNum,
        durationMinutes,
        sessionCostPiasters,
        drinksTotalPiasters,
        totalPiasters,
        paymentMethod: input.paymentMethod,
      });

      const closedSession = (await this.getSessionById(sessionId, tx))!;
      return {
        session: closedSession,
        receipt: this.buildSessionReceipt(closedSession),
        alreadyProcessed: false,
      };
    });
  }

  // ==================== DIRECT DRINK SALES ====================

  private async getDirectDrinkSaleById(
    saleId: number,
    exec: SqlExecutor = this.db
  ): Promise<DirectDrinkSale | null> {
    const row = await exec.queryOne<{
      id: number;
      sale_number: number;
      customer_name: string | null;
      total_piasters: number;
      payment_method: PaymentMethod;
      created_by_user_id: number;
      created_by_name: string;
      occurred_at: string;
    }>(
      `SELECT s.*, u.display_name as created_by_name
       FROM direct_drink_sales s
       INNER JOIN users u ON u.id = s.created_by_user_id
       WHERE s.id = ?`,
      [saleId]
    );
    if (!row) return null;

    const itemRows = await exec.query<{
      id: number;
      sale_id: number;
      drink_id: number;
      drink_name_snapshot: string;
      unit_price_piasters: number;
      quantity: number;
    }>(
      'SELECT * FROM direct_drink_sale_items WHERE sale_id = ? ORDER BY id ASC',
      [saleId]
    );

    const items: DirectDrinkSaleItem[] = itemRows.map((i) => ({
      id: Number(i.id),
      saleId: Number(i.sale_id),
      drinkId: Number(i.drink_id),
      drinkNameSnapshot: i.drink_name_snapshot,
      unitPricePiasters: Number(i.unit_price_piasters),
      quantity: Number(i.quantity),
      lineTotalPiasters: Number(i.unit_price_piasters) * Number(i.quantity),
    }));

    return {
      id: Number(row.id),
      saleNumber: Number(row.sale_number),
      customerName: row.customer_name,
      totalPiasters: Number(row.total_piasters),
      paymentMethod: row.payment_method,
      createdByUserId: Number(row.created_by_user_id),
      createdByName: row.created_by_name,
      occurredAt: row.occurred_at,
      items,
    };
  }

  async listDirectDrinkSales(limit = 40): Promise<DirectDrinkSale[]> {
    const rows = await this.db.query<{ id: number }>(
      'SELECT id FROM direct_drink_sales ORDER BY occurred_at DESC LIMIT ?',
      [limit]
    );
    const sales: DirectDrinkSale[] = [];
    for (const r of rows) {
      const s = await this.getDirectDrinkSaleById(Number(r.id));
      if (s) sales.push(s);
    }
    return sales;
  }

  private buildDirectSaleReceipt(sale: DirectDrinkSale): ReceiptData {
    return {
      kind: 'direct_sale',
      referenceNumber: `بيع مباشر #${sale.saleNumber}`,
      customerLabel: sale.customerName || 'عميل بيع مباشر',
      dateTimeIso: sale.occurredAt,
      paymentMethod: sale.paymentMethod,
      cashierName: sale.createdByName,
      items: sale.items.map((i) => ({
        name: i.drinkNameSnapshot,
        quantity: i.quantity,
        unitPricePiasters: i.unitPricePiasters,
        lineTotalPiasters: i.lineTotalPiasters,
      })),
      totalPiasters: sale.totalPiasters,
    };
  }

  async createDirectDrinkSale(
    actor: AuthUser,
    input: {
      customerName?: string | null;
      items: Array<{ drinkId: number; quantity: number }>;
      paymentMethod: PaymentMethod;
      idempotencyKey: string;
      occurredAt?: string;
    }
  ): Promise<{
    sale: DirectDrinkSale;
    receipt: ReceiptData;
    alreadyProcessed: boolean;
  }> {
    if (!input.items.length) {
      throw new AppError('يرجى اختيار مشروب واحد على الأقل.', 400);
    }

    return this.db.transaction(async (tx) => {
      const existing = await tx.queryOne<{ id: number }>(
        'SELECT id FROM direct_drink_sales WHERE idempotency_key = ?',
        [input.idempotencyKey]
      );
      if (existing) {
        const sale = (await this.getDirectDrinkSaleById(
          Number(existing.id),
          tx
        ))!;
        return {
          sale,
          receipt: this.buildDirectSaleReceipt(sale),
          alreadyProcessed: true,
        };
      }

      const resolvedItems: Array<{
        drinkId: number;
        name: string;
        pricePiasters: number;
        quantity: number;
      }> = [];
      let totalPiasters = 0;

      for (const reqItem of input.items) {
        const qty = Math.round(reqItem.quantity);
        if (qty <= 0) {
          throw new AppError('الكمية يجب أن تكون أكبر من صفر.', 400);
        }
        const drink = await tx.queryOne<{
          id: number;
          name: string;
          price_piasters: number;
          is_active: number;
        }>('SELECT * FROM drinks WHERE id = ?', [reqItem.drinkId]);
        if (!drink)
          throw new AppError('أحد المشروبات المختارة غير موجود.', 404);
        if (Number(drink.is_active) !== 1) {
          throw new AppError(`المشروب "${drink.name}" غير متاح حاليًا.`, 400);
        }
        const price = Number(drink.price_piasters);
        resolvedItems.push({
          drinkId: Number(drink.id),
          name: drink.name,
          pricePiasters: price,
          quantity: qty,
        });
        totalPiasters += price * qty;
      }

      if (totalPiasters <= 0) {
        throw new AppError('إجمالي البيع يجب أن يكون أكبر من صفر.', 400);
      }

      const maxRow = await tx.queryOne<{ max_num: number }>(
        'SELECT COALESCE(MAX(sale_number), 1000) as max_num FROM direct_drink_sales'
      );
      const saleNumber = Number(maxRow?.max_num || 1000) + 1;
      const nowIso = new Date().toISOString();
      const occurredAtIso =
        input.occurredAt && !Number.isNaN(new Date(input.occurredAt).getTime())
          ? new Date(input.occurredAt).toISOString()
          : nowIso;
      const { cairoDate, cairoMonth } = getCairoDateParts(occurredAtIso);
      const cleanCustomer = input.customerName?.trim() || null;

      const saleRes = await tx.execute(
        `INSERT INTO direct_drink_sales (
           sale_number, customer_name, total_piasters, payment_method,
           idempotency_key, created_by_user_id, occurred_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          saleNumber,
          cleanCustomer,
          totalPiasters,
          input.paymentMethod,
          input.idempotencyKey,
          actor.id,
          occurredAtIso,
          nowIso,
        ]
      );

      const saleId = saleRes.insertId;
      for (const item of resolvedItems) {
        await tx.execute(
          `INSERT INTO direct_drink_sale_items (
             sale_id, drink_id, drink_name_snapshot, unit_price_piasters, quantity
           ) VALUES (?, ?, ?, ?, ?)`,
          [saleId, item.drinkId, item.name, item.pricePiasters, item.quantity]
        );
      }

      const summaryNames = resolvedItems
        .map((i) => `${i.name} ×${i.quantity}`)
        .join('، ');
      const description = cleanCustomer
        ? `بيع مشروب مباشر #${saleNumber} (${cleanCustomer}): ${summaryNames}`
        : `بيع مشروب مباشر #${saleNumber}: ${summaryNames}`;

      await tx.execute(
        `INSERT INTO ledger_entries (
           entry_type, direction, amount_piasters, payment_method, category_id,
           description, occurred_at, cairo_date, cairo_month, source_type,
           source_id, original_ledger_id, idempotency_key, created_by_user_id,
           created_by_name, created_at
         ) VALUES (
           'drinks_revenue', 'in', ?, ?, NULL,
           ?, ?, ?, ?, 'direct_sale',
           ?, NULL, ?, ?,
           ?, ?
         )`,
        [
          totalPiasters,
          input.paymentMethod,
          description,
          occurredAtIso,
          cairoDate,
          cairoMonth,
          saleId,
          `direct-sale:${input.idempotencyKey}`,
          actor.id,
          actor.displayName,
          nowIso,
        ]
      );

      await this.logAudit(tx, actor, 'direct_drink_sale', 'direct_sale', saleId, {
        saleNumber,
        totalPiasters,
        paymentMethod: input.paymentMethod,
        items: resolvedItems,
      });

      const sale = (await this.getDirectDrinkSaleById(saleId, tx))!;
      return {
        sale,
        receipt: this.buildDirectSaleReceipt(sale),
        alreadyProcessed: false,
      };
    });
  }

  // ==================== COURSES & STUDENTS ====================

  async listCourseGroups(): Promise<CourseGroup[]> {
    const groups = await this.db.query<{
      id: number;
      course_name: string;
      group_name: string;
      instructor_name: string;
      schedule: string;
      price_piasters: number;
      status: 'active' | 'completed' | 'archived';
      created_at: string;
    }>('SELECT * FROM course_groups ORDER BY status ASC, id DESC');

    const enrollments = await this.listEnrollments();
    const byGroup = new Map<number, StudentEnrollment[]>();
    for (const e of enrollments) {
      const list = byGroup.get(e.courseGroupId) || [];
      list.push(e);
      byGroup.set(e.courseGroupId, list);
    }

    return groups.map((g) => {
      const gid = Number(g.id);
      const list = byGroup.get(gid) || [];
      const totalAgreedPiasters = list.reduce(
        (acc, e) => acc + e.agreedPricePiasters,
        0
      );
      const totalPaidPiasters = list.reduce(
        (acc, e) => acc + e.paidPiasters,
        0
      );
      const totalRemainingPiasters = list.reduce(
        (acc, e) => acc + e.remainingPiasters,
        0
      );
      return {
        id: gid,
        courseName: g.course_name,
        groupName: g.group_name,
        instructorName: g.instructor_name,
        schedule: g.schedule,
        pricePiasters: Number(g.price_piasters),
        status: g.status,
        studentCount: list.length,
        totalAgreedPiasters,
        totalPaidPiasters,
        totalRemainingPiasters,
        createdAt: g.created_at,
      };
    });
  }

  async createCourseGroup(
    actor: AuthUser,
    input: {
      courseName: string;
      groupName: string;
      instructorName: string;
      schedule: string;
      pricePiasters: number;
    }
  ): Promise<CourseGroup> {
    requireRole(actor, ['admin']);
    const now = new Date().toISOString();
    const res = await this.db.execute(
      `INSERT INTO course_groups (
         course_name, group_name, instructor_name, schedule, price_piasters,
         status, created_by_user_id, created_at
       ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
      [
        input.courseName.trim(),
        input.groupName.trim(),
        input.instructorName.trim(),
        input.schedule.trim(),
        Math.round(input.pricePiasters),
        actor.id,
        now,
      ]
    );
    const id = res.insertId;
    await this.logAudit(
      this.db,
      actor,
      'create_course_group',
      'course_group',
      id,
      {
        courseName: input.courseName.trim(),
        groupName: input.groupName.trim(),
        pricePiasters: Math.round(input.pricePiasters),
      }
    );
    const groups = await this.listCourseGroups();
    return groups.find((g) => g.id === id)!;
  }

  async updateCourseGroup(
    actor: AuthUser,
    groupId: number,
    input: {
      courseName?: string;
      groupName?: string;
      instructorName?: string;
      schedule?: string;
      pricePiasters?: number;
      status?: 'active' | 'completed' | 'archived';
    }
  ): Promise<CourseGroup> {
    requireRole(actor, ['admin']);
    const existing = await this.db.queryOne<{
      id: number;
      course_name: string;
      group_name: string;
      instructor_name: string;
      schedule: string;
      price_piasters: number;
      status: 'active' | 'completed' | 'archived';
    }>('SELECT * FROM course_groups WHERE id = ?', [groupId]);
    if (!existing) throw new AppError('المجموعة غير موجودة.', 404);

    await this.db.execute(
      `UPDATE course_groups
       SET course_name = ?, group_name = ?, instructor_name = ?, schedule = ?, price_piasters = ?, status = ?
       WHERE id = ?`,
      [
        input.courseName?.trim() || existing.course_name,
        input.groupName?.trim() || existing.group_name,
        input.instructorName?.trim() || existing.instructor_name,
        input.schedule?.trim() || existing.schedule,
        input.pricePiasters !== undefined
          ? Math.round(input.pricePiasters)
          : Number(existing.price_piasters),
        input.status || existing.status,
        groupId,
      ]
    );

    await this.logAudit(
      this.db,
      actor,
      'update_course_group',
      'course_group',
      groupId,
      input
    );
    const groups = await this.listCourseGroups();
    return groups.find((g) => g.id === groupId)!;
  }

  async listEnrollments(
    courseGroupId?: number,
    exec: SqlExecutor = this.db
  ): Promise<StudentEnrollment[]> {
    const where = courseGroupId ? 'WHERE e.course_group_id = ?' : '';
    const sql = `
      SELECT e.*, g.course_name, g.group_name, g.instructor_name, g.schedule,
             u.display_name as enrolled_by_name
      FROM student_enrollments e
      INNER JOIN course_groups g ON g.id = e.course_group_id
      INNER JOIN users u ON u.id = e.enrolled_by_user_id
      ${where}
      ORDER BY e.id DESC
    `;
    const rows = await exec.query<{
      id: number;
      course_group_id: number;
      course_name: string;
      group_name: string;
      instructor_name: string;
      schedule: string;
      student_name: string;
      student_phone: string;
      agreed_price_piasters: number;
      notes: string | null;
      enrolled_by_name: string;
      enrolled_at: string;
    }>(sql, courseGroupId ? [courseGroupId] : []);

    if (rows.length === 0) return [];

    const ids = rows.map((r) => Number(r.id));
    const placeholders = ids.map(() => '?').join(',');
    const payRows = await exec.query<{
      id: number;
      enrollment_id: number;
      ledger_entry_id: number | null;
      ledger_cairo_date: string | null;
      amount_piasters: number;
      refunded_piasters: number;
      payment_method: PaymentMethod;
      paid_at: string;
      notes: string | null;
      received_by_user_id: number;
      received_by_name: string;
      created_at: string;
    }>(
      `SELECT cp.*, u.display_name as received_by_name,
              le.id as ledger_entry_id,
              le.cairo_date as ledger_cairo_date,
              COALESCE((
                SELECT SUM(r.amount_piasters)
                FROM ledger_entries r
                WHERE r.entry_type = 'refund' AND r.original_ledger_id = le.id
              ), 0) as refunded_piasters
       FROM course_payments cp
       INNER JOIN users u ON u.id = cp.received_by_user_id
       LEFT JOIN ledger_entries le
         ON le.source_type = 'course_payment' AND le.source_id = cp.id AND le.entry_type = 'course_payment'
       WHERE cp.enrollment_id IN (${placeholders})
       ORDER BY cp.paid_at ASC, cp.id ASC`,
      ids
    );

    const paymentsByEnrollment = new Map<number, CoursePayment[]>();
    for (const p of payRows) {
      const eid = Number(p.enrollment_id);
      const list = paymentsByEnrollment.get(eid) || [];
      list.push({
        id: Number(p.id),
        enrollmentId: eid,
        ledgerEntryId:
          p.ledger_entry_id !== null ? Number(p.ledger_entry_id) : null,
        amountPiasters: Number(p.amount_piasters),
        refundedPiasters: Number(p.refunded_piasters || 0),
        paymentMethod: p.payment_method,
        paidAt: p.paid_at,
        cairoDate: p.ledger_cairo_date || getCairoDateParts(p.paid_at).cairoDate,
        notes: p.notes,
        receivedByUserId: Number(p.received_by_user_id),
        receivedByName: p.received_by_name,
        createdAt: p.created_at,
      });
      paymentsByEnrollment.set(eid, list);
    }

    return rows.map((r) => {
      const eid = Number(r.id);
      const agreed = Number(r.agreed_price_piasters);
      const payments = paymentsByEnrollment.get(eid) || [];
      const paidPiasters = payments.reduce(
        (acc, p) => acc + Math.max(0, p.amountPiasters - p.refundedPiasters),
        0
      );
      const remainingPiasters = Math.max(0, agreed - paidPiasters);
      return {
        id: eid,
        courseGroupId: Number(r.course_group_id),
        courseName: r.course_name,
        groupName: r.group_name,
        instructorName: r.instructor_name,
        schedule: r.schedule,
        studentName: r.student_name,
        studentPhone: r.student_phone,
        agreedPricePiasters: agreed,
        paidPiasters,
        remainingPiasters,
        notes: r.notes,
        enrolledByName: r.enrolled_by_name,
        enrolledAt: r.enrolled_at,
        payments,
      };
    });
  }

  async getEnrollmentById(
    enrollmentId: number,
    exec: SqlExecutor = this.db
  ): Promise<StudentEnrollment | null> {
    const all = await this.listEnrollments(undefined, exec);
    return all.find((e) => e.id === enrollmentId) || null;
  }

  async enrollStudent(
    actor: AuthUser,
    input: {
      courseGroupId: number;
      studentName: string;
      studentPhone: string;
      agreedPricePiasters?: number;
      notes?: string | null;
    }
  ): Promise<StudentEnrollment> {
    const group = await this.db.queryOne<{
      id: number;
      course_name: string;
      group_name: string;
      price_piasters: number;
    }>('SELECT * FROM course_groups WHERE id = ?', [input.courseGroupId]);
    if (!group) throw new AppError('مجموعة الكورس غير موجودة.', 404);

    const agreedPrice =
      input.agreedPricePiasters !== undefined
        ? Math.round(input.agreedPricePiasters)
        : Number(group.price_piasters);
    if (agreedPrice < 0) {
      throw new AppError('المبلغ المتفق عليه لا يمكن أن يكون سالبًا.', 400);
    }

    const now = new Date().toISOString();
    const res = await this.db.execute(
      `INSERT INTO student_enrollments (
         course_group_id, student_name, student_phone, agreed_price_piasters,
         notes, enrolled_by_user_id, enrolled_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        input.courseGroupId,
        input.studentName.trim(),
        input.studentPhone.trim(),
        agreedPrice,
        input.notes?.trim() || null,
        actor.id,
        now,
      ]
    );

    const enrollmentId = res.insertId;
    await this.logAudit(
      this.db,
      actor,
      'enroll_student',
      'enrollment',
      enrollmentId,
      {
        courseGroupId: input.courseGroupId,
        studentName: input.studentName.trim(),
        agreedPricePiasters: agreedPrice,
      }
    );

    return (await this.getEnrollmentById(enrollmentId))!;
  }

  private buildCoursePaymentReceipt(
    enrollment: StudentEnrollment,
    payment: CoursePayment
  ): ReceiptData {
    return {
      kind: 'course_payment',
      referenceNumber: `دفعة كورس #${payment.id}`,
      customerLabel: `${enrollment.studentName} (${enrollment.studentPhone})`,
      dateTimeIso: payment.paidAt,
      paymentMethod: payment.paymentMethod,
      cashierName: payment.receivedByName,
      courseDetails: {
        courseName: enrollment.courseName,
        groupName: enrollment.groupName,
        agreedPricePiasters: enrollment.agreedPricePiasters,
        totalPaidPiasters: enrollment.paidPiasters,
        remainingPiasters: enrollment.remainingPiasters,
      },
      totalPiasters: payment.amountPiasters,
    };
  }

  async recordCoursePayment(
    actor: AuthUser,
    enrollmentId: number,
    input: {
      amountPiasters: number;
      paymentMethod: PaymentMethod;
      paidAt?: string;
      notes?: string | null;
      idempotencyKey: string;
    }
  ): Promise<{
    enrollment: StudentEnrollment;
    payment: CoursePayment;
    receipt: ReceiptData;
    alreadyProcessed: boolean;
  }> {
    return this.db.transaction(async (tx) => {
      const existingPayment = await tx.queryOne<{
        id: number;
        enrollment_id: number;
      }>(
        'SELECT id, enrollment_id FROM course_payments WHERE idempotency_key = ?',
        [input.idempotencyKey]
      );
      if (existingPayment) {
        const enrollment = (await this.getEnrollmentById(
          Number(existingPayment.enrollment_id),
          tx
        ))!;
        const payment = enrollment.payments.find(
          (p) => p.id === Number(existingPayment.id)
        )!;
        return {
          enrollment,
          payment,
          receipt: this.buildCoursePaymentReceipt(enrollment, payment),
          alreadyProcessed: true,
        };
      }

      const enrollmentBefore = await this.getEnrollmentById(enrollmentId, tx);
      if (!enrollmentBefore) {
        throw new AppError('بيانات تسجيل الطالب غير موجودة.', 404);
      }

      const amountPiasters = Math.round(input.amountPiasters);
      if (amountPiasters <= 0) {
        throw new AppError('مبلغ الدفعة يجب أن يكون أكبر من صفر.', 400);
      }
      if (amountPiasters > enrollmentBefore.remainingPiasters) {
        throw new AppError(
          'المبلغ المدخل أكبر من المبلغ المتبقي على الطالب.',
          400
        );
      }

      const nowIso = new Date().toISOString();
      const paidAtIso =
        input.paidAt && !Number.isNaN(new Date(input.paidAt).getTime())
          ? new Date(input.paidAt).toISOString()
          : nowIso;
      const { cairoDate, cairoMonth } = getCairoDateParts(paidAtIso);

      const payRes = await tx.execute(
        `INSERT INTO course_payments (
           enrollment_id, amount_piasters, payment_method, paid_at,
           notes, idempotency_key, received_by_user_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          enrollmentId,
          amountPiasters,
          input.paymentMethod,
          paidAtIso,
          input.notes?.trim() || null,
          input.idempotencyKey,
          actor.id,
          nowIso,
        ]
      );
      const paymentId = payRes.insertId;

      const description = `دفعة كورس ${enrollmentBefore.courseName} (${enrollmentBefore.groupName}) — ${enrollmentBefore.studentName}`;

      await tx.execute(
        `INSERT INTO ledger_entries (
           entry_type, direction, amount_piasters, payment_method, category_id,
           description, occurred_at, cairo_date, cairo_month, source_type,
           source_id, original_ledger_id, idempotency_key, created_by_user_id,
           created_by_name, created_at
         ) VALUES (
           'course_payment', 'in', ?, ?, NULL,
           ?, ?, ?, ?, 'course_payment',
           ?, NULL, ?, ?,
           ?, ?
         )`,
        [
          amountPiasters,
          input.paymentMethod,
          description,
          paidAtIso,
          cairoDate,
          cairoMonth,
          paymentId,
          `course-payment:${input.idempotencyKey}`,
          actor.id,
          actor.displayName,
          nowIso,
        ]
      );

      await this.logAudit(
        tx,
        actor,
        'course_payment',
        'course_payment',
        paymentId,
        {
          enrollmentId,
          studentName: enrollmentBefore.studentName,
          amountPiasters,
          paymentMethod: input.paymentMethod,
          cairoDate,
        }
      );

      const enrollmentAfter = (await this.getEnrollmentById(enrollmentId, tx))!;
      const payment = enrollmentAfter.payments.find((p) => p.id === paymentId)!;
      return {
        enrollment: enrollmentAfter,
        payment,
        receipt: this.buildCoursePaymentReceipt(enrollmentAfter, payment),
        alreadyProcessed: false,
      };
    });
  }

  // ==================== LEDGER ====================

  private mapLedgerRow(r: {
    id: number;
    entry_type: LedgerEntryType;
    direction: 'in' | 'out';
    amount_piasters: number;
    refunded_piasters: number;
    payment_method: PaymentMethod;
    category_id: number | null;
    category_name: string | null;
    description: string;
    occurred_at: string;
    cairo_date: string;
    cairo_month: string;
    source_type: LedgerEntry['sourceType'];
    source_id: number | null;
    original_ledger_id: number | null;
    created_by_user_id: number;
    created_by_name: string;
    created_at: string;
  }): LedgerEntry {
    return {
      id: Number(r.id),
      entryType: r.entry_type,
      direction: r.direction,
      amountPiasters: Number(r.amount_piasters),
      refundedPiasters: Number(r.refunded_piasters || 0),
      paymentMethod: r.payment_method,
      categoryId: r.category_id !== null ? Number(r.category_id) : null,
      categoryName: r.category_name,
      description: r.description,
      occurredAt: r.occurred_at,
      cairoDate: r.cairo_date,
      cairoMonth: r.cairo_month,
      sourceType: r.source_type,
      sourceId: r.source_id !== null ? Number(r.source_id) : null,
      originalLedgerId:
        r.original_ledger_id !== null ? Number(r.original_ledger_id) : null,
      createdByUserId: Number(r.created_by_user_id),
      createdByName: r.created_by_name,
      createdAt: r.created_at,
    };
  }

  async getLedgerEntryById(
    entryId: number,
    exec: SqlExecutor = this.db
  ): Promise<LedgerEntry | null> {
    const row = await exec.queryOne<
      Parameters<StackSpaceService['mapLedgerRow']>[0]
    >(
      `SELECT l.*, ec.name as category_name,
              COALESCE((
                SELECT SUM(r.amount_piasters)
                FROM ledger_entries r
                WHERE r.entry_type = 'refund' AND r.original_ledger_id = l.id
              ), 0) as refunded_piasters
       FROM ledger_entries l
       LEFT JOIN expense_categories ec ON ec.id = l.category_id
       WHERE l.id = ?`,
      [entryId]
    );
    if (!row) return null;
    return this.mapLedgerRow(row);
  }

  async listLedgerEntries(
    actor: AuthUser,
    filters: {
      search?: string;
      month?: string;
      fromDate?: string;
      toDate?: string;
      entryType?: LedgerEntryType | 'all';
      categoryId?: number;
      paymentMethod?: PaymentMethod | 'all';
      limit?: number;
    } = {}
  ): Promise<LedgerEntry[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (actor.role !== 'admin') {
      conditions.push(
        "l.entry_type NOT IN ('owner_deposit', 'owner_withdrawal')"
      );
    }

    if (filters.month && /^\d{4}-\d{2}$/.test(filters.month)) {
      conditions.push('l.cairo_month = ?');
      params.push(filters.month);
    }
    if (filters.fromDate && /^\d{4}-\d{2}-\d{2}$/.test(filters.fromDate)) {
      conditions.push('l.cairo_date >= ?');
      params.push(filters.fromDate);
    }
    if (filters.toDate && /^\d{4}-\d{2}-\d{2}$/.test(filters.toDate)) {
      conditions.push('l.cairo_date <= ?');
      params.push(filters.toDate);
    }
    if (filters.entryType && filters.entryType !== 'all') {
      conditions.push('l.entry_type = ?');
      params.push(filters.entryType);
    }
    if (filters.categoryId) {
      conditions.push('l.category_id = ?');
      params.push(filters.categoryId);
    }
    if (filters.paymentMethod && filters.paymentMethod !== 'all') {
      conditions.push('l.payment_method = ?');
      params.push(filters.paymentMethod);
    }
    if (filters.search && filters.search.trim()) {
      const q = `%${filters.search.trim()}%`;
      conditions.push(
        "(l.description LIKE ? OR l.created_by_name LIKE ? OR COALESCE(ec.name, '') LIKE ?)"
      );
      params.push(q, q, q);
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.min(Math.max(filters.limit || 250, 1), 1000);
    params.push(limit);

    const rows = await this.db.query<
      Parameters<StackSpaceService['mapLedgerRow']>[0]
    >(
      `SELECT l.*, ec.name as category_name,
              COALESCE((
                SELECT SUM(r.amount_piasters)
                FROM ledger_entries r
                WHERE r.entry_type = 'refund' AND r.original_ledger_id = l.id
              ), 0) as refunded_piasters
       FROM ledger_entries l
       LEFT JOIN expense_categories ec ON ec.id = l.category_id
       ${where}
       ORDER BY l.occurred_at DESC, l.id DESC
       LIMIT ?`,
      params
    );

    return rows.map((r) => this.mapLedgerRow(r));
  }

  async recordManualLedgerEntry(
    actor: AuthUser,
    input: {
      entryType:
        | 'expense'
        | 'other_revenue'
        | 'owner_deposit'
        | 'owner_withdrawal';
      amountPiasters: number;
      paymentMethod: PaymentMethod;
      categoryId?: number | null;
      description: string;
      occurredAt?: string;
      idempotencyKey: string;
    }
  ): Promise<{ entry: LedgerEntry; alreadyProcessed: boolean }> {
    if (
      input.entryType === 'owner_deposit' ||
      input.entryType === 'owner_withdrawal'
    ) {
      requireRole(actor, ['admin']);
    }

    return this.db.transaction(async (tx) => {
      const existing = await tx.queryOne<{ id: number }>(
        'SELECT id FROM ledger_entries WHERE idempotency_key = ?',
        [input.idempotencyKey]
      );
      if (existing) {
        return {
          entry: (await this.getLedgerEntryById(Number(existing.id), tx))!,
          alreadyProcessed: true,
        };
      }

      const amount = Math.round(input.amountPiasters);
      if (amount <= 0) {
        throw new AppError('المبلغ يجب أن يكون أكبر من صفر.', 400);
      }

      let categoryId: number | null = null;
      if (input.entryType === 'expense') {
        if (!input.categoryId) {
          throw new AppError('يرجى اختيار تصنيف المصروف.', 400);
        }
        const cat = await tx.queryOne<{ id: number }>(
          'SELECT id FROM expense_categories WHERE id = ?',
          [input.categoryId]
        );
        if (!cat) throw new AppError('تصنيف المصروف غير موجود.', 404);
        categoryId = input.categoryId;
      }

      const direction: 'in' | 'out' =
        input.entryType === 'other_revenue' ||
        input.entryType === 'owner_deposit'
          ? 'in'
          : 'out';

      const nowIso = new Date().toISOString();
      const occurredAtIso =
        input.occurredAt && !Number.isNaN(new Date(input.occurredAt).getTime())
          ? new Date(input.occurredAt).toISOString()
          : nowIso;
      const { cairoDate, cairoMonth } = getCairoDateParts(occurredAtIso);

      const res = await tx.execute(
        `INSERT INTO ledger_entries (
           entry_type, direction, amount_piasters, payment_method, category_id,
           description, occurred_at, cairo_date, cairo_month, source_type,
           source_id, original_ledger_id, idempotency_key, created_by_user_id,
           created_by_name, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', NULL, NULL, ?, ?, ?, ?)`,
        [
          input.entryType,
          direction,
          amount,
          input.paymentMethod,
          categoryId,
          input.description.trim(),
          occurredAtIso,
          cairoDate,
          cairoMonth,
          input.idempotencyKey,
          actor.id,
          actor.displayName,
          nowIso,
        ]
      );

      const entryId = res.insertId;
      await this.logAudit(
        tx,
        actor,
        `record_${input.entryType}`,
        'ledger_entry',
        entryId,
        {
          amountPiasters: amount,
          paymentMethod: input.paymentMethod,
          categoryId,
          cairoDate,
          description: input.description.trim(),
        }
      );

      return {
        entry: (await this.getLedgerEntryById(entryId, tx))!,
        alreadyProcessed: false,
      };
    });
  }

  async createRefund(
    actor: AuthUser,
    originalLedgerId: number,
    input: {
      amountPiasters: number;
      paymentMethod: PaymentMethod;
      reason: string;
      refundedAt?: string;
      idempotencyKey: string;
    }
  ): Promise<{ entry: LedgerEntry; alreadyProcessed: boolean }> {
    return this.db.transaction(async (tx) => {
      const existing = await tx.queryOne<{ id: number }>(
        'SELECT id FROM ledger_entries WHERE idempotency_key = ?',
        [input.idempotencyKey]
      );
      if (existing) {
        return {
          entry: (await this.getLedgerEntryById(Number(existing.id), tx))!,
          alreadyProcessed: true,
        };
      }

      const original = await this.getLedgerEntryById(originalLedgerId, tx);
      if (!original) {
        throw new AppError('الحركة الأصلية غير موجودة.', 404);
      }

      const refundableTypes: LedgerEntryType[] = [
        'session_revenue',
        'drinks_revenue',
        'course_payment',
        'other_revenue',
      ];
      if (!refundableTypes.includes(original.entryType)) {
        throw new AppError('لا يمكن عمل استرداد لهذا النوع من الحركات.', 400);
      }

      const amount = Math.round(input.amountPiasters);
      if (amount <= 0) {
        throw new AppError('مبلغ الاسترداد يجب أن يكون أكبر من صفر.', 400);
      }

      const maxRefundable = original.amountPiasters - original.refundedPiasters;
      if (amount > maxRefundable) {
        throw new AppError(
          'لا يمكن استرداد مبلغ أكبر مما تم تحصيله في العملية الأصلية.',
          400
        );
      }

      const nowIso = new Date().toISOString();
      const refundedAtIso =
        input.refundedAt && !Number.isNaN(new Date(input.refundedAt).getTime())
          ? new Date(input.refundedAt).toISOString()
          : nowIso;
      const { cairoDate, cairoMonth } = getCairoDateParts(refundedAtIso);

      const description = `استرداد عن حركة #${original.id} (${original.description}) — السبب: ${input.reason.trim()}`;

      const res = await tx.execute(
        `INSERT INTO ledger_entries (
           entry_type, direction, amount_piasters, payment_method, category_id,
           description, occurred_at, cairo_date, cairo_month, source_type,
           source_id, original_ledger_id, idempotency_key, created_by_user_id,
           created_by_name, created_at
         ) VALUES (
           'refund', 'out', ?, ?, NULL,
           ?, ?, ?, ?, 'refund',
           ?, ?, ?, ?,
           ?, ?
         )`,
        [
          amount,
          input.paymentMethod,
          description,
          refundedAtIso,
          cairoDate,
          cairoMonth,
          original.id,
          original.id,
          input.idempotencyKey,
          actor.id,
          actor.displayName,
          nowIso,
        ]
      );

      const refundId = res.insertId;
      await this.logAudit(
        tx,
        actor,
        'create_refund',
        'ledger_entry',
        refundId,
        {
          originalLedgerId: original.id,
          originalAmountPiasters: original.amountPiasters,
          refundAmountPiasters: amount,
          paymentMethod: input.paymentMethod,
          reason: input.reason.trim(),
          cairoDate,
        }
      );

      return {
        entry: (await this.getLedgerEntryById(refundId, tx))!,
        alreadyProcessed: false,
      };
    });
  }

  // ==================== MONTHLY NET PROFIT REPORT (ADMIN ONLY) ====================

  async getMonthlyProfitReport(
    actor: AuthUser,
    monthInput?: string
  ): Promise<MonthlyProfitReport> {
    requireRole(actor, ['admin']);
    const month =
      monthInput && /^\d{4}-\d{2}$/.test(monthInput)
        ? monthInput
        : getCurrentCairoMonth();

    const monthEntries = await this.listLedgerEntries(actor, {
      month,
      limit: 1000,
    });

    const byType = (t: LedgerEntryType) =>
      monthEntries.filter((e) => e.entryType === t);

    const sum = (items: LedgerEntry[]) =>
      items.reduce((acc, e) => acc + e.amountPiasters, 0);

    const sessionEntries = byType('session_revenue');
    const drinksEntries = byType('drinks_revenue');
    const courseEntries = byType('course_payment');
    const otherEntries = byType('other_revenue');
    const refundEntries = byType('refund');
    const expenseEntries = byType('expense');
    const ownerDepositEntries = byType('owner_deposit');
    const ownerWithdrawalEntries = byType('owner_withdrawal');

    const sessionRevenuePiasters = sum(sessionEntries);
    const drinksRevenuePiasters = sum(drinksEntries);
    const coursePaymentsPiasters = sum(courseEntries);
    const otherRevenuePiasters = sum(otherEntries);
    const totalGrossCollectionsPiasters =
      sessionRevenuePiasters +
      drinksRevenuePiasters +
      coursePaymentsPiasters +
      otherRevenuePiasters;
    const refundsPiasters = sum(refundEntries);
    const netOperatingRevenuePiasters =
      totalGrossCollectionsPiasters - refundsPiasters;
    const operatingExpensesPiasters = sum(expenseEntries);
    const netProfitPiasters =
      netOperatingRevenuePiasters - operatingExpensesPiasters;

    const lines: MonthlyReportLine[] = [
      {
        key: 'session_revenue',
        label: 'تحصيلات الجلسات (الوركسبيس)',
        entryType: 'session_revenue',
        sign: 1,
        count: sessionEntries.length,
        amountPiasters: sessionRevenuePiasters,
        entries: sessionEntries,
      },
      {
        key: 'drinks_revenue',
        label: 'تحصيلات المشروبات (جلسات + بيع مباشر)',
        entryType: 'drinks_revenue',
        sign: 1,
        count: drinksEntries.length,
        amountPiasters: drinksRevenuePiasters,
        entries: drinksEntries,
      },
      {
        key: 'course_payment',
        label: 'دفعات الكورسات المحصلة',
        entryType: 'course_payment',
        sign: 1,
        count: courseEntries.length,
        amountPiasters: coursePaymentsPiasters,
        entries: courseEntries,
      },
      {
        key: 'other_revenue',
        label: 'الإيرادات التشغيلية الأخرى',
        entryType: 'other_revenue',
        sign: 1,
        count: otherEntries.length,
        amountPiasters: otherRevenuePiasters,
        entries: otherEntries,
      },
      {
        key: 'refund',
        label: 'المبالغ المستردة للعملاء',
        entryType: 'refund',
        sign: -1,
        count: refundEntries.length,
        amountPiasters: refundsPiasters,
        entries: refundEntries,
      },
      {
        key: 'expense',
        label: 'مصروفات التشغيل المدفوعة',
        entryType: 'expense',
        sign: -1,
        count: expenseEntries.length,
        amountPiasters: operatingExpensesPiasters,
        entries: expenseEntries,
      },
    ];

    const categoryMap = new Map<string, MonthlyExpenseCategoryBreakdown>();
    for (const exp of expenseEntries) {
      const key = String(exp.categoryId ?? 'other');
      const existing = categoryMap.get(key);
      if (existing) {
        existing.count += 1;
        existing.amountPiasters += exp.amountPiasters;
        existing.entries.push(exp);
      } else {
        categoryMap.set(key, {
          categoryId: exp.categoryId,
          categoryName: exp.categoryName || 'مصروفات أخرى',
          count: 1,
          amountPiasters: exp.amountPiasters,
          entries: [exp],
        });
      }
    }
    const expensesByCategory = Array.from(categoryMap.values()).sort(
      (a, b) => b.amountPiasters - a.amountPiasters
    );

    const ownerDepositsPiasters = sum(ownerDepositEntries);
    const ownerWithdrawalsPiasters = sum(ownerWithdrawalEntries);
    const ownerEntries = [...ownerDepositEntries, ...ownerWithdrawalEntries].sort(
      (a, b) => b.occurredAt.localeCompare(a.occurredAt)
    );

    const allEnrollments = await this.listEnrollments();
    const studentsWithBalance = allEnrollments
      .filter((e) => e.remainingPiasters > 0)
      .map((e) => ({
        enrollmentId: e.id,
        studentName: e.studentName,
        studentPhone: e.studentPhone,
        courseName: e.courseName,
        groupName: e.groupName,
        agreedPricePiasters: e.agreedPricePiasters,
        paidPiasters: e.paidPiasters,
        remainingPiasters: e.remainingPiasters,
      }));
    const studentReceivablesPiasters = studentsWithBalance.reduce(
      (acc, s) => acc + s.remainingPiasters,
      0
    );

    const cashMonthEntries = monthEntries.filter(
      (e) => e.paymentMethod === 'cash'
    );
    const monthlyCashInPiasters = cashMonthEntries
      .filter((e) => e.direction === 'in')
      .reduce((acc, e) => acc + e.amountPiasters, 0);
    const monthlyCashOutPiasters = cashMonthEntries
      .filter((e) => e.direction === 'out')
      .reduce((acc, e) => acc + e.amountPiasters, 0);
    const monthlyNetCashPiasters =
      monthlyCashInPiasters - monthlyCashOutPiasters;

    const cumCashRow = await this.db.queryOne<{
      total_in: number;
      total_out: number;
    }>(
      `SELECT
         COALESCE(SUM(CASE WHEN direction = 'in' THEN amount_piasters ELSE 0 END), 0) as total_in,
         COALESCE(SUM(CASE WHEN direction = 'out' THEN amount_piasters ELSE 0 END), 0) as total_out
       FROM ledger_entries
       WHERE payment_method = 'cash' AND cairo_month <= ?`,
      [month]
    );
    const cumulativeCashBalancePiasters =
      Number(cumCashRow?.total_in || 0) - Number(cumCashRow?.total_out || 0);

    const collectionsByMethod: Record<PaymentMethod, number> = {
      cash: 0,
      instapay: 0,
      e_wallet: 0,
      card: 0,
    };
    for (const e of [
      ...sessionEntries,
      ...drinksEntries,
      ...courseEntries,
      ...otherEntries,
    ]) {
      collectionsByMethod[e.paymentMethod] += e.amountPiasters;
    }

    const monthRows = await this.db.query<{ cairo_month: string }>(
      'SELECT DISTINCT cairo_month FROM ledger_entries ORDER BY cairo_month DESC'
    );
    const monthsSet = new Set<string>([
      getCurrentCairoMonth(),
      month,
      ...monthRows.map((m) => m.cairo_month),
    ]);
    const availableMonths = Array.from(monthsSet).sort().reverse();

    return {
      month,
      sessionRevenuePiasters,
      drinksRevenuePiasters,
      coursePaymentsPiasters,
      otherRevenuePiasters,
      totalGrossCollectionsPiasters,
      refundsPiasters,
      netOperatingRevenuePiasters,
      operatingExpensesPiasters,
      netProfitPiasters,
      lines,
      expensesByCategory,
      ownerDepositsPiasters,
      ownerWithdrawalsPiasters,
      ownerEntries,
      studentReceivablesPiasters,
      studentsWithBalance,
      monthlyCashInPiasters,
      monthlyCashOutPiasters,
      monthlyNetCashPiasters,
      cumulativeCashBalancePiasters,
      collectionsByMethod,
      availableMonths,
    };
  }

  // ==================== AUDIT LOGS ====================

  async listAuditLogs(actor: AuthUser, limit = 100): Promise<AuditLogItem[]> {
    requireRole(actor, ['admin']);
    const rows = await this.db.query<{
      id: number;
      actor_user_id: number | null;
      actor_name: string;
      actor_role: string;
      action: string;
      entity_type: string;
      entity_id: number | null;
      details_json: string;
      created_at: string;
    }>('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?', [
      Math.min(Math.max(limit, 1), 300),
    ]);

    return rows.map((r) => {
      let details: Record<string, unknown> = {};
      try {
        details = JSON.parse(r.details_json);
      } catch {
        details = {};
      }
      return {
        id: Number(r.id),
        actorUserId:
          r.actor_user_id !== null ? Number(r.actor_user_id) : null,
        actorName: r.actor_name,
        actorRole: r.actor_role,
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id !== null ? Number(r.entity_id) : null,
        details,
        createdAt: r.created_at,
      };
    });
  }
}
