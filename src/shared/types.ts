export type UserRole = 'admin' | 'receptionist';

export type PaymentMethod = 'cash' | 'instapay' | 'e_wallet' | 'card';

export type LedgerEntryType =
  | 'session_revenue'
  | 'drinks_revenue'
  | 'course_payment'
  | 'other_revenue'
  | 'expense'
  | 'refund'
  | 'owner_deposit'
  | 'owner_withdrawal';

export type LedgerSourceType =
  | 'session'
  | 'direct_sale'
  | 'course_payment'
  | 'manual'
  | 'refund';

export interface AuthUser {
  id: number;
  username: string;
  displayName: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
}

export interface WorkspaceSettings {
  workspaceName: string;
  hourlyRatePiasters: number;
  phone: string;
  address: string;
  receiptFooter: string;
  updatedAt: string;
}

export interface DrinkItem {
  id: number;
  name: string;
  pricePiasters: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseCategory {
  id: number;
  name: string;
  isActive: boolean;
  createdAt: string;
}

export interface Customer {
  id: number;
  name: string;
  phone: string;
  visitCount: number;
  lastVisitAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionDrinkItem {
  id: number;
  sessionId: number;
  drinkId: number;
  drinkNameSnapshot: string;
  unitPricePiasters: number;
  quantity: number;
  lineTotalPiasters: number;
  addedByUserId: number;
  createdAt: string;
}

export interface WorkspaceSession {
  id: number;
  sessionNumber: number;
  customerId: number | null;
  customerPhone: string | null;
  clientName: string | null;
  hourlyRatePiasters: number;
  startedAt: string;
  endedAt: string | null;
  durationMinutes: number | null;
  sessionCostPiasters: number | null;
  drinksTotalPiasters: number;
  totalPiasters: number | null;
  paymentMethod: PaymentMethod | null;
  status: 'open' | 'closed' | 'cancelled';
  openedByUserId: number;
  openedByName: string;
  closedByUserId: number | null;
  closedByName: string | null;
  notes: string | null;
  drinks: SessionDrinkItem[];
}

export interface DirectDrinkSaleItem {
  id: number;
  saleId: number;
  drinkId: number;
  drinkNameSnapshot: string;
  unitPricePiasters: number;
  quantity: number;
  lineTotalPiasters: number;
}

export interface DirectDrinkSale {
  id: number;
  saleNumber: number;
  customerName: string | null;
  totalPiasters: number;
  paymentMethod: PaymentMethod;
  createdByUserId: number;
  createdByName: string;
  occurredAt: string;
  items: DirectDrinkSaleItem[];
}

export interface CourseGroup {
  id: number;
  courseName: string;
  groupName: string;
  instructorName: string;
  schedule: string;
  pricePiasters: number;
  status: 'active' | 'completed' | 'archived';
  studentCount: number;
  totalAgreedPiasters: number;
  totalPaidPiasters: number;
  totalRemainingPiasters: number;
  createdAt: string;
}

export interface CoursePayment {
  id: number;
  enrollmentId: number;
  ledgerEntryId: number | null;
  amountPiasters: number;
  refundedPiasters: number;
  paymentMethod: PaymentMethod;
  paidAt: string;
  cairoDate: string;
  notes: string | null;
  receivedByUserId: number;
  receivedByName: string;
  createdAt: string;
}

export interface StudentEnrollment {
  id: number;
  courseGroupId: number;
  courseName: string;
  groupName: string;
  instructorName: string;
  schedule: string;
  studentName: string;
  studentPhone: string;
  agreedPricePiasters: number;
  paidPiasters: number;
  remainingPiasters: number;
  notes: string | null;
  enrolledByName: string;
  enrolledAt: string;
  payments: CoursePayment[];
}

export interface LedgerEntry {
  id: number;
  entryType: LedgerEntryType;
  direction: 'in' | 'out';
  amountPiasters: number;
  refundedPiasters: number;
  paymentMethod: PaymentMethod;
  categoryId: number | null;
  categoryName: string | null;
  description: string;
  occurredAt: string;
  cairoDate: string;
  cairoMonth: string;
  sourceType: LedgerSourceType;
  sourceId: number | null;
  originalLedgerId: number | null;
  createdByUserId: number;
  createdByName: string;
  createdAt: string;
}

export interface AuditLogItem {
  id: number;
  actorUserId: number | null;
  actorName: string;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: number | null;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface MonthlyReportLine {
  key: string;
  label: string;
  entryType: LedgerEntryType;
  sign: 1 | -1;
  count: number;
  amountPiasters: number;
  entries: LedgerEntry[];
}

export interface MonthlyExpenseCategoryBreakdown {
  categoryId: number | null;
  categoryName: string;
  count: number;
  amountPiasters: number;
  entries: LedgerEntry[];
}

export interface MonthlyProfitReport {
  month: string;
  sessionRevenuePiasters: number;
  drinksRevenuePiasters: number;
  coursePaymentsPiasters: number;
  otherRevenuePiasters: number;
  totalGrossCollectionsPiasters: number;
  refundsPiasters: number;
  netOperatingRevenuePiasters: number;
  operatingExpensesPiasters: number;
  netProfitPiasters: number;
  lines: MonthlyReportLine[];
  expensesByCategory: MonthlyExpenseCategoryBreakdown[];
  ownerDepositsPiasters: number;
  ownerWithdrawalsPiasters: number;
  ownerEntries: LedgerEntry[];
  studentReceivablesPiasters: number;
  studentsWithBalance: Array<{
    enrollmentId: number;
    studentName: string;
    studentPhone: string;
    courseName: string;
    groupName: string;
    agreedPricePiasters: number;
    paidPiasters: number;
    remainingPiasters: number;
  }>;
  monthlyCashInPiasters: number;
  monthlyCashOutPiasters: number;
  monthlyNetCashPiasters: number;
  cumulativeCashBalancePiasters: number;
  collectionsByMethod: Record<PaymentMethod, number>;
  availableMonths: string[];
}

export interface ReceiptData {
  kind: 'session' | 'direct_sale' | 'course_payment';
  referenceNumber: string;
  customerLabel: string;
  dateTimeIso: string;
  paymentMethod: PaymentMethod;
  cashierName: string;
  startedAt?: string;
  endedAt?: string;
  durationMinutes?: number;
  hourlyRatePiasters?: number;
  sessionCostPiasters?: number;
  items?: Array<{
    name: string;
    quantity: number;
    unitPricePiasters: number;
    lineTotalPiasters: number;
  }>;
  courseDetails?: {
    courseName: string;
    groupName: string;
    agreedPricePiasters: number;
    totalPaidPiasters: number;
    remainingPiasters: number;
  };
  totalPiasters: number;
}
