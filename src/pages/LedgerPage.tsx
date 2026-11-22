import React, { useEffect, useState } from 'react';
import {
  Search,
  Receipt,
  PlusCircle,
  Wallet,
  RotateCcw,
  Link2,
  X,
  Filter,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import type {
  AuthUser,
  ExpenseCategory,
  LedgerEntry,
  LedgerEntryType,
  PaymentMethod,
  WorkspaceSession,
} from '../shared/types.ts';
import {
  formatCairoDateArabic,
  formatCairoDateTime,
  formatCairoTime,
  formatDurationArabic,
  formatEgp,
  getCurrentCairoMonth,
  LEDGER_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
} from '../shared/format.ts';
import {
  ExpenseModal,
  ManualFinanceModal,
  RefundModal,
} from '../components/QuickModals.tsx';

interface LedgerPageProps {
  user: AuthUser;
  categories: ExpenseCategory[];
  onNotify: (type: 'success' | 'error', message: string) => void;
}

const REFUNDABLE_TYPES: LedgerEntryType[] = [
  'session_revenue',
  'drinks_revenue',
  'course_payment',
  'other_revenue',
];

export function LedgerPage({ user, categories, onNotify }: LedgerPageProps) {
  const isAdmin = user.role === 'admin';
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState('');
  const [month, setMonth] = useState(getCurrentCairoMonth);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [entryType, setEntryType] = useState<LedgerEntryType | 'all'>('all');
  const [categoryId, setCategoryId] = useState<string>('all');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | 'all'>(
    'all'
  );

  // Modals
  const [showExpense, setShowExpense] = useState(false);
  const [showOtherRev, setShowOtherRev] = useState(false);
  const [showOwnerModal, setShowOwnerModal] = useState(false);
  const [refundTarget, setRefundTarget] = useState<LedgerEntry | null>(null);
  const [sourceSessionDetail, setSourceSessionDetail] =
    useState<WorkspaceSession | null>(null);

  async function loadLedger() {
    setLoading(true);
    try {
      const list = await api.listLedger({
        search: search.trim() || undefined,
        month: !fromDate && !toDate && month ? month : undefined,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
        entryType,
        categoryId: categoryId !== 'all' ? Number(categoryId) : undefined,
        paymentMethod,
        limit: 300,
      });
      setEntries(list);
    } catch (err) {
      onNotify(
        'error',
        err instanceof Error ? err.message : 'تعذر تحميل الحركات المالية.'
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadLedger();
  }, [month, fromDate, toDate, entryType, categoryId, paymentMethod]);

  async function handleOpenSource(entry: LedgerEntry) {
    if (entry.sourceType === 'session' && entry.sourceId) {
      try {
        const s = await api.getSession(entry.sourceId);
        setSourceSessionDetail(s);
      } catch (err) {
        onNotify(
          'error',
          err instanceof Error ? err.message : 'تعذر تحميل تفاصيل الجلسة.'
        );
      }
    }
  }

  const totalIn = entries
    .filter((e) => e.direction === 'in')
    .reduce((acc, e) => acc + e.amountPiasters, 0);
  const totalOut = entries
    .filter((e) => e.direction === 'out')
    .reduce((acc, e) => acc + e.amountPiasters, 0);

  return (
    <div className="space-y-5">
      {/* Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">
            سجل الحركات المالية
          </h2>
          <p className="text-sm text-slate-500">
            كل حركة مربوطة بمصدرها والموظف المسؤول ووقت التنفيذ بتوقيت القاهرة.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setShowExpense(true)}
            className="h-11 px-4 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold text-sm flex items-center gap-2 cursor-pointer whitespace-nowrap"
          >
            <Receipt className="w-4 h-4" />
            <span>تسجيل مصروف</span>
          </button>

          <button
            type="button"
            onClick={() => setShowOtherRev(true)}
            className="h-11 px-4 rounded-lg bg-teal-700 hover:bg-teal-800 text-white font-semibold text-sm flex items-center gap-2 cursor-pointer whitespace-nowrap"
          >
            <PlusCircle className="w-4 h-4" />
            <span>إيراد آخر</span>
          </button>

          {isAdmin && (
            <button
              type="button"
              onClick={() => setShowOwnerModal(true)}
              className="h-11 px-4 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm flex items-center gap-2 cursor-pointer whitespace-nowrap"
            >
              <Wallet className="w-4 h-4" />
              <span>إيداع / سحب صاحب المكان</span>
            </button>
          )}
        </div>
      </div>

      {/* Filters Panel */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-600">
          <Filter className="w-3.5 h-3.5" />
          <span>بحث وتصفية الحركات</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              loadLedger();
            }}
            className="relative"
          >
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث في البيان أو الموظف..."
              className="w-full h-10 pr-9 pl-3 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </form>

          <select
            value={entryType}
            onChange={(e) =>
              setEntryType(e.target.value as LedgerEntryType | 'all')
            }
            className="h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
          >
            <option value="all">كل أنواع الحركات</option>
            <option value="session_revenue">تحصيل جلسات</option>
            <option value="drinks_revenue">تحصيل مشروبات</option>
            <option value="course_payment">دفعات الكورسات</option>
            <option value="other_revenue">إيرادات أخرى</option>
            <option value="expense">مصروفات التشغيل</option>
            <option value="refund">مبالغ مستردة</option>
            {isAdmin && <option value="owner_deposit">إيداع صاحب المكان</option>}
            {isAdmin && (
              <option value="owner_withdrawal">سحب شخصي لصاحب المكان</option>
            )}
          </select>

          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
          >
            <option value="all">كل تصنيفات المصروفات</option>
            {categories.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.name}
              </option>
            ))}
          </select>

          <select
            value={paymentMethod}
            onChange={(e) =>
              setPaymentMethod(e.target.value as PaymentMethod | 'all')
            }
            className="h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
          >
            <option value="all">كل وسائل الدفع</option>
            <option value="cash">كاش</option>
            <option value="instapay">إنستاباي</option>
            <option value="e_wallet">محفظة إلكترونية</option>
            <option value="card">بطاقة بنكية</option>
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-4 gap-3 pt-1">
          <div>
            <label className="block text-xs text-slate-500 mb-1">الشهر</label>
            <input
              type="month"
              value={month}
              onChange={(e) => {
                setMonth(e.target.value);
                setFromDate('');
                setToDate('');
              }}
              className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">من تاريخ</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">إلى تاريخ</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>
          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={loadLedger}
              className="flex-1 h-10 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold cursor-pointer"
            >
              تطبيق البحث
            </button>
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setMonth(getCurrentCairoMonth());
                setFromDate('');
                setToDate('');
                setEntryType('all');
                setCategoryId('all');
                setPaymentMethod('all');
              }}
              className="h-10 px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium cursor-pointer"
            >
              مسح
            </button>
          </div>
        </div>
      </div>

      {/* Filtered Summary Strip */}
      <div className="bg-white border border-slate-200 rounded-xl px-5 py-3.5 flex flex-wrap items-center justify-between gap-4 text-sm">
        <div className="text-slate-600">
          عدد الحركات المطابقة:{' '}
          <span className="font-bold text-slate-900 tabular-nums">
            {entries.length}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <div>
            <span className="text-slate-500 ml-1.5">إجمالي الداخل:</span>
            <span className="font-bold text-emerald-700 tabular-nums">
              {formatEgp(totalIn)}
            </span>
          </div>
          <div>
            <span className="text-slate-500 ml-1.5">إجمالي الخارج:</span>
            <span className="font-bold text-red-700 tabular-nums">
              {formatEgp(totalOut)}
            </span>
          </div>
        </div>
      </div>

      {/* Ledger Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        {loading ? (
          <div className="p-10 text-center text-sm text-slate-500">
            جاري تحميل الحركات المالية...
          </div>
        ) : entries.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            لا توجد حركات مالية مطابقة للتصفية الحالية.
          </div>
        ) : (
          <table className="w-full text-sm text-right">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
              <tr>
                <th className="py-3 px-4 font-semibold">#</th>
                <th className="py-3 px-4 font-semibold">التاريخ والوقت</th>
                <th className="py-3 px-4 font-semibold">النوع والتصنيف</th>
                <th className="py-3 px-4 font-semibold">البيان والمصدر</th>
                <th className="py-3 px-4 font-semibold">الوسيلة</th>
                <th className="py-3 px-4 font-semibold">المبلغ</th>
                <th className="py-3 px-4 font-semibold">بواسطة</th>
                <th className="py-3 px-4 font-semibold text-left">إجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entries.map((entry) => {
                const canRefund =
                  REFUNDABLE_TYPES.includes(entry.entryType) &&
                  entry.amountPiasters - entry.refundedPiasters > 0;
                const isOwner =
                  entry.entryType === 'owner_deposit' ||
                  entry.entryType === 'owner_withdrawal';

                return (
                  <tr key={entry.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4 font-mono text-xs text-slate-500">
                      #{entry.id}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600 tabular-nums whitespace-nowrap">
                      <div className="font-medium text-slate-800">
                        {formatCairoDateArabic(entry.cairoDate)}
                      </div>
                      <div className="text-slate-400">
                        {formatCairoTime(entry.occurredAt)}
                      </div>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <div
                        className={`text-xs font-bold ${
                          isOwner
                            ? 'text-indigo-700'
                            : entry.entryType === 'refund'
                              ? 'text-amber-700'
                              : entry.direction === 'in'
                                ? 'text-emerald-700'
                                : 'text-red-700'
                        }`}
                      >
                        {LEDGER_TYPE_LABELS[entry.entryType]}
                      </div>
                      {entry.categoryName && (
                        <div className="text-xs text-slate-500 mt-0.5">
                          {entry.categoryName}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-800 max-w-sm">
                      <div className="leading-snug">{entry.description}</div>
                      <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-2 flex-wrap">
                        {entry.sourceType === 'session' && entry.sourceId && (
                          <button
                            type="button"
                            onClick={() => handleOpenSource(entry)}
                            className="inline-flex items-center gap-1 text-teal-700 hover:underline font-medium cursor-pointer"
                          >
                            <Link2 className="w-3 h-3" />
                            <span>عرض الجلسة المرتبطة</span>
                          </button>
                        )}
                        {entry.sourceType === 'direct_sale' && entry.sourceId && (
                          <span>بيع مباشر #{entry.sourceId}</span>
                        )}
                        {entry.sourceType === 'course_payment' && entry.sourceId && (
                          <span>دفعة كورس #{entry.sourceId}</span>
                        )}
                        {entry.originalLedgerId && (
                          <span>مرتبط بالحركة #{entry.originalLedgerId}</span>
                        )}
                        {entry.refundedPiasters > 0 && (
                          <span className="text-amber-700 font-medium">
                            تم استرداد {formatEgp(entry.refundedPiasters)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-700 whitespace-nowrap">
                      {PAYMENT_METHOD_LABELS[entry.paymentMethod]}
                    </td>
                    <td
                      className={`py-3 px-4 font-extrabold tabular-nums whitespace-nowrap ${
                        entry.direction === 'in'
                          ? 'text-emerald-700'
                          : 'text-red-700'
                      }`}
                    >
                      {entry.direction === 'in' ? '+' : '-'}
                      {formatEgp(entry.amountPiasters)}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600 whitespace-nowrap">
                      {entry.createdByName}
                    </td>
                    <td className="py-3 px-4 text-left whitespace-nowrap">
                      {canRefund ? (
                        <button
                          type="button"
                          onClick={() => setRefundTarget(entry)}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 hover:text-amber-900 cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>استرداد</span>
                        </button>
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Linked Session Detail Modal */}
      {sourceSessionDetail && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <h3 className="text-base font-bold text-slate-900">
                تفاصيل جلسة #{sourceSessionDetail.sessionNumber}
              </h3>
              <button
                type="button"
                onClick={() => setSourceSessionDetail(null)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-2.5 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">العميل:</span>
                <span className="font-semibold">
                  {sourceSessionDetail.clientName || 'زائر عابر'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">الدخول:</span>
                <span className="tabular-nums">
                  {formatCairoDateTime(sourceSessionDetail.startedAt)}
                </span>
              </div>
              {sourceSessionDetail.endedAt && (
                <div className="flex justify-between">
                  <span className="text-slate-500">الخروج:</span>
                  <span className="tabular-nums">
                    {formatCairoDateTime(sourceSessionDetail.endedAt)}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-500">المدة:</span>
                <span>
                  {formatDurationArabic(sourceSessionDetail.durationMinutes ?? 0)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">حساب القعدة:</span>
                <span className="tabular-nums font-semibold">
                  {formatEgp(sourceSessionDetail.sessionCostPiasters ?? 0)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">المشروبات:</span>
                <span className="tabular-nums font-semibold">
                  {formatEgp(sourceSessionDetail.drinksTotalPiasters)}
                </span>
              </div>
              <div className="flex justify-between pt-2 border-t border-slate-200 font-bold text-base">
                <span>الإجمالي:</span>
                <span className="tabular-nums text-teal-800">
                  {formatEgp(sourceSessionDetail.totalPiasters ?? 0)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      {showExpense && (
        <ExpenseModal
          categories={categories}
          onClose={() => setShowExpense(false)}
          onSuccess={async (msg) => {
            setShowExpense(false);
            await loadLedger();
            onNotify('success', msg);
          }}
        />
      )}

      {showOtherRev && (
        <ManualFinanceModal
          mode="other_revenue"
          onClose={() => setShowOtherRev(false)}
          onSuccess={async (msg) => {
            setShowOtherRev(false);
            await loadLedger();
            onNotify('success', msg);
          }}
        />
      )}

      {showOwnerModal && (
        <ManualFinanceModal
          mode="owner_equity"
          onClose={() => setShowOwnerModal(false)}
          onSuccess={async (msg) => {
            setShowOwnerModal(false);
            await loadLedger();
            onNotify('success', msg);
          }}
        />
      )}

      {refundTarget && (
        <RefundModal
          entry={refundTarget}
          onClose={() => setRefundTarget(null)}
          onSuccess={async (msg) => {
            setRefundTarget(null);
            await loadLedger();
            onNotify('success', msg);
          }}
        />
      )}
    </div>
  );
}
