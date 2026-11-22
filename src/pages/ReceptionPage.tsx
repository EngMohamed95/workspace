import React, { useEffect, useMemo, useState } from 'react';
import {
  UserPlus,
  Coffee,
  Receipt,
  GraduationCap,
  Clock,
  CheckCircle2,
  Plus,
  Minus,
  X,
  AlertCircle,
  Printer,
  Trash2,
  Search,
  Phone,
  UserCheck,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import type {
  DrinkItem,
  Customer,
  ExpenseCategory,
  PaymentMethod,
  ReceiptData,
  StudentEnrollment,
  WorkspaceSession,
  WorkspaceSettings,
} from '../shared/types.ts';
import {
  calculateDurationMinutes,
  calculateSessionCostPiasters,
  formatCairoTime,
  formatDurationArabic,
  formatEgp,
  formatLiveTimer,
  generateIdempotencyKey,
  PAYMENT_METHOD_LABELS,
} from '../shared/format.ts';
import {
  DirectDrinkSaleModal,
  ExpenseModal,
  StudentPaymentModal,
} from '../components/QuickModals.tsx';

interface ReceptionPageProps {
  settings: WorkspaceSettings;
  drinks: DrinkItem[];
  categories: ExpenseCategory[];
  enrollments: StudentEnrollment[];
  onRefreshAll: () => Promise<void>;
  onNotify: (type: 'success' | 'error', message: string) => void;
  onShowReceipt: (receipt: ReceiptData) => void;
}

const PAYMENT_METHODS: PaymentMethod[] = [
  'cash',
  'instapay',
  'e_wallet',
  'card',
];

export function ReceptionPage({
  settings,
  drinks,
  categories,
  enrollments,
  onRefreshAll,
  onNotify,
  onShowReceipt,
}: ReceptionPageProps) {
  const [openSessions, setOpenSessions] = useState<WorkspaceSession[]>([]);
  const [closedSessions, setClosedSessions] = useState<WorkspaceSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Modals
  const [showCheckIn, setShowCheckIn] = useState(false);
  const [showDirectSale, setShowDirectSale] = useState(false);
  const [showExpense, setShowExpense] = useState(false);
  const [showStudentPay, setShowStudentPay] = useState(false);

  const [drinksSessionId, setDrinksSessionId] = useState<number | null>(null);
  const [checkoutSession, setCheckoutSession] = useState<WorkspaceSession | null>(
    null
  );

  // Check-in form state
  const [checkInName, setCheckInName] = useState('');
  const [checkInPhone, setCheckInPhone] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(
    null
  );
  const [customersLoading, setCustomersLoading] = useState(false);
  const [checkInNotes, setCheckInNotes] = useState('');
  const [checkInBusy, setCheckInBusy] = useState(false);
  const [checkInError, setCheckInError] = useState<string | null>(null);

  // Checkout modal state
  const [checkoutEndedAt, setCheckoutEndedAt] = useState<string>('');
  const [checkoutPaymentMethod, setCheckoutPaymentMethod] =
    useState<PaymentMethod>('cash');
  const [checkoutIdempotencyKey, setCheckoutIdempotencyKey] = useState<string>(
    ''
  );
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  // Add drink busy state
  const [drinkActionBusy, setDrinkActionBusy] = useState(false);

  const activeDrinks = useMemo(() => drinks.filter((d) => d.isActive), [drinks]);

  async function loadSessions() {
    try {
      const [openList, closedList] = await Promise.all([
        api.listSessions('open', 100),
        api.listSessions('closed', 15),
      ]);
      setOpenSessions(openList);
      setClosedSessions(closedList);
    } catch (err) {
      onNotify(
        'error',
        err instanceof Error ? err.message : 'تعذر تحميل الجلسات.'
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSessions();
  }, []);

  useEffect(() => {
    if (!showCheckIn) return;
    setCustomersLoading(true);
    api
      .listCustomers('', 300)
      .then(setCustomers)
      .catch((err) =>
        setCheckInError(
          err instanceof Error ? err.message : 'تعذر تحميل قائمة العملاء.'
        )
      )
      .finally(() => setCustomersLoading(false));
  }, [showCheckIn]);

  // Tick every second for accurate live timer & running session total
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const drinksSession = useMemo(
    () => openSessions.find((s) => s.id === drinksSessionId) || null,
    [openSessions, drinksSessionId]
  );

  async function handleStartSession(e: React.FormEvent) {
    e.preventDefault();
    setCheckInError(null);
    if (!checkInName.trim() || !checkInPhone.trim()) {
      setCheckInError('يرجى إدخال اسم العميل ورقم الهاتف.');
      return;
    }
    setCheckInBusy(true);
    try {
      const created = await api.startSession({
        customerId: selectedCustomerId,
        clientName: checkInName.trim(),
        customerPhone: checkInPhone.trim(),
        notes: checkInNotes.trim() || null,
      });
      setOpenSessions((prev) => [...prev, created]);
      setCheckInName('');
      setCheckInPhone('');
      setSelectedCustomerId(null);
      setCheckInNotes('');
      setShowCheckIn(false);
      onNotify(
        'success',
        `تم فتح جلسة #${created.sessionNumber}${created.clientName ? ` للعميل ${created.clientName}` : ''}`
      );
    } catch (err) {
      setCheckInError(
        err instanceof Error ? err.message : 'تعذر فتح الجلسة.'
      );
    } finally {
      setCheckInBusy(false);
    }
  }

  const matchingCustomers = useMemo(() => {
    const query = checkInName.trim().toLowerCase();
    if (!query) return [];
    return customers
      .filter((customer) => customer.name.toLowerCase().includes(query))
      .slice(0, 8);
  }, [customers, checkInName]);

  const selectedCustomer = useMemo(
    () => customers.find((customer) => customer.id === selectedCustomerId) || null,
    [customers, selectedCustomerId]
  );

  function selectCustomer(customer: Customer) {
    setSelectedCustomerId(customer.id);
    setCheckInName(customer.name);
    setCheckInPhone(customer.phone);
    setCheckInError(null);
  }

  function clearSelectedCustomer() {
    setSelectedCustomerId(null);
    setCheckInName('');
    setCheckInPhone('');
  }

  function openCheckInModal() {
    setCheckInError(null);
    setSelectedCustomerId(null);
    setCheckInName('');
    setCheckInPhone('');
    setCheckInNotes('');
    setShowCheckIn(true);
  }

  async function handleAddDrink(sessionId: number, drinkId: number) {
    setDrinkActionBusy(true);
    try {
      const updated = await api.addSessionDrink(sessionId, {
        drinkId,
        quantity: 1,
      });
      setOpenSessions((prev) =>
        prev.map((s) => (s.id === updated.id ? updated : s))
      );
      onNotify('success', 'تم إضافة المشروب إلى حساب الجلسة.');
    } catch (err) {
      onNotify(
        'error',
        err instanceof Error ? err.message : 'تعذر إضافة المشروب.'
      );
    } finally {
      setDrinkActionBusy(false);
    }
  }

  async function handleUpdateDrinkQty(
    sessionId: number,
    itemId: number,
    quantity: number
  ) {
    setDrinkActionBusy(true);
    try {
      const updated = await api.updateSessionDrinkQty(
        sessionId,
        itemId,
        quantity
      );
      setOpenSessions((prev) =>
        prev.map((s) => (s.id === updated.id ? updated : s))
      );
    } catch (err) {
      onNotify(
        'error',
        err instanceof Error ? err.message : 'تعذر تعديل الكمية.'
      );
    } finally {
      setDrinkActionBusy(false);
    }
  }

  function openCheckoutModal(session: WorkspaceSession) {
    setCheckoutSession(session);
    setCheckoutEndedAt(new Date().toISOString());
    setCheckoutPaymentMethod('cash');
    setCheckoutIdempotencyKey(generateIdempotencyKey(`checkout-${session.id}`));
    setCheckoutError(null);
  }

  const checkoutPreview = useMemo(() => {
    if (!checkoutSession || !checkoutEndedAt) return null;
    const durationMinutes = calculateDurationMinutes(
      checkoutSession.startedAt,
      checkoutEndedAt
    );
    const sessionCostPiasters = calculateSessionCostPiasters(
      durationMinutes,
      checkoutSession.hourlyRatePiasters
    );
    const drinksTotalPiasters = checkoutSession.drinksTotalPiasters;
    const totalPiasters = sessionCostPiasters + drinksTotalPiasters;
    return {
      durationMinutes,
      sessionCostPiasters,
      drinksTotalPiasters,
      totalPiasters,
    };
  }, [checkoutSession, checkoutEndedAt]);

  async function handleConfirmCheckout() {
    if (!checkoutSession || checkoutBusy) return;
    setCheckoutError(null);
    setCheckoutBusy(true);
    try {
      const res = await api.checkoutSession(checkoutSession.id, {
        paymentMethod: checkoutPaymentMethod,
        idempotencyKey: checkoutIdempotencyKey,
        endedAt: checkoutEndedAt,
      });
      setCheckoutSession(null);
      await loadSessions();
      onNotify(
        'success',
        `تم إغلاق جلسة #${res.session.sessionNumber} وتحصيل ${formatEgp(res.session.totalPiasters ?? 0)}`
      );
      onShowReceipt(res.receipt);
    } catch (err) {
      setCheckoutError(
        err instanceof Error ? err.message : 'تعذر إتمام التحصيل وإغلاق الجلسة.'
      );
    } finally {
      setCheckoutBusy(false);
    }
  }

  function buildReceiptFromClosedSession(session: WorkspaceSession): ReceiptData {
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

  const totalOpenRunningPiasters = openSessions.reduce((acc, s) => {
    const mins = calculateDurationMinutes(
      s.startedAt,
      new Date(nowMs).toISOString()
    );
    const cost = calculateSessionCostPiasters(mins, s.hourlyRatePiasters);
    return acc + cost + s.drinksTotalPiasters;
  }, 0);

  return (
    <div className="space-y-6">
      {/* Quick Action Bar — Large Reception Buttons */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <button
          type="button"
          onClick={openCheckInModal}
          className="h-14 px-4 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-bold text-base flex items-center justify-center gap-2.5 transition-colors cursor-pointer whitespace-nowrap"
        >
          <UserPlus className="w-5 h-5 shrink-0" />
          <span>دخول عميل</span>
        </button>

        <button
          type="button"
          onClick={() => setShowDirectSale(true)}
          className="h-14 px-4 rounded-xl bg-white hover:bg-slate-50 text-slate-900 border border-slate-300 font-bold text-sm sm:text-base flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap"
        >
          <Coffee className="w-5 h-5 text-teal-700 shrink-0" />
          <span>بيع مشروب مباشر</span>
        </button>

        <button
          type="button"
          onClick={() => setShowStudentPay(true)}
          className="h-14 px-4 rounded-xl bg-white hover:bg-slate-50 text-slate-900 border border-slate-300 font-bold text-sm sm:text-base flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap"
        >
          <GraduationCap className="w-5 h-5 text-teal-700 shrink-0" />
          <span>تحصيل دفعة طالب</span>
        </button>

        <button
          type="button"
          onClick={() => setShowExpense(true)}
          className="h-14 px-4 rounded-xl bg-white hover:bg-red-50/40 text-slate-900 border border-slate-300 font-bold text-sm sm:text-base flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap"
        >
          <Receipt className="w-5 h-5 text-red-600 shrink-0" />
          <span>تسجيل مصروف</span>
        </button>
      </div>

      {/* Summary Strip */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-3 gap-4 divide-y sm:divide-y-0 sm:divide-x sm:divide-x-reverse divide-slate-200">
        <div className="pt-0">
          <div className="text-xs font-medium text-slate-500">
            الجلسات المفتوحة الآن
          </div>
          <div className="text-2xl font-extrabold text-slate-900 tabular-nums mt-1">
            {openSessions.length}
          </div>
        </div>
        <div className="pt-3 sm:pt-0 sm:pr-5">
          <div className="text-xs font-medium text-slate-500">
            حساب الجلسات المفتوحة حتى اللحظة (غير محصّل)
          </div>
          <div className="text-2xl font-extrabold text-amber-700 tabular-nums mt-1">
            {formatEgp(totalOpenRunningPiasters)}
          </div>
        </div>
        <div className="pt-3 sm:pt-0 sm:pr-5">
          <div className="text-xs font-medium text-slate-500">
            سعر الساعة الحالي للوركسبيس
          </div>
          <div className="text-2xl font-extrabold text-slate-900 tabular-nums mt-1">
            {formatEgp(settings.hourlyRatePiasters)}{' '}
            <span className="text-xs font-normal text-slate-500">/ ساعة</span>
          </div>
        </div>
      </div>

      {/* Active Open Sessions */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">
            الجلسات المفتوحة حاليًا
          </h2>
          <span className="text-xs text-slate-500">
            الأسعار والوقت محفوظان تلقائيًا في قاعدة البيانات
          </span>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-56 bg-white border border-slate-200 rounded-xl animate-pulse"
              />
            ))}
          </div>
        ) : openSessions.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-3">
            <Clock className="w-10 h-10 text-slate-300 mx-auto" />
            <h3 className="text-base font-bold text-slate-800">
              لا توجد جلسات مفتوحة الآن
            </h3>
            <p className="text-sm text-slate-500 max-w-md mx-auto">
              عند وصول أي عميل، اضغط «دخول عميل» لبدء حساب الوقت فورًا بالساعة والدقيقة وإضافة المشروبات لحسابه.
            </p>
            <button
              type="button"
              onClick={openCheckInModal}
              className="h-11 px-6 rounded-lg bg-teal-700 hover:bg-teal-800 text-white font-semibold text-sm cursor-pointer"
            >
              فتح أول جلسة الآن
            </button>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full min-w-[1100px] text-sm text-right">
              <thead className="bg-slate-50 text-xs text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4 font-semibold">العميل</th>
                  <th className="py-3 px-4 font-semibold">وقت الدخول</th>
                  <th className="py-3 px-4 font-semibold">المدة الحالية</th>
                  <th className="py-3 px-4 font-semibold">سعر الساعة</th>
                  <th className="py-3 px-4 font-semibold">حساب القعدة</th>
                  <th className="py-3 px-4 font-semibold">المشروبات</th>
                  <th className="py-3 px-4 font-semibold">الإجمالي</th>
                  <th className="py-3 px-4 font-semibold text-center">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {openSessions.map((session) => {
                  const elapsedMins = calculateDurationMinutes(
                    session.startedAt,
                    new Date(nowMs).toISOString()
                  );
                  const sessionCost = calculateSessionCostPiasters(
                    elapsedMins,
                    session.hourlyRatePiasters
                  );
                  const runningTotal = sessionCost + session.drinksTotalPiasters;
                  const drinkQuantity = session.drinks.reduce(
                    (total, drink) => total + drink.quantity,
                    0
                  );

                  return (
                    <tr key={session.id} className="hover:bg-slate-50/70 align-middle">
                      <td className="py-3 px-4 min-w-48">
                        <div className="font-bold text-slate-900">
                          {session.clientName || `جلسة #${session.sessionNumber}`}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                          <span className="font-mono font-semibold text-slate-700">
                            #{session.sessionNumber}
                          </span>
                          {session.customerPhone && (
                            <span dir="ltr">{session.customerPhone}</span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap text-slate-700">
                        {formatCairoTime(session.startedAt)}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="font-mono font-bold text-teal-800 tabular-nums">
                          {formatLiveTimer(session.startedAt, nowMs)}
                        </div>
                        <div className="text-xs text-slate-500">
                          {formatDurationArabic(elapsedMins)}
                        </div>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap tabular-nums text-slate-700">
                        {formatEgp(session.hourlyRatePiasters)}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap font-semibold tabular-nums text-slate-900">
                        {formatEgp(sessionCost)}
                      </td>
                      <td className="py-3 px-4 min-w-44">
                        <div className="font-semibold tabular-nums text-slate-900">
                          {formatEgp(session.drinksTotalPiasters)}
                          <span className="mr-1 text-xs font-normal text-slate-500">
                            ({drinkQuantity})
                          </span>
                        </div>
                        {session.drinks.length > 0 && (
                          <div className="mt-0.5 max-w-52 truncate text-xs text-slate-500">
                            {session.drinks
                              .map((drink) =>
                                `${drink.drinkNameSnapshot} ×${drink.quantity}`
                              )
                              .join(' · ')}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap font-extrabold text-base text-teal-800 tabular-nums">
                        {formatEgp(runningTotal)}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-center gap-2 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setDrinksSessionId(session.id)}
                            className="h-9 px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 font-semibold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            <Coffee className="w-4 h-4 text-teal-700" />
                            <span>إضافة مشروب</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => openCheckoutModal(session)}
                            className="h-9 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                            <span>إنهاء ومحاسبة</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Recently Closed Sessions */}
      {closedSessions.length > 0 && (
        <section className="space-y-3 pt-2">
          <h2 className="text-base font-bold text-slate-900">
            آخر الجلسات المغلقة والمحصّلة
          </h2>
          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm text-right">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                <tr>
                  <th className="py-3 px-4 font-semibold">الجلسة / العميل</th>
                  <th className="py-3 px-4 font-semibold">الدخول - الخروج</th>
                  <th className="py-3 px-4 font-semibold">المدة</th>
                  <th className="py-3 px-4 font-semibold">القعدة</th>
                  <th className="py-3 px-4 font-semibold">المشروبات</th>
                  <th className="py-3 px-4 font-semibold">الإجمالي</th>
                  <th className="py-3 px-4 font-semibold">الدفع</th>
                  <th className="py-3 px-4 font-semibold text-left">إيصال</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {closedSessions.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4 font-semibold text-slate-900 whitespace-nowrap">
                      #{s.sessionNumber}
                      {s.clientName ? ` — ${s.clientName}` : ''}
                    </td>
                    <td className="py-3 px-4 text-slate-600 tabular-nums whitespace-nowrap">
                      {formatCairoTime(s.startedAt)} ←{' '}
                      {s.endedAt ? formatCairoTime(s.endedAt) : '-'}
                    </td>
                    <td className="py-3 px-4 text-slate-700 whitespace-nowrap">
                      {formatDurationArabic(s.durationMinutes ?? 0)}
                    </td>
                    <td className="py-3 px-4 tabular-nums text-slate-700 whitespace-nowrap">
                      {formatEgp(s.sessionCostPiasters ?? 0)}
                    </td>
                    <td className="py-3 px-4 tabular-nums text-slate-700 whitespace-nowrap">
                      {formatEgp(s.drinksTotalPiasters)}
                    </td>
                    <td className="py-3 px-4 tabular-nums font-bold text-emerald-700 whitespace-nowrap">
                      {formatEgp(s.totalPiasters ?? 0)}
                    </td>
                    <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                      {s.paymentMethod
                        ? PAYMENT_METHOD_LABELS[s.paymentMethod]
                        : '-'}
                    </td>
                    <td className="py-3 px-4 text-left whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() =>
                          onShowReceipt(buildReceiptFromClosedSession(s))
                        }
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700 hover:text-teal-900 cursor-pointer"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span>الإيصال</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ==================== CHECK-IN MODAL ==================== */}
      {showCheckIn && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="w-full max-w-lg max-h-[92vh] bg-white rounded-xl border border-slate-200 overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">
                دخول عميل
              </h2>
              <button
                type="button"
                onClick={() => setShowCheckIn(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleStartSession} className="p-5 space-y-4">
              {checkInError && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">
                  <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
                  <span>{checkInError}</span>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  اسم العميل
                </label>
                <input
                  type="text"
                  autoFocus
                  value={checkInName}
                  onChange={(e) => {
                    setCheckInName(e.target.value);
                    setSelectedCustomerId(null);
                  }}
                  placeholder="ابحث بالاسم أو اكتب اسم عميل جديد"
                  className="w-full h-11 px-3.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                />

                {!selectedCustomerId && checkInName.trim() && (
                  <div className="mt-1.5 rounded-lg border border-slate-200 bg-white overflow-hidden shadow-lg">
                    <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                      <Search className="w-4 h-4" />
                      نتائج البحث في العملاء
                    </div>
                    {customersLoading ? (
                      <div className="p-3 text-sm text-slate-500">
                        جاري البحث...
                      </div>
                    ) : matchingCustomers.length > 0 ? (
                      <div className="max-h-44 overflow-y-auto divide-y divide-slate-100">
                        {matchingCustomers.map((customer) => (
                          <button
                            key={customer.id}
                            type="button"
                            onClick={() => selectCustomer(customer)}
                            className="w-full px-3 py-2.5 flex items-center justify-between gap-3 hover:bg-teal-50 text-right cursor-pointer"
                          >
                            <div className="min-w-0">
                              <div className="font-semibold text-sm text-slate-900 truncate">
                                {customer.name}
                              </div>
                              <div className="text-xs text-slate-500" dir="ltr">
                                {customer.phone}
                              </div>
                            </div>
                            <span className="shrink-0 text-xs text-slate-500">
                              {customer.visitCount} زيارة
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="p-3 text-sm text-slate-500">
                        لا يوجد اسم مطابق؛ أكمل رقم الهاتف لحفظ عميل جديد.
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  رقم الهاتف
                </label>
                <div className="relative">
                  <Phone className="absolute right-3.5 top-3.5 w-4 h-4 text-slate-400" />
                  <input
                    type="tel"
                    dir="ltr"
                    required
                    value={checkInPhone}
                    onChange={(e) => {
                      setCheckInPhone(e.target.value);
                      setSelectedCustomerId(null);
                    }}
                    placeholder="01xxxxxxxxx"
                    className="w-full h-11 pr-10 pl-3.5 rounded-lg border border-slate-300 text-sm text-left focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>
              </div>

              {selectedCustomer && (
                <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-teal-200 bg-teal-50 text-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    <UserCheck className="w-5 h-5 text-teal-700 shrink-0" />
                    <div className="min-w-0">
                      <div className="font-bold text-teal-950 truncate">
                        عميل مسجل · {selectedCustomer.visitCount} زيارة سابقة
                      </div>
                      <div className="text-xs text-teal-800 truncate" dir="ltr">
                        {selectedCustomer.phone}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={clearSelectedCustomer}
                    className="text-xs font-bold text-teal-800 hover:text-teal-950 cursor-pointer"
                  >
                    تغيير
                  </button>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  ملاحظة (اختياري)
                </label>
                <input
                  type="text"
                  value={checkInNotes}
                  onChange={(e) => setCheckInNotes(e.target.value)}
                  placeholder="مثال: طاولة الشباك / غرفة هادئة"
                  className="w-full h-11 px-3.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>

              <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600 flex items-center justify-between">
                <span>سعر الساعة الذي سيُحفظ للجلسة:</span>
                <span className="font-bold text-slate-900 tabular-nums text-sm">
                  {formatEgp(settings.hourlyRatePiasters)} / ساعة
                </span>
              </div>

              <div className="flex items-center gap-3 pt-1">
                <button
                  type="submit"
                  disabled={checkInBusy}
                  className="flex-1 h-12 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white font-bold text-base cursor-pointer"
                >
                  {checkInBusy ? 'جاري الفتح...' : 'بدء الجلسة الآن'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowCheckIn(false)}
                  className="h-12 px-5 rounded-lg border border-slate-300 bg-white text-slate-700 text-sm font-medium cursor-pointer"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== SESSION DRINKS MODAL ==================== */}
      {drinksSession && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-xl bg-white rounded-xl border border-slate-200 overflow-hidden my-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  مشروبات {drinksSession.clientName || `جلسة #${drinksSession.sessionNumber}`}
                </h2>
                <p className="text-xs text-slate-500">
                  جلسة #{drinksSession.sessionNumber} · يمكنك إضافة أصناف متعددة وتعديل الكميات قبل المحاسبة
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDrinksSessionId(null)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-5">
              {/* Available Menu Grid */}
              <div>
                <div className="text-sm font-bold text-slate-800 mb-2.5">
                  اضغط لإضافة مشروب
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {activeDrinks.map((drink) => (
                    <button
                      key={drink.id}
                      type="button"
                      disabled={drinkActionBusy}
                      onClick={() => handleAddDrink(drinksSession.id, drink.id)}
                      className="p-3 rounded-lg border border-slate-200 hover:border-teal-600 hover:bg-teal-50/40 text-right transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <div className="font-bold text-sm text-slate-900 truncate">
                        {drink.name}
                      </div>
                      <div className="text-xs text-teal-800 font-semibold tabular-nums mt-1">
                        + {formatEgp(drink.pricePiasters)}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Current Session Drinks */}
              <div className="border-t border-slate-200 pt-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-800">
                    المشروبات المضافة للجلسة
                  </span>
                  <span className="text-sm font-extrabold text-teal-800 tabular-nums">
                    الإجمالي: {formatEgp(drinksSession.drinksTotalPiasters)}
                  </span>
                </div>

                {drinksSession.drinks.length === 0 ? (
                  <p className="text-sm text-slate-500 py-3 text-center bg-slate-50 rounded-lg border border-slate-200">
                    لم تُضف مشروبات لهذه الجلسة بعد.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                    {drinksSession.drinks.map((item) => (
                      <div
                        key={item.id}
                        className="p-3 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-sm text-slate-900">
                            {item.drinkNameSnapshot}
                          </div>
                          <div className="text-xs text-slate-500 tabular-nums">
                            {formatEgp(item.unitPricePiasters)} للواحد · المجموع:{' '}
                            <span className="font-semibold text-slate-800">
                              {formatEgp(item.lineTotalPiasters)}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            disabled={drinkActionBusy}
                            onClick={() =>
                              handleUpdateDrinkQty(
                                drinksSession.id,
                                item.id,
                                item.quantity - 1
                              )
                            }
                            className="w-8 h-8 rounded-md border border-slate-300 bg-white hover:bg-slate-100 flex items-center justify-center cursor-pointer"
                            title={item.quantity === 1 ? 'حذف' : 'تقليل'}
                          >
                            {item.quantity === 1 ? (
                              <Trash2 className="w-3.5 h-3.5 text-red-600" />
                            ) : (
                              <Minus className="w-4 h-4" />
                            )}
                          </button>
                          <span className="w-7 text-center font-bold text-sm tabular-nums">
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            disabled={drinkActionBusy}
                            onClick={() =>
                              handleUpdateDrinkQty(
                                drinksSession.id,
                                item.id,
                                item.quantity + 1
                              )
                            }
                            className="w-8 h-8 rounded-md bg-teal-700 hover:bg-teal-800 text-white flex items-center justify-center cursor-pointer"
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setDrinksSessionId(null)}
                  className="h-11 px-6 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm cursor-pointer"
                >
                  تم
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== CHECKOUT MODAL ==================== */}
      {checkoutSession && checkoutPreview && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-lg bg-white rounded-xl border border-slate-200 overflow-hidden my-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  إنهاء ومحاسبة جلسة #{checkoutSession.sessionNumber}
                </h2>
                <p className="text-xs text-slate-500">
                  {checkoutSession.clientName || 'زائر عابر'} · يُفصل دخل القعدة عن دخل المشروبات تلقائيًا في التقارير
                </p>
              </div>
              <button
                type="button"
                disabled={checkoutBusy}
                onClick={() => setCheckoutSession(null)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {checkoutError && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">
                  <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
                  <span>{checkoutError}</span>
                </div>
              )}

              {/* Time & Duration Breakdown */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-600">وقت الدخول</span>
                  <span className="font-semibold text-slate-900 tabular-nums">
                    {formatCairoTime(checkoutSession.startedAt)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">وقت الخروج</span>
                  <span className="font-semibold text-slate-900 tabular-nums">
                    {formatCairoTime(checkoutEndedAt)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">مدة القعدة</span>
                  <span className="font-bold text-slate-900">
                    {formatDurationArabic(checkoutPreview.durationMinutes)} (
                    {checkoutPreview.durationMinutes} دقيقة)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">
                    سعر الساعة المحفوظ عند البدء
                  </span>
                  <span className="tabular-nums text-slate-800">
                    {formatEgp(checkoutSession.hourlyRatePiasters)}
                  </span>
                </div>

                <div className="pt-2 border-t border-slate-200 flex justify-between font-bold text-slate-900">
                  <span>تكلفة القعدة</span>
                  <span className="tabular-nums">
                    {formatEgp(checkoutPreview.sessionCostPiasters)}
                  </span>
                </div>

                {checkoutSession.drinks.length > 0 && (
                  <div className="pt-2 border-t border-slate-200 space-y-1">
                    <div className="text-xs font-semibold text-slate-500">
                      المشروبات
                    </div>
                    {checkoutSession.drinks.map((d) => (
                      <div
                        key={d.id}
                        className="flex justify-between text-xs text-slate-700"
                      >
                        <span>
                          {d.drinkNameSnapshot} × {d.quantity}
                        </span>
                        <span className="tabular-nums">
                          {formatEgp(d.lineTotalPiasters)}
                        </span>
                      </div>
                    ))}
                    <div className="flex justify-between font-bold text-slate-900 pt-1">
                      <span>إجمالي المشروبات</span>
                      <span className="tabular-nums">
                        {formatEgp(checkoutPreview.drinksTotalPiasters)}
                      </span>
                    </div>
                  </div>
                )}

                <div className="pt-3 border-t border-slate-300 flex items-center justify-between text-lg font-extrabold text-teal-800">
                  <span>الإجمالي المطلوب تحصيله</span>
                  <span className="tabular-nums">
                    {formatEgp(checkoutPreview.totalPiasters)}
                  </span>
                </div>
              </div>

              {/* Payment Method */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  وسيلة التحصيل
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {PAYMENT_METHODS.map((method) => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setCheckoutPaymentMethod(method)}
                      className={`h-11 px-2 rounded-lg text-sm font-semibold border transition-colors cursor-pointer whitespace-nowrap ${
                        checkoutPaymentMethod === method
                          ? 'bg-teal-700 text-white border-teal-700'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      {PAYMENT_METHOD_LABELS[method]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Confirm CTA */}
              <div className="flex items-center gap-3 pt-1">
                <button
                  type="button"
                  disabled={checkoutBusy}
                  onClick={handleConfirmCheckout}
                  className="flex-1 h-12 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-base transition-colors cursor-pointer"
                >
                  {checkoutBusy
                    ? 'جاري تأكيد التحصيل...'
                    : `تأكيد التحصيل (${formatEgp(checkoutPreview.totalPiasters)})`}
                </button>
                <button
                  type="button"
                  disabled={checkoutBusy}
                  onClick={() => setCheckoutSession(null)}
                  className="h-12 px-5 rounded-lg border border-slate-300 bg-white text-slate-700 text-sm font-medium cursor-pointer"
                >
                  رجوع
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== QUICK OPERATIONAL MODALS ==================== */}
      {showDirectSale && (
        <DirectDrinkSaleModal
          drinks={drinks}
          onClose={() => setShowDirectSale(false)}
          onSuccess={(receipt, msg) => {
            setShowDirectSale(false);
            onNotify('success', msg);
            onShowReceipt(receipt);
          }}
        />
      )}

      {showExpense && (
        <ExpenseModal
          categories={categories}
          onClose={() => setShowExpense(false)}
          onSuccess={(msg) => {
            setShowExpense(false);
            onNotify('success', msg);
          }}
        />
      )}

      {showStudentPay && (
        <StudentPaymentModal
          enrollments={enrollments}
          onClose={() => setShowStudentPay(false)}
          onSuccess={async (receipt, msg) => {
            setShowStudentPay(false);
            await onRefreshAll();
            onNotify('success', msg);
            onShowReceipt(receipt);
          }}
        />
      )}
    </div>
  );
}
