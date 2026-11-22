import type {
  AuditLogItem,
  AuthUser,
  CourseGroup,
  CoursePayment,
  Customer,
  DirectDrinkSale,
  DrinkItem,
  ExpenseCategory,
  LedgerEntry,
  LedgerEntryType,
  MonthlyProfitReport,
  PaymentMethod,
  ReceiptData,
  StudentEnrollment,
  UserRole,
  WorkspaceSession,
  WorkspaceSettings,
} from '../shared/types.ts';

let memoryToken: string | null = null;

export function setAuthToken(token: string | null): void {
  memoryToken = token;
}

export function getAuthToken(): string | null {
  return memoryToken;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };

  if (memoryToken) {
    headers.Authorization = `Bearer ${memoryToken}`;
  }

  let res: Response;
  try {
    res = await fetch(path, {
      ...options,
      headers,
    });
  } catch {
    throw new ApiError(
      'تعذر الاتصال بالخادم. تحقق من الشبكة ثم حاول مرة أخرى — بياناتك ما زالت محفوظة في النموذج.',
      0
    );
  }

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }

  if (!res.ok) {
    const message =
      (data as { error?: string } | null)?.error ||
      'حدث خطأ أثناء تنفيذ العملية.';
    throw new ApiError(message, res.status);
  }

  return data as T;
}

export const api = {
  // Auth
  getAuthStatus: () =>
    request<{ needsSetup: boolean; envAdminConfigured: boolean }>(
      '/api/auth/status'
    ),

  bootstrapAdmin: (payload: {
    username: string;
    displayName: string;
    password: string;
    receptionist?: { username: string; displayName: string; password: string };
  }) =>
    request<{ token: string; user: AuthUser }>('/api/auth/bootstrap', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  login: (username: string, password: string) =>
    request<{ token: string; user: AuthUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  me: () => request<{ user: AuthUser }>('/api/auth/me'),

  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  // Settings
  getSettings: () => request<WorkspaceSettings>('/api/settings'),
  updateSettings: (payload: {
    workspaceName?: string;
    hourlyRatePiasters?: number;
    phone?: string;
    address?: string;
    receiptFooter?: string;
  }) =>
    request<WorkspaceSettings>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  // Users
  listUsers: () => request<AuthUser[]>('/api/users'),
  createUser: (payload: {
    username: string;
    displayName: string;
    role: UserRole;
    password: string;
  }) =>
    request<AuthUser>('/api/users', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateUser: (
    id: number,
    payload: {
      displayName?: string;
      role?: UserRole;
      isActive?: boolean;
      password?: string;
    }
  ) =>
    request<AuthUser>(`/api/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  // Drinks
  listDrinks: (includeInactive = true) =>
    request<DrinkItem[]>(`/api/drinks?includeInactive=${includeInactive}`),
  createDrink: (payload: { name: string; pricePiasters: number }) =>
    request<DrinkItem>('/api/drinks', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateDrink: (
    id: number,
    payload: { name?: string; pricePiasters?: number; isActive?: boolean }
  ) =>
    request<DrinkItem>(`/api/drinks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  // Expense Categories
  listExpenseCategories: (includeInactive = true) =>
    request<ExpenseCategory[]>(
      `/api/expense-categories?includeInactive=${includeInactive}`
    ),
  createExpenseCategory: (name: string) =>
    request<ExpenseCategory>('/api/expense-categories', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  updateExpenseCategory: (
    id: number,
    payload: { name?: string; isActive?: boolean }
  ) =>
    request<ExpenseCategory>(`/api/expense-categories/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  // Sessions
  listCustomers: (search = '', limit = 100) => {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (search.trim()) qs.set('search', search.trim());
    return request<Customer[]>(`/api/customers?${qs.toString()}`);
  },
  listSessions: (status: 'open' | 'closed' | 'all' = 'open', limit = 60) =>
    request<WorkspaceSession[]>(
      `/api/sessions?status=${status}&limit=${limit}`
    ),
  getSession: (id: number) => request<WorkspaceSession>(`/api/sessions/${id}`),
  startSession: (payload: {
    customerId?: number | null;
    clientName?: string | null;
    customerPhone?: string | null;
    notes?: string | null;
  }) =>
    request<WorkspaceSession>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  addSessionDrink: (
    sessionId: number,
    payload: { drinkId: number; quantity: number }
  ) =>
    request<WorkspaceSession>(`/api/sessions/${sessionId}/drinks`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateSessionDrinkQty: (
    sessionId: number,
    itemId: number,
    quantity: number
  ) =>
    request<WorkspaceSession>(`/api/sessions/${sessionId}/drinks/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify({ quantity }),
    }),
  checkoutSession: (
    sessionId: number,
    payload: {
      paymentMethod: PaymentMethod;
      idempotencyKey: string;
      endedAt?: string;
      notes?: string | null;
    }
  ) =>
    request<{
      session: WorkspaceSession;
      receipt: ReceiptData;
      alreadyProcessed: boolean;
    }>(`/api/sessions/${sessionId}/checkout`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Direct Drink Sales
  listDirectSales: (limit = 40) =>
    request<DirectDrinkSale[]>(`/api/direct-sales?limit=${limit}`),
  createDirectSale: (payload: {
    customerName?: string | null;
    items: Array<{ drinkId: number; quantity: number }>;
    paymentMethod: PaymentMethod;
    idempotencyKey: string;
  }) =>
    request<{
      sale: DirectDrinkSale;
      receipt: ReceiptData;
      alreadyProcessed: boolean;
    }>('/api/direct-sales', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Courses & Enrollments
  listCourseGroups: () => request<CourseGroup[]>('/api/course-groups'),
  createCourseGroup: (payload: {
    courseName: string;
    groupName: string;
    instructorName: string;
    schedule: string;
    pricePiasters: number;
  }) =>
    request<CourseGroup>('/api/course-groups', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateCourseGroup: (
    id: number,
    payload: {
      courseName?: string;
      groupName?: string;
      instructorName?: string;
      schedule?: string;
      pricePiasters?: number;
      status?: 'active' | 'completed' | 'archived';
    }
  ) =>
    request<CourseGroup>(`/api/course-groups/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  listEnrollments: (courseGroupId?: number) =>
    request<StudentEnrollment[]>(
      courseGroupId
        ? `/api/enrollments?courseGroupId=${courseGroupId}`
        : '/api/enrollments'
    ),
  enrollStudent: (payload: {
    courseGroupId: number;
    studentName: string;
    studentPhone: string;
    agreedPricePiasters?: number;
    notes?: string | null;
  }) =>
    request<StudentEnrollment>('/api/enrollments', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  recordCoursePayment: (
    enrollmentId: number,
    payload: {
      amountPiasters: number;
      paymentMethod: PaymentMethod;
      paidAt?: string;
      notes?: string | null;
      idempotencyKey: string;
    }
  ) =>
    request<{
      enrollment: StudentEnrollment;
      payment: CoursePayment;
      receipt: ReceiptData;
      alreadyProcessed: boolean;
    }>(`/api/enrollments/${enrollmentId}/payments`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Ledger
  listLedger: (params: {
    search?: string;
    month?: string;
    fromDate?: string;
    toDate?: string;
    entryType?: LedgerEntryType | 'all';
    categoryId?: number;
    paymentMethod?: PaymentMethod | 'all';
    limit?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params.search) qs.set('search', params.search);
    if (params.month) qs.set('month', params.month);
    if (params.fromDate) qs.set('fromDate', params.fromDate);
    if (params.toDate) qs.set('toDate', params.toDate);
    if (params.entryType && params.entryType !== 'all')
      qs.set('entryType', params.entryType);
    if (params.categoryId) qs.set('categoryId', String(params.categoryId));
    if (params.paymentMethod && params.paymentMethod !== 'all')
      qs.set('paymentMethod', params.paymentMethod);
    if (params.limit) qs.set('limit', String(params.limit));
    const q = qs.toString();
    return request<LedgerEntry[]>(`/api/ledger${q ? `?${q}` : ''}`);
  },
  recordManualLedger: (payload: {
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
  }) =>
    request<{ entry: LedgerEntry; alreadyProcessed: boolean }>(
      '/api/ledger/manual',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
  createRefund: (
    originalLedgerId: number,
    payload: {
      amountPiasters: number;
      paymentMethod: PaymentMethod;
      reason: string;
      refundedAt?: string;
      idempotencyKey: string;
    }
  ) =>
    request<{ entry: LedgerEntry; alreadyProcessed: boolean }>(
      `/api/ledger/${originalLedgerId}/refund`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  // Reports & Audit
  getMonthlyReport: (month?: string) =>
    request<MonthlyProfitReport>(
      month
        ? `/api/reports/monthly?month=${encodeURIComponent(month)}`
        : '/api/reports/monthly'
    ),
  listAuditLogs: (limit = 100) =>
    request<AuditLogItem[]>(`/api/audit-logs?limit=${limit}`),
};
