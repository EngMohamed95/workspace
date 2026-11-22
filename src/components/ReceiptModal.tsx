import React from 'react';
import { Printer, X, CheckCircle2 } from 'lucide-react';
import type { ReceiptData, WorkspaceSettings } from '../shared/types.ts';
import {
  formatCairoDateTime,
  formatCairoTime,
  formatDurationArabic,
  formatEgp,
  PAYMENT_METHOD_LABELS,
} from '../shared/format.ts';

interface ReceiptModalProps {
  receipt: ReceiptData | null;
  settings: WorkspaceSettings;
  onClose: () => void;
}

export function ReceiptModal({ receipt, settings, onClose }: ReceiptModalProps) {
  if (!receipt) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-md bg-white rounded-xl border border-slate-200 overflow-hidden my-auto">
        <div className="no-print flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2 text-emerald-700 font-semibold text-sm">
            <CheckCircle2 className="w-5 h-5" />
            <span>تم التحصيل بنجاح — إيصال جاهز للطباعة</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-200/70 hover:text-slate-900 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Printable Receipt Body */}
        <div id="printable-receipt" className="p-6 text-slate-900 text-sm">
          <div className="text-center pb-4 border-b border-dashed border-slate-300">
            <h2 className="text-xl font-extrabold tracking-tight">
              {settings.workspaceName}
            </h2>
            {settings.address && (
              <p className="text-xs text-slate-600 mt-1">{settings.address}</p>
            )}
            {settings.phone && (
              <p className="text-xs text-slate-600 font-mono mt-0.5" dir="ltr">
                {settings.phone}
              </p>
            )}
            <p className="text-sm font-bold mt-3 text-slate-900">
              إيصال تحصيل — {receipt.referenceNumber}
            </p>
          </div>

          <div className="py-3.5 space-y-1.5 border-b border-dashed border-slate-300 text-xs">
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">العميل / الطالب:</span>
              <span className="font-semibold text-slate-900 text-left">
                {receipt.customerLabel}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">التاريخ والوقت:</span>
              <span className="tabular-nums text-slate-900">
                {formatCairoDateTime(receipt.dateTimeIso)}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">وسيلة الدفع:</span>
              <span className="font-medium text-slate-900">
                {PAYMENT_METHOD_LABELS[receipt.paymentMethod]}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">المسؤول:</span>
              <span className="text-slate-900">{receipt.cashierName}</span>
            </div>
          </div>

          {/* Session Details */}
          {receipt.kind === 'session' && (
            <div className="py-3.5 space-y-2 border-b border-dashed border-slate-300">
              <div className="text-xs font-bold text-slate-700">
                تفاصيل الجلسة
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-600">وقت الدخول:</span>
                <span className="tabular-nums font-medium">
                  {receipt.startedAt ? formatCairoTime(receipt.startedAt) : '-'}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-600">وقت الخروج:</span>
                <span className="tabular-nums font-medium">
                  {receipt.endedAt ? formatCairoTime(receipt.endedAt) : '-'}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-600">مدة القعدة:</span>
                <span className="font-medium">
                  {formatDurationArabic(receipt.durationMinutes ?? 0)} (
                  {receipt.durationMinutes ?? 0} دقيقة)
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-600">سعر الساعة:</span>
                <span className="tabular-nums">
                  {formatEgp(receipt.hourlyRatePiasters ?? 0)}
                </span>
              </div>
              <div className="flex justify-between text-sm font-semibold pt-1">
                <span>تكلفة القعدة:</span>
                <span className="tabular-nums">
                  {formatEgp(receipt.sessionCostPiasters ?? 0)}
                </span>
              </div>
            </div>
          )}

          {/* Drinks / Items */}
          {receipt.items && receipt.items.length > 0 && (
            <div className="py-3.5 space-y-2 border-b border-dashed border-slate-300">
              <div className="text-xs font-bold text-slate-700">المشروبات</div>
              <div className="space-y-1.5">
                {receipt.items.map((item, idx) => (
                  <div
                    key={`${item.name}-${idx}`}
                    className="flex items-center justify-between text-xs gap-2"
                  >
                    <span className="text-slate-800">
                      {item.name} × {item.quantity}{' '}
                      <span className="text-slate-400">
                        ({formatEgp(item.unitPricePiasters)})
                      </span>
                    </span>
                    <span className="tabular-nums font-medium shrink-0">
                      {formatEgp(item.lineTotalPiasters)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Course Payment Details */}
          {receipt.kind === 'course_payment' && receipt.courseDetails && (
            <div className="py-3.5 space-y-2 border-b border-dashed border-slate-300 text-xs">
              <div className="font-bold text-slate-700">تفاصيل الكورس</div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-600">الكورس:</span>
                <span className="font-medium">
                  {receipt.courseDetails.courseName}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-600">المجموعة:</span>
                <span className="font-medium">
                  {receipt.courseDetails.groupName}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-600">إجمالي الكورس المتفق عليه:</span>
                <span className="tabular-nums">
                  {formatEgp(receipt.courseDetails.agreedPricePiasters)}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-600">إجمالي المدفوع حتى الآن:</span>
                <span className="tabular-nums font-medium text-emerald-700">
                  {formatEgp(receipt.courseDetails.totalPaidPiasters)}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-600">المتبقي على الطالب:</span>
                <span className="tabular-nums font-bold text-amber-700">
                  {formatEgp(receipt.courseDetails.remainingPiasters)}
                </span>
              </div>
            </div>
          )}

          {/* Grand Total */}
          <div className="py-4 flex items-center justify-between text-base font-extrabold border-b border-dashed border-slate-300">
            <span>الإجمالي المحصّل</span>
            <span className="tabular-nums text-lg">
              {formatEgp(receipt.totalPiasters)}
            </span>
          </div>

          {settings.receiptFooter && (
            <p className="text-center text-xs text-slate-500 pt-4">
              {settings.receiptFooter}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="no-print px-5 py-4 bg-slate-50 border-t border-slate-200 flex items-center gap-3">
          <button
            type="button"
            onClick={() => window.print()}
            className="flex-1 h-11 rounded-lg bg-teal-700 hover:bg-teal-800 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>طباعة الإيصال</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-11 px-5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-medium text-sm transition-colors cursor-pointer"
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
}
