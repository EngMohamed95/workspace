import React, { useMemo, useState } from 'react';
import {
  X,
  Plus,
  Minus,
  AlertCircle,
  Coffee,
  Receipt,
  GraduationCap,
  Wallet,
  RotateCcw,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import type {
  DrinkItem,
  ExpenseCategory,
  LedgerEntry,
  PaymentMethod,
  ReceiptData,
  StudentEnrollment,
} from '../shared/types.ts';
import {
  cairoDateToIsoNoon,
  egpToPiasters,
  formatEgp,
  generateIdempotencyKey,
  getCurrentCairoDate,
  PAYMENT_METHOD_LABELS,
} from '../shared/format.ts';

const PAYMENT_METHODS: PaymentMethod[] = [
  'cash',
  'instapay',
  'e_wallet',
  'card',
];

function PaymentMethodSelector({
  value,
  onChange,
}: {
  value: PaymentMethod;
  onChange: (m: PaymentMethod) => void;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {PAYMENT_METHODS.map((method) => (
        <button
          key={method}
          type="button"
          onClick={() => onChange(method)}
          className={`h-11 px-2 rounded-lg text-sm font-semibold border transition-colors cursor-pointer whitespace-nowrap ${
            value === method
              ? 'bg-teal-700 text-white border-teal-700'
              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
          }`}
        >
          {PAYMENT_METHOD_LABELS[method]}
        </button>
      ))}
    </div>
  );
}

// ==================== 1. DIRECT DRINK SALE MODAL ====================

export function DirectDrinkSaleModal({
  drinks,
  onClose,
  onSuccess,
}: {
  drinks: DrinkItem[];
  onClose: () => void;
  onSuccess: (receipt: ReceiptData, message: string) => void;
}) {
  const activeDrinks = useMemo(() => drinks.filter((d) => d.isActive), [drinks]);
  const [customerName, setCustomerName] = useState('');
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [idempotencyKey] = useState(() => generateIdempotencyKey('direct-sale'));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedItems = useMemo(() => {
    return activeDrinks
      .filter((d) => (quantities[d.id] || 0) > 0)
      .map((d) => ({
        drink: d,
        quantity: quantities[d.id] || 0,
        lineTotal: d.pricePiasters * (quantities[d.id] || 0),
      }));
  }, [activeDrinks, quantities]);

  const grandTotal = selectedItems.reduce((acc, i) => acc + i.lineTotal, 0);

  function adjustQty(drinkId: number, delta: number) {
    setQuantities((prev) => {
      const next = Math.max(0, (prev[drinkId] || 0) + delta);
      return { ...prev, [drinkId]: next };
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (selectedItems.length === 0) {
      setError('اختر مشروبًا واحدًا على الأقل لإتمام البيع.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.createDirectSale({
        customerName: customerName.trim() || null,
        items: selectedItems.map((i) => ({
          drinkId: i.drink.id,
          quantity: i.quantity,
        })),
        paymentMethod,
        idempotencyKey,
      });
      onSuccess(
        res.receipt,
        `تم تسجيل بيع مشروبات مباشر بقيمة ${formatEgp(res.sale.totalPiasters)}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ عملية البيع.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-xl bg-white rounded-xl border border-slate-200 overflow-hidden my-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <Coffee className="w-5 h-5 text-teal-700" />
            <h2 className="text-lg font-bold text-slate-900">
              بيع مشروب مباشر (بدون جلسة)
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-5">
          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              اسم العميل (اختياري)
            </label>
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="مثال: زائر خارجي"
              className="w-full h-11 px-3.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              اختر المشروبات والكميات
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-64 overflow-y-auto pl-1">
              {activeDrinks.map((drink) => {
                const qty = quantities[drink.id] || 0;
                return (
                  <div
                    key={drink.id}
                    className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                      qty > 0
                        ? 'border-teal-600 bg-teal-50/40'
                        : 'border-slate-200 bg-white'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-sm text-slate-900 truncate">
                        {drink.name}
                      </div>
                      <div className="text-xs text-slate-500 tabular-nums mt-0.5">
                        {formatEgp(drink.pricePiasters)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => adjustQty(drink.id, -1)}
                        disabled={qty === 0}
                        className="w-8 h-8 rounded-md border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-40 flex items-center justify-center cursor-pointer"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                      <span className="w-7 text-center font-bold text-sm tabular-nums">
                        {qty}
                      </span>
                      <button
                        type="button"
                        onClick={() => adjustQty(drink.id, 1)}
                        className="w-8 h-8 rounded-md bg-teal-700 hover:bg-teal-800 text-white flex items-center justify-center cursor-pointer"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              وسيلة التحصيل
            </label>
            <PaymentMethodSelector
              value={paymentMethod}
              onChange={setPaymentMethod}
            />
          </div>

          <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-700">
              إجمالي المطلوب تحصيله
            </span>
            <span className="text-xl font-extrabold text-slate-900 tabular-nums">
              {formatEgp(grandTotal)}
            </span>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={submitting || grandTotal <= 0}
              className="flex-1 h-12 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white font-bold text-base transition-colors cursor-pointer"
            >
              {submitting ? 'جاري تسجيل التحصيل...' : 'تأكيد البيع والتحصيل'}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="h-12 px-5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-medium text-sm cursor-pointer"
            >
              إلغاء
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ==================== 2. EXPENSE MODAL ====================

export function ExpenseModal({
  categories,
  onClose,
  onSuccess,
}: {
  categories: ExpenseCategory[];
  onClose: () => void;
  onSuccess: (message: string) => void;
}) {
  const activeCategories = useMemo(
    () => categories.filter((c) => c.isActive),
    [categories]
  );
  const [categoryId, setCategoryId] = useState<number>(
    activeCategories[0]?.id || 0
  );
  const [amountEgp, setAmountEgp] = useState('');
  const [cairoDate, setCairoDate] = useState(getCurrentCairoDate);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [description, setDescription] = useState('');
  const [idempotencyKey] = useState(() => generateIdempotencyKey('expense'));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const amountPiasters = egpToPiasters(amountEgp);
    if (amountPiasters <= 0) {
      setError('أدخل مبلغ مصروف صحيح أكبر من صفر.');
      return;
    }
    if (!categoryId) {
      setError('اختر تصنيف المصروف.');
      return;
    }
    if (description.trim().length < 2) {
      setError('أدخل بيانًا واضحًا للمصروف.');
      return;
    }

    setSubmitting(true);
    try {
      await api.recordManualLedger({
        entryType: 'expense',
        amountPiasters,
        paymentMethod,
        categoryId,
        description: description.trim(),
        occurredAt:
          cairoDate === getCurrentCairoDate()
            ? new Date().toISOString()
            : cairoDateToIsoNoon(cairoDate),
        idempotencyKey,
      });
      onSuccess(`تم تسجيل مصروف بقيمة ${formatEgp(amountPiasters)} بنجاح.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تسجيل المصروف.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-lg bg-white rounded-xl border border-slate-200 overflow-hidden my-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <Receipt className="w-5 h-5 text-red-600" />
            <h2 className="text-lg font-bold text-slate-900">تسجيل مصروف تشغيلي</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                المبلغ (جنيه مصري)
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                dir="ltr"
                value={amountEgp}
                onChange={(e) => setAmountEgp(e.target.value)}
                placeholder="200.00"
                className="w-full h-11 px-3.5 rounded-lg border border-slate-300 text-base font-mono text-left focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                تاريخ الدفع (القاهرة)
              </label>
              <input
                type="date"
                required
                value={cairoDate}
                onChange={(e) => setCairoDate(e.target.value)}
                className="w-full h-11 px-3.5 rounded-lg border border-slate-300 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              التصنيف
            </label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(Number(e.target.value))}
              className="w-full h-11 px-3.5 rounded-lg border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
            >
              {activeCategories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              البيان / التفاصيل
            </label>
            <input
              type="text"
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="مثال: فاتورة إنترنت WE لشهر نوفمبر"
              className="w-full h-11 px-3.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              وسيلة الدفع
            </label>
            <PaymentMethodSelector
              value={paymentMethod}
              onChange={setPaymentMethod}
            />
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 h-12 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold text-base transition-colors cursor-pointer"
            >
              {submitting ? 'جاري الحفظ...' : 'تأكيد تسجيل المصروف'}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="h-12 px-5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-medium text-sm cursor-pointer"
            >
              إلغاء
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ==================== 3. STUDENT PAYMENT MODAL ====================

export function StudentPaymentModal({
  enrollments,
  initialEnrollmentId,
  onClose,
  onSuccess,
}: {
  enrollments: StudentEnrollment[];
  initialEnrollmentId?: number;
  onClose: () => void;
  onSuccess: (receipt: ReceiptData, message: string) => void;
}) {
  const unpaidEnrollments = useMemo(
    () => enrollments.filter((e) => e.remainingPiasters > 0),
    [enrollments]
  );
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<number>(
    initialEnrollmentId || unpaidEnrollments[0]?.id || 0
  );
  const [amountEgp, setAmountEgp] = useState('');
  const [cairoDate, setCairoDate] = useState(getCurrentCairoDate);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [notes, setNotes] = useState('');
  const [idempotencyKey] = useState(() =>
    generateIdempotencyKey('course-payment')
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return unpaidEnrollments;
    return unpaidEnrollments.filter(
      (e) =>
        e.studentName.toLowerCase().includes(q) ||
        e.studentPhone.includes(q) ||
        e.courseName.toLowerCase().includes(q)
    );
  }, [unpaidEnrollments, search]);

  const selected = useMemo(
    () => enrollments.find((e) => e.id === selectedId) || null,
    [enrollments, selectedId]
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!selected) {
      setError('يرجى اختيار الطالب أولًا.');
      return;
    }
    const amountPiasters = egpToPiasters(amountEgp);
    if (amountPiasters <= 0) {
      setError('أدخل مبلغ دفعة صحيح أكبر من صفر.');
      return;
    }
    if (amountPiasters > selected.remainingPiasters) {
      setError(
        `المبلغ المدخل أكبر من المتبقي على الطالب (${formatEgp(selected.remainingPiasters)}).`
      );
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.recordCoursePayment(selected.id, {
        amountPiasters,
        paymentMethod,
        paidAt:
          cairoDate === getCurrentCairoDate()
            ? new Date().toISOString()
            : cairoDateToIsoNoon(cairoDate),
        notes: notes.trim() || null,
        idempotencyKey,
      });
      onSuccess(
        res.receipt,
        `تم تحصيل ${formatEgp(amountPiasters)} من الطالب ${selected.studentName}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تسجيل الدفعة.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-lg bg-white rounded-xl border border-slate-200 overflow-hidden my-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <GraduationCap className="w-5 h-5 text-teal-700" />
            <h2 className="text-lg font-bold text-slate-900">
              تحصيل دفعة كورس من طالب
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {unpaidEnrollments.length === 0 ? (
          <div className="p-6 text-center space-y-3">
            <p className="text-slate-700 font-medium">
              لا يوجد طلاب عليهم مبالغ متبقية حاليًا.
            </p>
            <p className="text-sm text-slate-500">
              يمكنك تسجيل طالب جديد في مجموعة كورس من شاشة «الكورسات».
            </p>
            <button
              type="button"
              onClick={onClose}
              className="h-10 px-5 rounded-lg bg-slate-900 text-white text-sm font-medium cursor-pointer"
            >
              إغلاق
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            {error && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">
                <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {!initialEnrollmentId && (
              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-700">
                  اختر الطالب
                </label>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="ابحث بالاسم أو الموبايل أو الكورس..."
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
                <select
                  value={selectedId}
                  onChange={(e) => setSelectedId(Number(e.target.value))}
                  className="w-full h-11 px-3 rounded-lg border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                >
                  {filtered.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.studentName} — {e.courseName} ({e.groupName}) · المتبقي:{' '}
                      {formatEgp(e.remainingPiasters)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {selected && (
              <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-xs text-slate-500">المطلوب</div>
                  <div className="text-sm font-bold text-slate-900 tabular-nums mt-0.5">
                    {formatEgp(selected.agreedPricePiasters)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">المدفوع</div>
                  <div className="text-sm font-bold text-emerald-700 tabular-nums mt-0.5">
                    {formatEgp(selected.paidPiasters)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">المتبقي</div>
                  <div className="text-sm font-bold text-amber-700 tabular-nums mt-0.5">
                    {formatEgp(selected.remainingPiasters)}
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-medium text-slate-700">
                    مبلغ الدفعة (ج.م)
                  </label>
                  {selected && (
                    <button
                      type="button"
                      onClick={() =>
                        setAmountEgp((selected.remainingPiasters / 100).toFixed(2))
                      }
                      className="text-xs font-semibold text-teal-700 hover:underline cursor-pointer"
                    >
                      سداد المتبقي كاملًا
                    </button>
                  )}
                </div>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  dir="ltr"
                  value={amountEgp}
                  onChange={(e) => setAmountEgp(e.target.value)}
                  placeholder="500.00"
                  className="w-full h-11 px-3.5 rounded-lg border border-slate-300 text-base font-mono text-left focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  تاريخ التحصيل الفعلي
                </label>
                <input
                  type="date"
                  required
                  value={cairoDate}
                  onChange={(e) => setCairoDate(e.target.value)}
                  className="w-full h-11 px-3.5 rounded-lg border border-slate-300 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                وسيلة التحصيل
              </label>
              <PaymentMethodSelector
                value={paymentMethod}
                onChange={setPaymentMethod}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                ملاحظات (اختياري)
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="مثال: القسط الأول"
                className="w-full h-11 px-3.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>

            <div className="flex items-center gap-3 pt-1">
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 h-12 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white font-bold text-base transition-colors cursor-pointer"
              >
                {submitting ? 'جاري التحصيل...' : 'تأكيد تحصيل الدفعة'}
              </button>
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="h-12 px-5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-medium text-sm cursor-pointer"
              >
                إلغاء
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ==================== 4. OTHER REVENUE / OWNER EQUITY MODAL ====================

export function ManualFinanceModal({
  mode,
  onClose,
  onSuccess,
}: {
  mode: 'other_revenue' | 'owner_equity';
  onClose: () => void;
  onSuccess: (message: string) => void;
}) {
  const [ownerType, setOwnerType] = useState<'owner_deposit' | 'owner_withdrawal'>(
    'owner_deposit'
  );
  const [amountEgp, setAmountEgp] = useState('');
  const [cairoDate, setCairoDate] = useState(getCurrentCairoDate);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [description, setDescription] = useState('');
  const [idempotencyKey] = useState(() => generateIdempotencyKey(mode));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const entryType = mode === 'other_revenue' ? 'other_revenue' : ownerType;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const amountPiasters = egpToPiasters(amountEgp);
    if (amountPiasters <= 0) {
      setError('أدخل مبلغًا صحيحًا أكبر من صفر.');
      return;
    }
    if (description.trim().length < 2) {
      setError('يرجى كتابة بيان واضح للعملية.');
      return;
    }
    setSubmitting(true);
    try {
      await api.recordManualLedger({
        entryType,
        amountPiasters,
        paymentMethod,
        description: description.trim(),
        occurredAt:
          cairoDate === getCurrentCairoDate()
            ? new Date().toISOString()
            : cairoDateToIsoNoon(cairoDate),
        idempotencyKey,
      });
      const label =
        entryType === 'other_revenue'
          ? 'الإيراد الآخر'
          : entryType === 'owner_deposit'
            ? 'إيداع صاحب المكان'
            : 'السحب الشخصي لصاحب المكان';
      onSuccess(`تم تسجيل ${label} بقيمة ${formatEgp(amountPiasters)} بنجاح.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ العملية.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-lg bg-white rounded-xl border border-slate-200 overflow-hidden my-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <Wallet className="w-5 h-5 text-teal-700" />
            <h2 className="text-lg font-bold text-slate-900">
              {mode === 'other_revenue'
                ? 'تسجيل إيراد تشغيلي آخر'
                : 'حركة صاحب المكان (إيداع / سحب شخصي)'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {mode === 'owner_equity' && (
            <div className="space-y-2">
              <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3">
                حركات صاحب المكان تظهر في حركة الأموال ورصيد الكاش فقط، ولا تدخل ضمن إيرادات أو مصروفات التشغيل أو صافي الربح.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setOwnerType('owner_deposit')}
                  className={`h-11 rounded-lg text-sm font-bold border cursor-pointer ${
                    ownerType === 'owner_deposit'
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-300'
                  }`}
                >
                  إيداع صاحب المكان (+)
                </button>
                <button
                  type="button"
                  onClick={() => setOwnerType('owner_withdrawal')}
                  className={`h-11 rounded-lg text-sm font-bold border cursor-pointer ${
                    ownerType === 'owner_withdrawal'
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-300'
                  }`}
                >
                  سحب شخصي (-)
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                المبلغ (ج.م)
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                dir="ltr"
                value={amountEgp}
                onChange={(e) => setAmountEgp(e.target.value)}
                placeholder="1000.00"
                className="w-full h-11 px-3.5 rounded-lg border border-slate-300 text-base font-mono text-left focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                التاريخ (القاهرة)
              </label>
              <input
                type="date"
                required
                value={cairoDate}
                onChange={(e) => setCairoDate(e.target.value)}
                className="w-full h-11 px-3.5 rounded-lg border border-slate-300 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              البيان
            </label>
            <input
              type="text"
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={
                mode === 'other_revenue'
                  ? 'مثال: تأجير قاعة الاجتماعات لمدة 3 ساعات'
                  : 'مثال: تمويل نقدي لصندوق الوركسبيس'
              }
              className="w-full h-11 px-3.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              الوسيلة
            </label>
            <PaymentMethodSelector
              value={paymentMethod}
              onChange={setPaymentMethod}
            />
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 h-12 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white font-bold text-base cursor-pointer"
            >
              {submitting ? 'جاري الحفظ...' : 'حفظ الحركة'}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="h-12 px-5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-medium text-sm cursor-pointer"
            >
              إلغاء
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ==================== 5. REFUND MODAL ====================

export function RefundModal({
  entry,
  onClose,
  onSuccess,
}: {
  entry: LedgerEntry;
  onClose: () => void;
  onSuccess: (message: string) => void;
}) {
  const maxRefundable = Math.max(
    0,
    entry.amountPiasters - entry.refundedPiasters
  );
  const [amountEgp, setAmountEgp] = useState((maxRefundable / 100).toFixed(2));
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    entry.paymentMethod
  );
  const [cairoDate, setCairoDate] = useState(getCurrentCairoDate);
  const [reason, setReason] = useState('');
  const [idempotencyKey] = useState(() => generateIdempotencyKey('refund'));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const amountPiasters = egpToPiasters(amountEgp);
    if (amountPiasters <= 0) {
      setError('أدخل مبلغ استرداد صحيح أكبر من صفر.');
      return;
    }
    if (amountPiasters > maxRefundable) {
      setError(
        `لا يمكن استرداد أكثر من المتاح (${formatEgp(maxRefundable)}).`
      );
      return;
    }
    if (reason.trim().length < 2) {
      setError('يرجى توضيح سبب الاسترداد.');
      return;
    }

    setSubmitting(true);
    try {
      await api.createRefund(entry.id, {
        amountPiasters,
        paymentMethod,
        reason: reason.trim(),
        refundedAt:
          cairoDate === getCurrentCairoDate()
            ? new Date().toISOString()
            : cairoDateToIsoNoon(cairoDate),
        idempotencyKey,
      });
      onSuccess(`تم تسجيل استرداد بقيمة ${formatEgp(amountPiasters)} بنجاح.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تسجيل الاسترداد.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-lg bg-white rounded-xl border border-slate-200 overflow-hidden my-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <RotateCcw className="w-5 h-5 text-amber-600" />
            <h2 className="text-lg font-bold text-slate-900">
              استرداد مبلغ عن حركة #{entry.id}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-sm space-y-1">
            <div className="font-semibold text-slate-900">{entry.description}</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 tabular-nums">
              <span>المحصّل أصلًا: {formatEgp(entry.amountPiasters)}</span>
              <span>المسترد سابقًا: {formatEgp(entry.refundedPiasters)}</span>
              <span className="font-bold text-amber-700">
                الحد الأقصى للاسترداد: {formatEgp(maxRefundable)}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                مبلغ الاسترداد (ج.م)
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                max={(maxRefundable / 100).toFixed(2)}
                required
                dir="ltr"
                value={amountEgp}
                onChange={(e) => setAmountEgp(e.target.value)}
                className="w-full h-11 px-3.5 rounded-lg border border-slate-300 text-base font-mono text-left focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                تاريخ الاسترداد
              </label>
              <input
                type="date"
                required
                value={cairoDate}
                onChange={(e) => setCairoDate(e.target.value)}
                className="w-full h-11 px-3.5 rounded-lg border border-slate-300 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              سبب الاسترداد
            </label>
            <input
              type="text"
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="مثال: إلغاء طلب مشروب / تعديل حساب"
              className="w-full h-11 px-3.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              وسيلة رد المبلغ
            </label>
            <PaymentMethodSelector
              value={paymentMethod}
              onChange={setPaymentMethod}
            />
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={submitting || maxRefundable <= 0}
              className="flex-1 h-12 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold text-base cursor-pointer"
            >
              {submitting ? 'جاري التنفيذ...' : 'تأكيد الاسترداد'}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="h-12 px-5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-medium text-sm cursor-pointer"
            >
              إلغاء
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
