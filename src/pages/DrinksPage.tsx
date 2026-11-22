import React, { useEffect, useState } from 'react';
import {
  Coffee,
  Plus,
  Edit3,
  Power,
  Printer,
  X,
  AlertCircle,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import type {
  AuthUser,
  DirectDrinkSale,
  DrinkItem,
  ReceiptData,
} from '../shared/types.ts';
import {
  egpToPiasters,
  formatCairoDateTime,
  formatEgp,
  PAYMENT_METHOD_LABELS,
} from '../shared/format.ts';
import { DirectDrinkSaleModal } from '../components/QuickModals.tsx';

interface DrinksPageProps {
  user: AuthUser;
  drinks: DrinkItem[];
  onRefreshDrinks: () => Promise<void>;
  onNotify: (type: 'success' | 'error', message: string) => void;
  onShowReceipt: (receipt: ReceiptData) => void;
}

export function DrinksPage({
  user,
  drinks,
  onRefreshDrinks,
  onNotify,
  onShowReceipt,
}: DrinksPageProps) {
  const isAdmin = user.role === 'admin';
  const [sales, setSales] = useState<DirectDrinkSale[]>([]);
  const [loadingSales, setLoadingSales] = useState(true);
  const [showDirectSale, setShowDirectSale] = useState(false);

  // Add / Edit Drink modal state (Admin)
  const [editingDrink, setEditingDrink] = useState<DrinkItem | null>(null);
  const [showDrinkModal, setShowDrinkModal] = useState(false);
  const [drinkName, setDrinkName] = useState('');
  const [drinkPriceEgp, setDrinkPriceEgp] = useState('');
  const [drinkBusy, setDrinkBusy] = useState(false);
  const [drinkError, setDrinkError] = useState<string | null>(null);

  async function loadSales() {
    try {
      const list = await api.listDirectSales(40);
      setSales(list);
    } catch (err) {
      onNotify(
        'error',
        err instanceof Error ? err.message : 'تعذر تحميل سجل المبيعات المباشرة.'
      );
    } finally {
      setLoadingSales(false);
    }
  }

  useEffect(() => {
    loadSales();
  }, []);

  function openNewDrink() {
    setEditingDrink(null);
    setDrinkName('');
    setDrinkPriceEgp('');
    setDrinkError(null);
    setShowDrinkModal(true);
  }

  function openEditDrink(drink: DrinkItem) {
    setEditingDrink(drink);
    setDrinkName(drink.name);
    setDrinkPriceEgp((drink.pricePiasters / 100).toFixed(2));
    setDrinkError(null);
    setShowDrinkModal(true);
  }

  async function handleSaveDrink(e: React.FormEvent) {
    e.preventDefault();
    setDrinkError(null);
    const pricePiasters = egpToPiasters(drinkPriceEgp);
    if (!drinkName.trim()) {
      setDrinkError('أدخل اسم المشروب.');
      return;
    }
    if (pricePiasters < 0) {
      setDrinkError('السعر غير صالح.');
      return;
    }

    setDrinkBusy(true);
    try {
      if (editingDrink) {
        await api.updateDrink(editingDrink.id, {
          name: drinkName.trim(),
          pricePiasters,
        });
        onNotify('success', 'تم تحديث بيانات المشروب بنجاح.');
      } else {
        await api.createDrink({
          name: drinkName.trim(),
          pricePiasters,
        });
        onNotify('success', 'تم إضافة المشروب إلى القائمة.');
      }
      setShowDrinkModal(false);
      await onRefreshDrinks();
    } catch (err) {
      setDrinkError(
        err instanceof Error ? err.message : 'تعذر حفظ المشروب.'
      );
    } finally {
      setDrinkBusy(false);
    }
  }

  async function handleToggleActive(drink: DrinkItem) {
    try {
      await api.updateDrink(drink.id, { isActive: !drink.isActive });
      await onRefreshDrinks();
      onNotify(
        'success',
        drink.isActive
          ? `تم إيقاف "${drink.name}" مؤقتًا.`
          : `تم تفعيل "${drink.name}" في القائمة.`
      );
    } catch (err) {
      onNotify(
        'error',
        err instanceof Error ? err.message : 'تعذر تحديث حالة الصنف.'
      );
    }
  }

  function buildReceiptFromSale(sale: DirectDrinkSale): ReceiptData {
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

  return (
    <div className="space-y-6">
      {/* Header Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">
            قائمة المشروبات والبيع المباشر
          </h2>
          <p className="text-sm text-slate-500">
            تغيير الأسعار لا يؤثر على الطلبات أو الجلسات المسجلة سابقًا.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setShowDirectSale(true)}
            className="h-11 px-4 rounded-lg bg-teal-700 hover:bg-teal-800 text-white font-semibold text-sm flex items-center gap-2 cursor-pointer whitespace-nowrap"
          >
            <Coffee className="w-4 h-4" />
            <span>بيع مشروب مباشر</span>
          </button>

          {isAdmin && (
            <button
              type="button"
              onClick={openNewDrink}
              className="h-11 px-4 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm flex items-center gap-2 cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة مشروب جديد</span>
            </button>
          )}
        </div>
      </div>

      {/* Drinks Menu Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm text-right">
          <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
            <tr>
              <th className="py-3 px-4 font-semibold">اسم الصنف</th>
              <th className="py-3 px-4 font-semibold">السعر الحالي</th>
              <th className="py-3 px-4 font-semibold">الحالة</th>
              {isAdmin && (
                <th className="py-3 px-4 font-semibold text-left">إدارة</th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {drinks.map((drink) => (
              <tr
                key={drink.id}
                className={!drink.isActive ? 'bg-slate-50/60 text-slate-400' : 'hover:bg-slate-50/50'}
              >
                <td className="py-3.5 px-4 font-semibold text-slate-900">
                  <span className={!drink.isActive ? 'line-through text-slate-400' : ''}>
                    {drink.name}
                  </span>
                </td>
                <td className="py-3.5 px-4 font-bold tabular-nums text-slate-900">
                  {formatEgp(drink.pricePiasters)}
                </td>
                <td className="py-3.5 px-4">
                  <span
                    className={`text-xs font-semibold ${
                      drink.isActive ? 'text-emerald-700' : 'text-slate-500'
                    }`}
                  >
                    {drink.isActive ? 'متاح للبيع' : 'متوقف مؤقتًا'}
                  </span>
                </td>
                {isAdmin && (
                  <td className="py-3.5 px-4 text-left whitespace-nowrap">
                    <div className="inline-flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => openEditDrink(drink)}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:text-teal-900 cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>تعديل</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleActive(drink)}
                        className={`inline-flex items-center gap-1 text-xs font-semibold cursor-pointer ${
                          drink.isActive
                            ? 'text-amber-700 hover:text-amber-900'
                            : 'text-emerald-700 hover:text-emerald-900'
                        }`}
                      >
                        <Power className="w-3.5 h-3.5" />
                        <span>{drink.isActive ? 'إيقاف' : 'تفعيل'}</span>
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Recent Direct Sales */}
      <section className="space-y-3">
        <h3 className="text-base font-bold text-slate-900">
          سجل مبيعات المشروبات المباشرة (بدون جلسة)
        </h3>
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          {loadingSales ? (
            <div className="p-8 text-center text-sm text-slate-500">
              جاري التحميل...
            </div>
          ) : sales.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              لا توجد مبيعات مشروبات مباشرة مسجلة بعد.
            </div>
          ) : (
            <table className="w-full text-sm text-right">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                <tr>
                  <th className="py-3 px-4 font-semibold">رقم العملية</th>
                  <th className="py-3 px-4 font-semibold">الأصناف</th>
                  <th className="py-3 px-4 font-semibold">العميل</th>
                  <th className="py-3 px-4 font-semibold">الوقت</th>
                  <th className="py-3 px-4 font-semibold">الوسيلة</th>
                  <th className="py-3 px-4 font-semibold">المبلغ</th>
                  <th className="py-3 px-4 font-semibold text-left">إيصال</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sales.map((sale) => (
                  <tr key={sale.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4 font-mono font-semibold text-slate-900">
                      #{sale.saleNumber}
                    </td>
                    <td className="py-3 px-4 text-slate-700">
                      {sale.items
                        .map((i) => `${i.drinkNameSnapshot} ×${i.quantity}`)
                        .join('، ')}
                    </td>
                    <td className="py-3 px-4 text-slate-600">
                      {sale.customerName || 'زائر مباشر'}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-500 tabular-nums whitespace-nowrap">
                      {formatCairoDateTime(sale.occurredAt)}
                    </td>
                    <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                      {PAYMENT_METHOD_LABELS[sale.paymentMethod]}
                    </td>
                    <td className="py-3 px-4 font-bold text-emerald-700 tabular-nums whitespace-nowrap">
                      {formatEgp(sale.totalPiasters)}
                    </td>
                    <td className="py-3 px-4 text-left whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => onShowReceipt(buildReceiptFromSale(sale))}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:text-teal-900 cursor-pointer"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span>إيصال</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Add/Edit Drink Modal (Admin) */}
      {showDrinkModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">
                {editingDrink ? 'تعديل مشروب' : 'إضافة مشروب جديد'}
              </h2>
              <button
                type="button"
                onClick={() => setShowDrinkModal(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveDrink} className="p-5 space-y-4">
              {drinkError && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">
                  <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
                  <span>{drinkError}</span>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  اسم المشروب
                </label>
                <input
                  type="text"
                  required
                  value={drinkName}
                  onChange={(e) => setDrinkName(e.target.value)}
                  placeholder="مثال: لاتيه بارد"
                  className="w-full h-11 px-3.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  السعر (جنيه مصري)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  dir="ltr"
                  value={drinkPriceEgp}
                  onChange={(e) => setDrinkPriceEgp(e.target.value)}
                  placeholder="25.00"
                  className="w-full h-11 px-3.5 rounded-lg border border-slate-300 text-base font-mono text-left focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>

              <div className="flex items-center gap-3 pt-1">
                <button
                  type="submit"
                  disabled={drinkBusy}
                  className="flex-1 h-11 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white font-bold text-sm cursor-pointer"
                >
                  {drinkBusy ? 'جاري الحفظ...' : 'حفظ'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowDrinkModal(false)}
                  className="h-11 px-5 rounded-lg border border-slate-300 bg-white text-slate-700 text-sm font-medium cursor-pointer"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showDirectSale && (
        <DirectDrinkSaleModal
          drinks={drinks}
          onClose={() => setShowDirectSale(false)}
          onSuccess={async (receipt, msg) => {
            setShowDirectSale(false);
            await loadSales();
            onNotify('success', msg);
            onShowReceipt(receipt);
          }}
        />
      )}
    </div>
  );
}
