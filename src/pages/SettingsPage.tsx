import React, { useEffect, useState } from 'react';
import {
  Save,
  Plus,
  Lock,
  Power,
  UserPlus,
  Shield,
  History,
  Tag,
  Sliders,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import type {
  AuditLogItem,
  AuthUser,
  ExpenseCategory,
  UserRole,
  WorkspaceSettings,
} from '../shared/types.ts';
import {
  egpToPiasters,
  formatCairoDateTime,
  ROLE_LABELS,
} from '../shared/format.ts';

interface SettingsPageProps {
  user: AuthUser;
  settings: WorkspaceSettings;
  categories: ExpenseCategory[];
  onRefreshSettings: () => Promise<void>;
  onRefreshCategories: () => Promise<void>;
  onNotify: (type: 'success' | 'error', message: string) => void;
}

export function SettingsPage({
  user,
  settings,
  categories,
  onRefreshSettings,
  onRefreshCategories,
  onNotify,
}: SettingsPageProps) {
  const isAdmin = user.role === 'admin';
  const [section, setSection] = useState<
    'pricing' | 'categories' | 'users' | 'audit'
  >('pricing');

  // Pricing & Workspace settings form
  const [workspaceName, setWorkspaceName] = useState(settings.workspaceName);
  const [hourlyRateEgp, setHourlyRateEgp] = useState(
    (settings.hourlyRatePiasters / 100).toFixed(2)
  );
  const [phone, setPhone] = useState(settings.phone);
  const [address, setAddress] = useState(settings.address);
  const [receiptFooter, setReceiptFooter] = useState(settings.receiptFooter);
  const [savingSettings, setSavingSettings] = useState(false);

  // Expense categories
  const [newCategoryName, setNewCategoryName] = useState('');
  const [addingCategory, setAddingCategory] = useState(false);

  // Users
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [newUsername, setNewUsername] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('receptionist');
  const [newPassword, setNewPassword] = useState('');
  const [creatingUser, setCreatingUser] = useState(false);

  // Audit logs
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);

  useEffect(() => {
    setWorkspaceName(settings.workspaceName);
    setHourlyRateEgp((settings.hourlyRatePiasters / 100).toFixed(2));
    setPhone(settings.phone);
    setAddress(settings.address);
    setReceiptFooter(settings.receiptFooter);
  }, [settings]);

  useEffect(() => {
    if (!isAdmin) return;
    if (section === 'users') {
      api
        .listUsers()
        .then(setUsers)
        .catch((err) =>
          onNotify(
            'error',
            err instanceof Error ? err.message : 'تعذر تحميل المستخدمين.'
          )
        );
    } else if (section === 'audit') {
      api
        .listAuditLogs(120)
        .then(setAuditLogs)
        .catch((err) =>
          onNotify(
            'error',
            err instanceof Error ? err.message : 'تعذر تحميل سجل التدقيق.'
          )
        );
    }
  }, [section, isAdmin]);

  if (!isAdmin) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-3">
        <Lock className="w-10 h-10 text-slate-400 mx-auto" />
        <h2 className="text-lg font-bold text-slate-900">
          الإعدادات والأسعار متاحة للمدير فقط
        </h2>
        <p className="text-sm text-slate-500 max-w-md mx-auto">
          لا يمكن لموظف الاستقبال تعديل الأسعار أو الإعدادات أو المستخدمين.
        </p>
      </div>
    );
  }

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    const ratePiasters = egpToPiasters(hourlyRateEgp);
    if (ratePiasters < 0) {
      onNotify('error', 'سعر الساعة غير صالح.');
      return;
    }
    setSavingSettings(true);
    try {
      await api.updateSettings({
        workspaceName: workspaceName.trim(),
        hourlyRatePiasters: ratePiasters,
        phone: phone.trim(),
        address: address.trim(),
        receiptFooter: receiptFooter.trim(),
      });
      await onRefreshSettings();
      onNotify(
        'success',
        'تم حفظ الإعدادات بنجاح. الجلسات الجديدة ستستخدم السعر المحدّث.'
      );
    } catch (err) {
      onNotify(
        'error',
        err instanceof Error ? err.message : 'تعذر حفظ الإعدادات.'
      );
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleAddCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!newCategoryName.trim()) return;
    setAddingCategory(true);
    try {
      await api.createExpenseCategory(newCategoryName.trim());
      setNewCategoryName('');
      await onRefreshCategories();
      onNotify('success', 'تم إضافة تصنيف المصروف بنجاح.');
    } catch (err) {
      onNotify(
        'error',
        err instanceof Error ? err.message : 'تعذر إضافة التصنيف.'
      );
    } finally {
      setAddingCategory(false);
    }
  }

  async function handleToggleCategory(cat: ExpenseCategory) {
    try {
      await api.updateExpenseCategory(cat.id, { isActive: !cat.isActive });
      await onRefreshCategories();
      onNotify('success', 'تم تحديث حالة التصنيف.');
    } catch (err) {
      onNotify(
        'error',
        err instanceof Error ? err.message : 'تعذر تحديث التصنيف.'
      );
    }
  }

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 6) {
      onNotify('error', 'كلمة المرور يجب أن تكون 6 أحرف على الأقل.');
      return;
    }
    setCreatingUser(true);
    try {
      await api.createUser({
        username: newUsername.trim(),
        displayName: newDisplayName.trim(),
        role: newRole,
        password: newPassword,
      });
      setNewUsername('');
      setNewDisplayName('');
      setNewPassword('');
      const updated = await api.listUsers();
      setUsers(updated);
      onNotify('success', 'تم إنشاء الحساب بنجاح.');
    } catch (err) {
      onNotify(
        'error',
        err instanceof Error ? err.message : 'تعذر إنشاء الحساب.'
      );
    } finally {
      setCreatingUser(false);
    }
  }

  async function handleToggleUser(u: AuthUser) {
    try {
      await api.updateUser(u.id, { isActive: !u.isActive });
      const updated = await api.listUsers();
      setUsers(updated);
      onNotify('success', 'تم تحديث حالة الحساب.');
    } catch (err) {
      onNotify(
        'error',
        err instanceof Error ? err.message : 'تعذر تحديث الحساب.'
      );
    }
  }

  return (
    <div className="space-y-6">
      {/* Sub-navigation Tabs */}
      <div className="inline-flex flex-wrap p-1 bg-slate-200/70 rounded-lg gap-1">
        <button
          type="button"
          onClick={() => setSection('pricing')}
          className={`px-4 py-2 text-sm font-semibold rounded-md flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
            section === 'pricing'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Sliders className="w-4 h-4" />
          <span>التسعير وبيانات المكان</span>
        </button>
        <button
          type="button"
          onClick={() => setSection('categories')}
          className={`px-4 py-2 text-sm font-semibold rounded-md flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
            section === 'categories'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Tag className="w-4 h-4" />
          <span>تصنيفات المصروفات</span>
        </button>
        <button
          type="button"
          onClick={() => setSection('users')}
          className={`px-4 py-2 text-sm font-semibold rounded-md flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
            section === 'users'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Shield className="w-4 h-4" />
          <span>المستخدمون والصلاحيات</span>
        </button>
        <button
          type="button"
          onClick={() => setSection('audit')}
          className={`px-4 py-2 text-sm font-semibold rounded-md flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
            section === 'audit'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <History className="w-4 h-4" />
          <span>سجل التدقيق</span>
        </button>
      </div>

      {/* SECTION 1: PRICING & GENERAL SETTINGS */}
      {section === 'pricing' && (
        <form
          onSubmit={handleSaveSettings}
          className="bg-white border border-slate-200 rounded-xl p-6 max-w-2xl space-y-4"
        >
          <div>
            <h3 className="text-base font-bold text-slate-900">
              إعدادات التسعير والإيصال
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              تعديل سعر الساعة ينطبق على الجلسات الجديدة فقط، وتبقى الجلسات السابقة والمفتوحة على سعرها المحفوظ وقت البدء.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                اسم المكان
              </label>
              <input
                type="text"
                required
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
                className="w-full h-11 px-3.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                سعر الساعة للوركسبيس (ج.م)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                required
                dir="ltr"
                value={hourlyRateEgp}
                onChange={(e) => setHourlyRateEgp(e.target.value)}
                className="w-full h-11 px-3.5 rounded-lg border border-slate-300 text-base font-mono text-left focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                رقم الهاتف (يظهر على الإيصال)
              </label>
              <input
                type="text"
                dir="ltr"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="010xxxxxxxx"
                className="w-full h-11 px-3.5 rounded-lg border border-slate-300 text-sm font-mono text-left focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                العنوان (يظهر على الإيصال)
              </label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="القاهرة، مصر"
                className="w-full h-11 px-3.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              رسالة تذييل الإيصال المطبوع
            </label>
            <input
              type="text"
              value={receiptFooter}
              onChange={(e) => setReceiptFooter(e.target.value)}
              className="w-full h-11 px-3.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>

          <button
            type="submit"
            disabled={savingSettings}
            className="h-11 px-6 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white font-bold text-sm inline-flex items-center gap-2 cursor-pointer"
          >
            <Save className="w-4 h-4" />
            <span>{savingSettings ? 'جاري الحفظ...' : 'حفظ الإعدادات'}</span>
          </button>
        </form>
      )}

      {/* SECTION 2: EXPENSE CATEGORIES */}
      {section === 'categories' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 max-w-2xl space-y-5">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              تصنيفات المصروفات
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              أضف تصنيفات جديدة أو أوقف التصنيفات غير المستخدمة دون التأثير على الحركات السابقة.
            </p>
          </div>

          <form onSubmit={handleAddCategory} className="flex gap-2.5">
            <input
              type="text"
              required
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              placeholder="اسم تصنيف جديد (مثال: ضرائب / مستلزمات مكتبية)"
              className="flex-1 h-11 px-3.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
            <button
              type="submit"
              disabled={addingCategory}
              className="h-11 px-5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white font-semibold text-sm flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة</span>
            </button>
          </form>

          <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
            {categories.map((cat) => (
              <div
                key={cat.id}
                className="px-4 py-3 flex items-center justify-between text-sm"
              >
                <span
                  className={
                    cat.isActive
                      ? 'font-semibold text-slate-900'
                      : 'line-through text-slate-400'
                  }
                >
                  {cat.name}
                </span>
                <button
                  type="button"
                  onClick={() => handleToggleCategory(cat)}
                  className={`inline-flex items-center gap-1 text-xs font-semibold cursor-pointer ${
                    cat.isActive ? 'text-amber-700' : 'text-emerald-700'
                  }`}
                >
                  <Power className="w-3.5 h-3.5" />
                  <span>{cat.isActive ? 'إيقاف' : 'تفعيل'}</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SECTION 3: USERS & ROLES */}
      {section === 'users' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <form
            onSubmit={handleCreateUser}
            className="bg-white border border-slate-200 rounded-xl p-6 space-y-4 h-fit"
          >
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-teal-700" />
              <span>إضافة مستخدم جديد</span>
            </h3>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                الاسم الكامل
              </label>
              <input
                type="text"
                required
                value={newDisplayName}
                onChange={(e) => setNewDisplayName(e.target.value)}
                placeholder="مثال: سارة محمود"
                className="w-full h-11 px-3.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  اسم المستخدم
                </label>
                <input
                  type="text"
                  required
                  dir="ltr"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="sara"
                  className="w-full h-11 px-3.5 rounded-lg border border-slate-300 text-sm font-mono text-left focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  الدور / الصلاحية
                </label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as UserRole)}
                  className="w-full h-11 px-3 rounded-lg border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                >
                  <option value="receptionist">موظف استقبال</option>
                  <option value="admin">مدير</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                كلمة المرور
              </label>
              <input
                type="password"
                required
                minLength={6}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="6 أحرف على الأقل"
                className="w-full h-11 px-3.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>

            <button
              type="submit"
              disabled={creatingUser}
              className="w-full h-11 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white font-bold text-sm cursor-pointer"
            >
              {creatingUser ? 'جاري الإنشاء...' : 'إنشاء الحساب'}
            </button>
          </form>

          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-900">
              الحسابات المسجلة ({users.length})
            </h3>
            <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
              {users.map((u) => (
                <div
                  key={u.id}
                  className="p-3.5 flex items-center justify-between gap-3 text-sm"
                >
                  <div>
                    <div className="font-bold text-slate-900">
                      {u.displayName}
                      {u.id === user.id && (
                        <span className="text-xs text-teal-700 font-normal mr-1.5">
                          (أنت)
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5">
                      <span className="font-mono" dir="ltr">
                        @{u.username}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{ROLE_LABELS[u.role]}</span>
                      <span aria-hidden="true">·</span>
                      <span
                        className={
                          u.isActive ? 'text-emerald-700' : 'text-red-600'
                        }
                      >
                        {u.isActive ? 'نشط' : 'موقوف'}
                      </span>
                    </div>
                  </div>
                  {u.id !== user.id && (
                    <button
                      type="button"
                      onClick={() => handleToggleUser(u)}
                      className={`text-xs font-semibold cursor-pointer ${
                        u.isActive ? 'text-red-600' : 'text-emerald-700'
                      }`}
                    >
                      {u.isActive ? 'إيقاف الحساب' : 'إعادة تفعيل'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* SECTION 4: AUDIT LOGS */}
      {section === 'audit' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-xs text-right">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="py-3 px-4 font-semibold">الوقت (القاهرة)</th>
                <th className="py-3 px-4 font-semibold">المستخدم</th>
                <th className="py-3 px-4 font-semibold">العملية</th>
                <th className="py-3 px-4 font-semibold">التفاصيل</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {auditLogs.map((log) => (
                <tr key={log.id}>
                  <td className="py-3 px-4 tabular-nums whitespace-nowrap text-slate-600">
                    {formatCairoDateTime(log.createdAt)}
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap font-semibold text-slate-900">
                    {log.actorName}{' '}
                    <span className="text-slate-400 font-normal">
                      ({log.actorRole === 'admin' ? 'مدير' : log.actorRole === 'receptionist' ? 'استقبال' : log.actorRole})
                    </span>
                  </td>
                  <td className="py-3 px-4 font-mono text-slate-700 whitespace-nowrap">
                    {log.action}
                  </td>
                  <td
                    className="py-3 px-4 font-mono text-slate-500 max-w-md truncate"
                    dir="ltr"
                  >
                    {JSON.stringify(log.details)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
