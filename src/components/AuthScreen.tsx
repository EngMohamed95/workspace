import React, { useState } from 'react';
import { Lock, ShieldCheck, UserPlus, LogIn, AlertCircle } from 'lucide-react';
import { api, setAuthToken } from '../lib/api.ts';
import type { AuthUser } from '../shared/types.ts';

interface AuthScreenProps {
  needsSetup: boolean;
  onAuthenticated: (user: AuthUser) => void;
}

export function AuthScreen({ needsSetup, onAuthenticated }: AuthScreenProps) {
  // Login state
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // First-run setup state
  const [adminDisplayName, setAdminDisplayName] = useState('صاحب المكان');
  const [adminUsername, setAdminUsername] = useState('admin');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminPasswordConfirm, setAdminPasswordConfirm] = useState('');
  const [addReceptionistNow, setAddReceptionistNow] = useState(true);
  const [recDisplayName, setRecDisplayName] = useState('موظف الاستقبال');
  const [recUsername, setRecUsername] = useState('reception');
  const [recPassword, setRecPassword] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!loginUsername.trim() || !loginPassword) {
      setError('يرجى إدخال اسم المستخدم وكلمة المرور.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.login(loginUsername.trim(), loginPassword);
      setAuthToken(res.token);
      onAuthenticated(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل تسجيل الدخول.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleBootstrap(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (adminPassword.length < 6) {
      setError('كلمة مرور المدير يجب أن تكون 6 أحرف على الأقل.');
      return;
    }
    if (adminPassword !== adminPasswordConfirm) {
      setError('تأكيد كلمة مرور المدير غير متطابق.');
      return;
    }
    if (addReceptionistNow) {
      if (!recUsername.trim() || !recDisplayName.trim()) {
        setError('يرجى استكمال بيانات حساب موظف الاستقبال أو إلغاء تفعيله الآن.');
        return;
      }
      if (recPassword.length < 6) {
        setError('كلمة مرور موظف الاستقبال يجب أن تكون 6 أحرف على الأقل.');
        return;
      }
    }

    setSubmitting(true);
    try {
      const res = await api.bootstrapAdmin({
        username: adminUsername.trim(),
        displayName: adminDisplayName.trim(),
        password: adminPassword,
        receptionist: addReceptionistNow
          ? {
              username: recUsername.trim(),
              displayName: recDisplayName.trim(),
              password: recPassword,
            }
          : undefined,
      });
      setAuthToken(res.token);
      onAuthenticated(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل إعداد الحسابات.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center px-4 py-10">
      <div className="w-full max-w-lg bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
        <div className="mb-6 pb-5 border-b border-slate-100">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
                Stack Space
              </h1>
              <p className="text-sm text-slate-500 mt-1">
                نظام إدارة الوركسبيس ومركز كورسات البرمجة · توقيت القاهرة
              </p>
            </div>
            <div className="w-11 h-11 rounded-lg bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-700 shrink-0">
              {needsSetup ? <ShieldCheck className="w-6 h-6" /> : <Lock className="w-5 h-5" />}
            </div>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-5 flex items-start gap-2.5 p-3.5 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm"
          >
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {needsSetup ? (
          <form onSubmit={handleBootstrap} className="space-y-5">
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                إعداد حساب المدير لأول مرة
              </h2>
              <p className="text-sm text-slate-600 mt-1">
                أنشئ حساب صاحب المكان (المدير) لبدء التشغيل الفوري. يمكنك إضافة أو تعديل الحسابات لاحقًا من شاشة الإعدادات.
              </p>
            </div>

            <div className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    اسم المدير
                  </label>
                  <input
                    type="text"
                    required
                    value={adminDisplayName}
                    onChange={(e) => setAdminDisplayName(e.target.value)}
                    className="w-full h-11 px-3.5 rounded-lg border border-slate-300 bg-white text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    اسم المستخدم (للدخول)
                  </label>
                  <input
                    type="text"
                    required
                    dir="ltr"
                    value={adminUsername}
                    onChange={(e) => setAdminUsername(e.target.value)}
                    className="w-full h-11 px-3.5 rounded-lg border border-slate-300 bg-white text-slate-900 text-sm font-mono text-left focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    كلمة المرور
                  </label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    placeholder="6 أحرف على الأقل"
                    className="w-full h-11 px-3.5 rounded-lg border border-slate-300 bg-white text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    تأكيد كلمة المرور
                  </label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={adminPasswordConfirm}
                    onChange={(e) => setAdminPasswordConfirm(e.target.value)}
                    placeholder="أعد كتابة كلمة المرور"
                    className="w-full h-11 px-3.5 rounded-lg border border-slate-300 bg-white text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600"
                  />
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200 space-y-3.5">
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={addReceptionistNow}
                  onChange={(e) => setAddReceptionistNow(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                />
                <span className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
                  <UserPlus className="w-4 h-4 text-slate-500" />
                  إنشاء حساب موظف استقبال الآن أيضًا (اختياري)
                </span>
              </label>

              {addReceptionistNow && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      اسم الموظف
                    </label>
                    <input
                      type="text"
                      value={recDisplayName}
                      onChange={(e) => setRecDisplayName(e.target.value)}
                      className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      اسم المستخدم
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      value={recUsername}
                      onChange={(e) => setRecUsername(e.target.value)}
                      className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-slate-900 text-sm font-mono text-left focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      كلمة المرور
                    </label>
                    <input
                      type="password"
                      minLength={6}
                      value={recPassword}
                      onChange={(e) => setRecPassword(e.target.value)}
                      placeholder="6 أحرف+"
                      className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full h-12 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white font-semibold text-base transition-colors cursor-pointer"
            >
              {submitting ? 'جاري حفظ الإعدادات...' : 'إنشاء الحسابات وبدء التشغيل'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">تسجيل الدخول</h2>
              <p className="text-sm text-slate-600 mt-0.5">
                أدخل بيانات حساب المدير أو موظف الاستقبال للمتابعة.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                اسم المستخدم
              </label>
              <input
                type="text"
                required
                autoFocus
                dir="ltr"
                value={loginUsername}
                onChange={(e) => setLoginUsername(e.target.value)}
                placeholder="admin"
                className="w-full h-12 px-3.5 rounded-lg border border-slate-300 bg-white text-slate-900 text-base font-mono text-left focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                كلمة المرور
              </label>
              <input
                type="password"
                required
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full h-12 px-3.5 rounded-lg border border-slate-300 bg-white text-slate-900 text-base focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full h-12 mt-2 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white font-semibold text-base flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <LogIn className="w-5 h-5" />
              <span>{submitting ? 'جاري التحقق...' : 'دخول إلى النظام'}</span>
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
