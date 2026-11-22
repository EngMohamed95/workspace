import React, { useEffect, useState } from 'react';
import {
  ChevronRight,
  ChevronLeft,
  TrendingUp,
  TrendingDown,
  Lock,
  Banknote,
  GraduationCap,
  Landmark,
  X,
  Eye,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import type {
  AuthUser,
  LedgerEntry,
  MonthlyProfitReport,
  PaymentMethod,
} from '../shared/types.ts';
import {
  formatCairoDateArabic,
  formatCairoMonthArabic,
  formatCairoTime,
  formatEgp,
  getCurrentCairoMonth,
  LEDGER_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  shiftCairoMonth,
} from '../shared/format.ts';

interface ReportsPageProps {
  user: AuthUser;
  onNotify: (type: 'success' | 'error', message: string) => void;
}

export function ReportsPage({ user, onNotify }: ReportsPageProps) {
  const isAdmin = user.role === 'admin';
  const [month, setMonth] = useState(getCurrentCairoMonth);
  const [report, setReport] = useState<MonthlyProfitReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [drilldown, setDrilldown] = useState<{
    title: string;
    entries: LedgerEntry[];
  } | null>(null);
  const [showStudentsDue, setShowStudentsDue] = useState(false);

  async function loadReport(targetMonth: string) {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await api.getMonthlyReport(targetMonth);
      setReport(data);
    } catch (err) {
      onNotify(
        'error',
        err instanceof Error ? err.message : 'تعذر تحميل التقرير الشهري.'
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReport(month);
  }, [month, isAdmin]);

  if (!isAdmin) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-3">
        <Lock className="w-10 h-10 text-slate-400 mx-auto" />
        <h2 className="text-lg font-bold text-slate-900">
          التقارير والأرباح متاحة للمدير فقط
        </h2>
        <p className="text-sm text-slate-500 max-w-md mx-auto">
          حسابك الحالي بصلاحية «موظف استقبال». للاطلاع على تقرير صافي ربح الشهر، يرجى الدخول بحساب المدير.
        </p>
      </div>
    );
  }

  const isLoss = report ? report.netProfitPiasters < 0 : false;

  return (
    <div className="space-y-6">
      {/* Month Picker Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">
            تقرير الأداء الشهري (بتوقيت القاهرة)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            يُحتسب الإيراد والمصروف بتاريخ التحصيل أو الدفع الفعلي فقط. الجلسات المفتوحة غير مشمولة.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMonth((m) => shiftCairoMonth(m, -1))}
            className="h-10 w-10 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 flex items-center justify-center cursor-pointer"
            title="الشهر السابق"
          >
            <ChevronRight className="w-5 h-5" />
          </button>

          <input
            type="month"
            value={month}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
            className="h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
          />

          <button
            type="button"
            onClick={() => setMonth((m) => shiftCairoMonth(m, 1))}
            className="h-10 w-10 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 flex items-center justify-center cursor-pointer"
            title="الشهر التالي"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>

          {month !== getCurrentCairoMonth() && (
            <button
              type="button"
              onClick={() => setMonth(getCurrentCairoMonth())}
              className="h-10 px-3 rounded-lg bg-slate-900 text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
            >
              الشهر الحالي
            </button>
          )}
        </div>
      </div>

      {loading || !report ? (
        <div className="h-64 bg-white border border-slate-200 rounded-xl animate-pulse" />
      ) : (
        <>
          {/* HERO: Monthly Net Profit / Loss on Cash Basis */}
          <div
            className={`rounded-xl border p-6 sm:p-8 ${
              isLoss
                ? 'bg-red-50/70 border-red-200'
                : 'bg-white border-slate-200'
            }`}
          >
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-sm font-bold text-slate-600">
                  {isLoss ? (
                    <TrendingDown className="w-5 h-5 text-red-600" />
                  ) : (
                    <TrendingUp className="w-5 h-5 text-emerald-600" />
                  )}
                  <span>
                    {isLoss
                      ? 'خسارة الشهر – على أساس نقدي'
                      : 'صافي ربح الشهر – على أساس نقدي'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="text-slate-900">
                    {formatCairoMonthArabic(report.month)}
                  </span>
                </div>

                <div
                  className={`text-4xl sm:text-5xl font-extrabold tabular-nums tracking-tight ${
                    isLoss ? 'text-red-700' : 'text-emerald-700'
                  }`}
                >
                  {isLoss
                    ? formatEgp(Math.abs(report.netProfitPiasters))
                    : formatEgp(report.netProfitPiasters)}
                </div>

                {isLoss && (
                  <p className="text-sm font-semibold text-red-700">
                    تنبيه: مصروفات التشغيل والمبالغ المستردة تجاوزت إجمالي التحصيلات بمقدار{' '}
                    {formatEgp(Math.abs(report.netProfitPiasters))}.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 border-t md:border-t-0 md:border-r border-slate-200 pt-4 md:pt-0 md:pr-6 text-sm">
                <div>
                  <div className="text-xs text-slate-500">إجمالي التحصيلات</div>
                  <div className="text-lg font-extrabold text-slate-900 tabular-nums mt-0.5">
                    {formatEgp(report.totalGrossCollectionsPiasters)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">المبالغ المستردة</div>
                  <div className="text-lg font-extrabold text-amber-700 tabular-nums mt-0.5">
                    {formatEgp(report.refundsPiasters)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">مصروفات التشغيل</div>
                  <div className="text-lg font-extrabold text-red-700 tabular-nums mt-0.5">
                    {formatEgp(report.operatingExpensesPiasters)}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Interactive Line-Item Breakdown Table */}
          <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  تفصيل بنود صافي الربح النقدي
                </h3>
                <p className="text-xs text-slate-500">
                  اضغط على أي بند لعرض جميع الحركات المالية التي كوّنته.
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm text-right">
                <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                  <tr>
                    <th className="py-3 px-5 font-semibold">البند</th>
                    <th className="py-3 px-4 font-semibold">عدد الحركات</th>
                    <th className="py-3 px-4 font-semibold">الأثر</th>
                    <th className="py-3 px-5 font-semibold text-left">
                      القيمة (ج.م)
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {report.lines.map((line) => (
                    <tr
                      key={line.key}
                      onClick={() =>
                        setDrilldown({
                          title: `${line.label} — ${formatCairoMonthArabic(report.month)}`,
                          entries: line.entries,
                        })
                      }
                      className="hover:bg-teal-50/40 transition-colors cursor-pointer"
                    >
                      <td className="py-3.5 px-5 font-semibold text-slate-900 flex items-center gap-2">
                        <span>{line.label}</span>
                        <Eye className="w-3.5 h-3.5 text-slate-400" />
                      </td>
                      <td className="py-3.5 px-4 tabular-nums text-slate-600">
                        {line.count} حركة
                      </td>
                      <td className="py-3.5 px-4 text-xs font-semibold">
                        {line.sign === 1 ? (
                          <span className="text-emerald-700">إضافة (+)</span>
                        ) : (
                          <span className="text-red-700">خصم (−)</span>
                        )}
                      </td>
                      <td
                        className={`py-3.5 px-5 font-extrabold tabular-nums text-left ${
                          line.sign === 1 ? 'text-emerald-700' : 'text-red-700'
                        }`}
                      >
                        {line.sign === 1 ? '+' : '-'}
                        {formatEgp(line.amountPiasters)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                  <tr>
                    <td
                      colSpan={3}
                      className="py-4 px-5 text-base font-extrabold text-slate-900"
                    >
                      {isLoss
                        ? 'خسارة الشهر – على أساس نقدي'
                        : 'صافي ربح الشهر – على أساس نقدي'}
                    </td>
                    <td
                      className={`py-4 px-5 text-lg font-extrabold tabular-nums text-left ${
                        isLoss ? 'text-red-700' : 'text-emerald-700'
                      }`}
                    >
                      {formatEgp(report.netProfitPiasters)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          {/* Independent Non-Profit Indicators: Cash Drawer, Student Receivables, Owner Equity */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* 1. Cash Balance (Strictly Cash-Only) */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Banknote className="w-4 h-4 text-teal-700" />
                  <span>رصيد الكاش (نقدي فقط)</span>
                </h3>
              </div>
              <div>
                <div className="text-xs text-slate-500">
                  الرصيد التراكمي لدرج الكاش حتى نهاية الشهر
                </div>
                <div className="text-2xl font-extrabold text-slate-900 tabular-nums mt-0.5">
                  {formatEgp(report.cumulativeCashBalancePiasters)}
                </div>
              </div>
              <div className="pt-3 border-t border-slate-100 space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">كاش داخل خلال الشهر:</span>
                  <span className="font-semibold text-emerald-700 tabular-nums">
                    +{formatEgp(report.monthlyCashInPiasters)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">كاش خارج خلال الشهر:</span>
                  <span className="font-semibold text-red-700 tabular-nums">
                    -{formatEgp(report.monthlyCashOutPiasters)}
                  </span>
                </div>
                <div className="flex justify-between pt-1 font-bold text-slate-800">
                  <span>صافي حركة الكاش بالشهر:</span>
                  <span className="tabular-nums">
                    {formatEgp(report.monthlyNetCashPiasters, true)}
                  </span>
                </div>
              </div>
            </div>

            {/* 2. Student Receivables (Independent of Profit) */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-3">
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <GraduationCap className="w-4 h-4 text-amber-600" />
                  <span>المتبقي على طلاب الكورسات</span>
                </h3>
                <div>
                  <div className="text-xs text-slate-500">
                    مبالغ مستحقة لم تُحصّل بعد (مستقلة عن صافي الربح)
                  </div>
                  <div className="text-2xl font-extrabold text-amber-700 tabular-nums mt-0.5">
                    {formatEgp(report.studentReceivablesPiasters)}
                  </div>
                </div>
                <div className="text-xs text-slate-600">
                  عدد الطلاب المتبقي عليهم أقساط:{' '}
                  <span className="font-bold text-slate-900 tabular-nums">
                    {report.studentsWithBalance.length}
                  </span>{' '}
                  طالب
                </div>
              </div>
              {report.studentsWithBalance.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowStudentsDue(true)}
                  className="h-9 px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 cursor-pointer"
                >
                  عرض قائمة الطلاب المتبقي عليهم مبالغ
                </button>
              )}
            </div>

            {/* 3. Owner Equity Movements (Strictly Separated from Operating Profit) */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-3">
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Landmark className="w-4 h-4 text-indigo-700" />
                  <span>حركات صاحب المكان (خارج الربح)</span>
                </h3>
                <p className="text-xs text-slate-500">
                  مفصولة تمامًا عن إيرادات ومصروفات التشغيل لضمان دقة صافي الربح.
                </p>
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-600">إيداع صاحب المكان:</span>
                    <span className="font-bold text-indigo-700 tabular-nums">
                      +{formatEgp(report.ownerDepositsPiasters)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">سحب شخصي:</span>
                    <span className="font-bold text-slate-800 tabular-nums">
                      -{formatEgp(report.ownerWithdrawalsPiasters)}
                    </span>
                  </div>
                </div>
              </div>
              {report.ownerEntries.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    setDrilldown({
                      title: `حركات صاحب المكان — ${formatCairoMonthArabic(report.month)}`,
                      entries: report.ownerEntries,
                    })
                  }
                  className="h-9 px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 cursor-pointer"
                >
                  عرض التفاصيل ({report.ownerEntries.length})
                </button>
              )}
            </div>
          </div>

          {/* Expenses by Category & Collections by Payment Method */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
              <h3 className="text-sm font-bold text-slate-900">
                توزيع مصروفات التشغيل حسب التصنيف
              </h3>
              {report.expensesByCategory.length === 0 ? (
                <p className="text-xs text-slate-500 py-4 text-center">
                  لا توجد مصروفات مسجلة في هذا الشهر.
                </p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {report.expensesByCategory.map((cat) => (
                    <button
                      key={cat.categoryName}
                      type="button"
                      onClick={() =>
                        setDrilldown({
                          title: `مصروفات ${cat.categoryName} — ${formatCairoMonthArabic(report.month)}`,
                          entries: cat.entries,
                        })
                      }
                      className="w-full py-2.5 flex items-center justify-between text-sm hover:bg-slate-50 px-2 rounded cursor-pointer"
                    >
                      <span className="font-medium text-slate-800">
                        {cat.categoryName}{' '}
                        <span className="text-xs text-slate-400">
                          ({cat.count})
                        </span>
                      </span>
                      <span className="font-bold text-red-700 tabular-nums">
                        {formatEgp(cat.amountPiasters)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
              <h3 className="text-sm font-bold text-slate-900">
                التحصيلات التشغيلية حسب وسيلة الدفع
              </h3>
              <div className="divide-y divide-slate-100">
                {(
                  ['cash', 'instapay', 'e_wallet', 'card'] as PaymentMethod[]
                ).map((method) => (
                  <div
                    key={method}
                    className="py-2.5 flex items-center justify-between text-sm"
                  >
                    <span className="text-slate-700 font-medium">
                      {PAYMENT_METHOD_LABELS[method]}
                    </span>
                    <span className="font-bold text-slate-900 tabular-nums">
                      {formatEgp(report.collectionsByMethod[method] || 0)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Drill-down Modal */}
      {drilldown && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-3xl bg-white rounded-xl border border-slate-200 overflow-hidden my-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <h3 className="text-base font-bold text-slate-900">
                {drilldown.title}
              </h3>
              <button
                type="button"
                onClick={() => setDrilldown(null)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto">
              {drilldown.entries.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">
                  لا توجد حركات مسجلة في هذا البند خلال هذا الشهر.
                </div>
              ) : (
                <table className="w-full text-xs text-right">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 sticky top-0">
                    <tr>
                      <th className="py-3 px-4 font-semibold">التاريخ</th>
                      <th className="py-3 px-4 font-semibold">النوع</th>
                      <th className="py-3 px-4 font-semibold">البيان</th>
                      <th className="py-3 px-4 font-semibold">الوسيلة</th>
                      <th className="py-3 px-4 font-semibold">بواسطة</th>
                      <th className="py-3 px-4 font-semibold text-left">
                        المبلغ
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {drilldown.entries.map((e) => (
                      <tr key={e.id}>
                        <td className="py-3 px-4 tabular-nums whitespace-nowrap text-slate-600">
                          {formatCairoDateArabic(e.cairoDate)} ·{' '}
                          {formatCairoTime(e.occurredAt)}
                        </td>
                        <td className="py-3 px-4 font-medium text-slate-700 whitespace-nowrap">
                          {LEDGER_TYPE_LABELS[e.entryType]}
                          {e.categoryName ? ` (${e.categoryName})` : ''}
                        </td>
                        <td className="py-3 px-4 text-slate-900">
                          {e.description}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap text-slate-600">
                          {PAYMENT_METHOD_LABELS[e.paymentMethod]}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap text-slate-600">
                          {e.createdByName}
                        </td>
                        <td className="py-3 px-4 font-bold tabular-nums text-left whitespace-nowrap text-slate-900">
                          {formatEgp(e.amountPiasters)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Students With Remaining Balance Modal */}
      {showStudentsDue && report && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-2xl bg-white rounded-xl border border-slate-200 overflow-hidden my-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <h3 className="text-base font-bold text-slate-900">
                الطلاب المتبقي عليهم مبالغ في الكورسات
              </h3>
              <button
                type="button"
                onClick={() => setShowStudentsDue(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto">
              <table className="w-full text-xs text-right">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-3 px-4 font-semibold">الطالب</th>
                    <th className="py-3 px-4 font-semibold">الكورس والمجموعة</th>
                    <th className="py-3 px-4 font-semibold">المطلوب</th>
                    <th className="py-3 px-4 font-semibold">المدفوع</th>
                    <th className="py-3 px-4 font-semibold text-left">المتبقي</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {report.studentsWithBalance.map((s) => (
                    <tr key={s.enrollmentId}>
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900">
                          {s.studentName}
                        </div>
                        <div className="font-mono text-slate-500" dir="ltr">
                          {s.studentPhone}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-700">
                        {s.courseName} — {s.groupName}
                      </td>
                      <td className="py-3 px-4 tabular-nums">
                        {formatEgp(s.agreedPricePiasters)}
                      </td>
                      <td className="py-3 px-4 tabular-nums text-emerald-700">
                        {formatEgp(s.paidPiasters)}
                      </td>
                      <td className="py-3 px-4 tabular-nums font-extrabold text-amber-700 text-left">
                        {formatEgp(s.remainingPiasters)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
