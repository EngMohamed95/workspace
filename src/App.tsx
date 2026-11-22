/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Clock,
  Coffee,
  GraduationCap,
  ArrowLeftRight,
  BarChart3,
  Settings,
  LogOut,
  Menu,
  X,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { api, setAuthToken } from './lib/api.ts';
import type {
  AuthUser,
  CourseGroup,
  DrinkItem,
  ExpenseCategory,
  ReceiptData,
  StudentEnrollment,
  WorkspaceSettings,
} from './shared/types.ts';
import {
  formatCairoDateArabic,
  formatCairoTime,
  getCurrentCairoDate,
  ROLE_LABELS,
} from './shared/format.ts';
import { AuthScreen } from './components/AuthScreen.tsx';
import { ReceiptModal } from './components/ReceiptModal.tsx';
import { ReceptionPage } from './pages/ReceptionPage.tsx';
import { DrinksPage } from './pages/DrinksPage.tsx';
import { CoursesPage } from './pages/CoursesPage.tsx';
import { LedgerPage } from './pages/LedgerPage.tsx';
import { ReportsPage } from './pages/ReportsPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';

type NavKey =
  | 'reception'
  | 'drinks'
  | 'courses'
  | 'ledger'
  | 'reports'
  | 'settings';

const NAV_ITEMS: Array<{
  key: NavKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
}> = [
  { key: 'reception', label: 'الاستقبال', icon: Clock },
  { key: 'drinks', label: 'المشروبات', icon: Coffee },
  { key: 'courses', label: 'الكورسات', icon: GraduationCap },
  { key: 'ledger', label: 'الحركات المالية', icon: ArrowLeftRight },
  { key: 'reports', label: 'التقارير', icon: BarChart3, adminOnly: true },
  { key: 'settings', label: 'الإعدادات', icon: Settings, adminOnly: true },
];

export default function App() {
  const [booting, setBooting] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [activeNav, setActiveNav] = useState<NavKey>('reception');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Shared reference data
  const [settings, setSettings] = useState<WorkspaceSettings>({
    workspaceName: 'Stack Space',
    hourlyRatePiasters: 3000,
    phone: '',
    address: 'القاهرة، مصر',
    receiptFooter: '',
    updatedAt: '',
  });
  const [drinks, setDrinks] = useState<DrinkItem[]>([]);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [courseGroups, setCourseGroups] = useState<CourseGroup[]>([]);
  const [enrollments, setEnrollments] = useState<StudentEnrollment[]>([]);

  // Global receipt modal & toast notification
  const [activeReceipt, setActiveReceipt] = useState<ReceiptData | null>(null);
  const [toast, setToast] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Live Cairo clock in header
  const [clockIso, setClockIso] = useState(() => new Date().toISOString());

  useEffect(() => {
    const t = window.setInterval(
      () => setClockIso(new Date().toISOString()),
      30000
    );
    return () => window.clearInterval(t);
  }, []);

  const notify = useCallback((type: 'success' | 'error', message: string) => {
    setToast({ type, message });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const checkAuthStatus = useCallback(async () => {
    try {
      const status = await api.getAuthStatus();
      setNeedsSetup(status.needsSetup);
    } catch {
      setNeedsSetup(false);
    } finally {
      setBooting(false);
    }
  }, []);

  useEffect(() => {
    checkAuthStatus();
  }, [checkAuthStatus]);

  const loadReferenceData = useCallback(async () => {
    const [s, d, c, g, e] = await Promise.all([
      api.getSettings(),
      api.listDrinks(true),
      api.listExpenseCategories(true),
      api.listCourseGroups(),
      api.listEnrollments(),
    ]);
    setSettings(s);
    setDrinks(d);
    setCategories(c);
    setCourseGroups(g);
    setEnrollments(e);
  }, []);

  useEffect(() => {
    if (!user) return;
    loadReferenceData().catch((err) =>
      notify(
        'error',
        err instanceof Error ? err.message : 'تعذر تحميل بيانات النظام.'
      )
    );
  }, [user, loadReferenceData, notify]);

  async function handleLogout() {
    try {
      await api.logout();
    } catch {
      // ignore
    }
    setAuthToken(null);
    setUser(null);
    setActiveNav('reception');
    checkAuthStatus();
  }

  if (booting) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-sm font-semibold text-slate-600">
          جاري تحميل Stack Space...
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <AuthScreen
        needsSetup={needsSetup}
        onAuthenticated={(u) => {
          setUser(u);
          setNeedsSetup(false);
          setActiveNav('reception');
        }}
      />
    );
  }

  const visibleNavItems = NAV_ITEMS.filter(
    (item) => !item.adminOnly || user.role === 'admin'
  );
  const currentTitle =
    NAV_ITEMS.find((i) => i.key === activeNav)?.label || 'الاستقبال';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex">
      {/* Desktop Sidebar (RTL right side) */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 bg-white border-l border-slate-200 sticky top-0 h-screen">
        <div className="px-6 py-5 border-b border-slate-200">
          <div className="text-xl font-extrabold text-slate-900 tracking-tight whitespace-nowrap">
            {settings.workspaceName}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            إدارة الوركسبيس والكورسات
          </div>
        </div>

        <nav className="flex-1 p-3.5 space-y-1 overflow-y-auto">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const active = activeNav === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setActiveNav(item.key)}
                className={`w-full h-11 px-3.5 rounded-lg text-sm font-semibold flex items-center gap-3 transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? 'bg-teal-700 text-white'
                    : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className="w-5 h-5 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 space-y-3">
          <div className="text-xs">
            <div className="font-bold text-slate-900 truncate">
              {user.displayName}
            </div>
            <div className="text-slate-500 mt-0.5">
              {ROLE_LABELS[user.role]}
            </div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>تسجيل الخروج</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Compact Top Bar */}
        <header className="sticky top-0 z-30 h-14 bg-white border-b border-slate-200 px-4 lg:px-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="فتح القائمة"
              className="lg:hidden p-2 -mr-2 rounded-lg text-slate-700 hover:bg-slate-100 cursor-pointer"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h1 className="text-base sm:text-lg font-extrabold text-slate-900 truncate">
              {currentTitle}
            </h1>
          </div>

          <div className="flex items-center gap-3 text-xs text-slate-600 shrink-0">
            <span className="hidden sm:inline tabular-nums">
              {formatCairoDateArabic(getCurrentCairoDate())}
            </span>
            <span className="hidden sm:inline" aria-hidden="true">
              ·
            </span>
            <span className="font-semibold text-slate-900 tabular-nums whitespace-nowrap">
              {formatCairoTime(clockIso)} (القاهرة)
            </span>
          </div>
        </header>

        {/* Toast Notification Banner */}
        {toast && (
          <div className="px-4 lg:px-8 pt-4">
            <div
              role="status"
              className={`flex items-center justify-between gap-3 px-4 py-3 rounded-xl border text-sm font-medium ${
                toast.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-red-50 border-red-200 text-red-900'
              }`}
            >
              <div className="flex items-center gap-2.5">
                {toast.type === 'success' ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
                )}
                <span>{toast.message}</span>
              </div>
              <button
                type="button"
                onClick={() => setToast(null)}
                className="p-1 rounded hover:bg-black/5 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Active Page Body */}
        <main className="flex-1 p-4 lg:p-8 max-w-7xl w-full mx-auto">
          {activeNav === 'reception' && (
            <ReceptionPage
              settings={settings}
              drinks={drinks}
              categories={categories}
              enrollments={enrollments}
              onRefreshAll={loadReferenceData}
              onNotify={notify}
              onShowReceipt={setActiveReceipt}
            />
          )}

          {activeNav === 'drinks' && (
            <DrinksPage
              user={user}
              drinks={drinks}
              onRefreshDrinks={async () => setDrinks(await api.listDrinks(true))}
              onNotify={notify}
              onShowReceipt={setActiveReceipt}
            />
          )}

          {activeNav === 'courses' && (
            <CoursesPage
              user={user}
              courseGroups={courseGroups}
              enrollments={enrollments}
              onRefreshCourses={async () => {
                const [g, e] = await Promise.all([
                  api.listCourseGroups(),
                  api.listEnrollments(),
                ]);
                setCourseGroups(g);
                setEnrollments(e);
              }}
              onNotify={notify}
              onShowReceipt={setActiveReceipt}
            />
          )}

          {activeNav === 'ledger' && (
            <LedgerPage user={user} categories={categories} onNotify={notify} />
          )}

          {activeNav === 'reports' && (
            <ReportsPage user={user} onNotify={notify} />
          )}

          {activeNav === 'settings' && (
            <SettingsPage
              user={user}
              settings={settings}
              categories={categories}
              onRefreshSettings={async () => setSettings(await api.getSettings())}
              onRefreshCategories={async () =>
                setCategories(await api.listExpenseCategories(true))
              }
              onNotify={notify}
            />
          )}
        </main>
      </div>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/50"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="relative w-72 max-w-[85vw] bg-white h-full flex flex-col border-l border-slate-200 z-10">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="text-lg font-extrabold text-slate-900">
                {settings.workspaceName}
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
              {visibleNavItems.map((item) => {
                const Icon = item.icon;
                const active = activeNav === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => {
                      setActiveNav(item.key);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full h-12 px-4 rounded-lg text-sm font-semibold flex items-center gap-3 cursor-pointer ${
                      active
                        ? 'bg-teal-700 text-white'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <Icon className="w-5 h-5 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>

            <div className="p-4 border-t border-slate-200 space-y-3">
              <div className="text-xs">
                <div className="font-bold text-slate-900">{user.displayName}</div>
                <div className="text-slate-500">{ROLE_LABELS[user.role]}</div>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="w-full h-11 rounded-lg border border-slate-300 bg-white text-slate-700 text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                <span>تسجيل الخروج</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Printable Arabic Receipt Modal */}
      <ReceiptModal
        receipt={activeReceipt}
        settings={settings}
        onClose={() => setActiveReceipt(null)}
      />
    </div>
  );
}
