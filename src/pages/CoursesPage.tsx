import React, { useMemo, useState } from 'react';
import {
  Plus,
  UserPlus,
  CreditCard,
  ChevronDown,
  ChevronUp,
  Search,
  X,
  AlertCircle,
  Printer,
  Edit3,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import type {
  AuthUser,
  CourseGroup,
  CoursePayment,
  ReceiptData,
  StudentEnrollment,
} from '../shared/types.ts';
import {
  egpToPiasters,
  formatCairoDateArabic,
  formatEgp,
  PAYMENT_METHOD_LABELS,
} from '../shared/format.ts';
import { StudentPaymentModal } from '../components/QuickModals.tsx';

interface CoursesPageProps {
  user: AuthUser;
  courseGroups: CourseGroup[];
  enrollments: StudentEnrollment[];
  onRefreshCourses: () => Promise<void>;
  onNotify: (type: 'success' | 'error', message: string) => void;
  onShowReceipt: (receipt: ReceiptData) => void;
}

export function CoursesPage({
  user,
  courseGroups,
  enrollments,
  onRefreshCourses,
  onNotify,
  onShowReceipt,
}: CoursesPageProps) {
  const isAdmin = user.role === 'admin';
  const [tab, setTab] = useState<'students' | 'groups'>('students');
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const [balanceFilter, setBalanceFilter] = useState<'all' | 'remaining' | 'paid'>(
    'all'
  );
  const [expandedEnrollmentId, setExpandedEnrollmentId] = useState<number | null>(
    null
  );

  // Course Group modal (Admin)
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [editingGroup, setEditingGroup] = useState<CourseGroup | null>(null);
  const [courseName, setCourseName] = useState('');
  const [groupName, setGroupName] = useState('');
  const [instructorName, setInstructorName] = useState('');
  const [schedule, setSchedule] = useState('');
  const [priceEgp, setPriceEgp] = useState('');
  const [groupBusy, setGroupBusy] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);

  // Enroll Student modal
  const [showEnrollModal, setShowEnrollModal] = useState(false);
  const [enrollGroupId, setEnrollGroupId] = useState<number>(
    courseGroups[0]?.id || 0
  );
  const [studentName, setStudentName] = useState('');
  const [studentPhone, setStudentPhone] = useState('');
  const [agreedPriceEgp, setAgreedPriceEgp] = useState('');
  const [enrollNotes, setEnrollNotes] = useState('');
  const [enrollBusy, setEnrollBusy] = useState(false);
  const [enrollError, setEnrollError] = useState<string | null>(null);

  // Payment modal
  const [paymentEnrollmentId, setPaymentEnrollmentId] = useState<number | null>(
    null
  );

  const totalAgreed = enrollments.reduce(
    (acc, e) => acc + e.agreedPricePiasters,
    0
  );
  const totalPaid = enrollments.reduce((acc, e) => acc + e.paidPiasters, 0);
  const totalRemaining = enrollments.reduce(
    (acc, e) => acc + e.remainingPiasters,
    0
  );

  const filteredEnrollments = useMemo(() => {
    const q = search.trim().toLowerCase();
    return enrollments.filter((e) => {
      if (groupFilter !== 'all' && String(e.courseGroupId) !== groupFilter)
        return false;
      if (balanceFilter === 'remaining' && e.remainingPiasters <= 0) return false;
      if (balanceFilter === 'paid' && e.remainingPiasters > 0) return false;
      if (q) {
        return (
          e.studentName.toLowerCase().includes(q) ||
          e.studentPhone.includes(q) ||
          e.courseName.toLowerCase().includes(q) ||
          e.groupName.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [enrollments, search, groupFilter, balanceFilter]);

  function openNewGroup() {
    setEditingGroup(null);
    setCourseName('');
    setGroupName('');
    setInstructorName('');
    setSchedule('');
    setPriceEgp('');
    setGroupError(null);
    setShowGroupModal(true);
  }

  function openEditGroup(group: CourseGroup) {
    setEditingGroup(group);
    setCourseName(group.courseName);
    setGroupName(group.groupName);
    setInstructorName(group.instructorName);
    setSchedule(group.schedule);
    setPriceEgp((group.pricePiasters / 100).toFixed(2));
    setGroupError(null);
    setShowGroupModal(true);
  }

  async function handleSaveGroup(e: React.FormEvent) {
    e.preventDefault();
    setGroupError(null);
    const pricePiasters = egpToPiasters(priceEgp);
    if (pricePiasters < 0) {
      setGroupError('السعر غير صالح.');
      return;
    }

    setGroupBusy(true);
    try {
      if (editingGroup) {
        await api.updateCourseGroup(editingGroup.id, {
          courseName: courseName.trim(),
          groupName: groupName.trim(),
          instructorName: instructorName.trim(),
          schedule: schedule.trim(),
          pricePiasters,
        });
        onNotify('success', 'تم تحديث بيانات المجموعة بنجاح.');
      } else {
        await api.createCourseGroup({
          courseName: courseName.trim(),
          groupName: groupName.trim(),
          instructorName: instructorName.trim(),
          schedule: schedule.trim(),
          pricePiasters,
        });
        onNotify('success', 'تم إضافة الكورس والمجموعة بنجاح.');
      }
      setShowGroupModal(false);
      await onRefreshCourses();
    } catch (err) {
      setGroupError(err instanceof Error ? err.message : 'تعذر حفظ المجموعة.');
    } finally {
      setGroupBusy(false);
    }
  }

  function openEnrollModal(defaultGroupId?: number) {
    const gid = defaultGroupId || courseGroups[0]?.id || 0;
    const grp = courseGroups.find((g) => g.id === gid);
    setEnrollGroupId(gid);
    setStudentName('');
    setStudentPhone('');
    setAgreedPriceEgp(grp ? (grp.pricePiasters / 100).toFixed(2) : '');
    setEnrollNotes('');
    setEnrollError(null);
    setShowEnrollModal(true);
  }

  async function handleEnrollStudent(e: React.FormEvent) {
    e.preventDefault();
    setEnrollError(null);
    if (!enrollGroupId) {
      setEnrollError('يرجى اختيار المجموعة أولًا.');
      return;
    }
    const agreedPricePiasters = egpToPiasters(agreedPriceEgp);
    if (agreedPricePiasters < 0) {
      setEnrollError('المبلغ المتفق عليه غير صالح.');
      return;
    }

    setEnrollBusy(true);
    try {
      const created = await api.enrollStudent({
        courseGroupId: enrollGroupId,
        studentName: studentName.trim(),
        studentPhone: studentPhone.trim(),
        agreedPricePiasters,
        notes: enrollNotes.trim() || null,
      });
      setShowEnrollModal(false);
      await onRefreshCourses();
      onNotify(
        'success',
        `تم تسجيل الطالب "${created.studentName}" بنجاح (لا يُسجل إيراد إلا عند تحصيل دفعة).`
      );
    } catch (err) {
      setEnrollError(err instanceof Error ? err.message : 'تعذر تسجيل الطالب.');
    } finally {
      setEnrollBusy(false);
    }
  }

  function buildPaymentReceipt(
    enrollment: StudentEnrollment,
    payment: CoursePayment
  ): ReceiptData {
    return {
      kind: 'course_payment',
      referenceNumber: `دفعة كورس #${payment.id}`,
      customerLabel: `${enrollment.studentName} (${enrollment.studentPhone})`,
      dateTimeIso: payment.paidAt,
      paymentMethod: payment.paymentMethod,
      cashierName: payment.receivedByName,
      courseDetails: {
        courseName: enrollment.courseName,
        groupName: enrollment.groupName,
        agreedPricePiasters: enrollment.agreedPricePiasters,
        totalPaidPiasters: enrollment.paidPiasters,
        remainingPiasters: enrollment.remainingPiasters,
      },
      totalPiasters: payment.amountPiasters,
    };
  }

  return (
    <div className="space-y-6">
      {/* Top KPI Summary */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-3 gap-4 divide-y sm:divide-y-0 sm:divide-x sm:divide-x-reverse divide-slate-200">
        <div>
          <div className="text-xs font-medium text-slate-500">
            إجمالي المطلوب من الطلاب ({enrollments.length} طالب)
          </div>
          <div className="text-2xl font-extrabold text-slate-900 tabular-nums mt-1">
            {formatEgp(totalAgreed)}
          </div>
        </div>
        <div className="pt-3 sm:pt-0 sm:pr-5">
          <div className="text-xs font-medium text-slate-500">
            إجمالي المحصّل فعليًا
          </div>
          <div className="text-2xl font-extrabold text-emerald-700 tabular-nums mt-1">
            {formatEgp(totalPaid)}
          </div>
        </div>
        <div className="pt-3 sm:pt-0 sm:pr-5">
          <div className="text-xs font-medium text-slate-500">
            المتبقي على طلاب الكورسات (ذمم غير محصلة)
          </div>
          <div className="text-2xl font-extrabold text-amber-700 tabular-nums mt-1">
            {formatEgp(totalRemaining)}
          </div>
        </div>
      </div>

      {/* Tabs & Action Buttons */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex p-1 bg-slate-200/70 rounded-lg">
          <button
            type="button"
            onClick={() => setTab('students')}
            className={`px-4 py-2 text-sm font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
              tab === 'students'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            الطلاب والدفعات ({enrollments.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('groups')}
            className={`px-4 py-2 text-sm font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
              tab === 'groups'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            الكورسات والمجموعات ({courseGroups.length})
          </button>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            disabled={courseGroups.length === 0}
            onClick={() => openEnrollModal()}
            className="h-11 px-4 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white font-semibold text-sm flex items-center gap-2 cursor-pointer whitespace-nowrap"
          >
            <UserPlus className="w-4 h-4" />
            <span>تسجيل طالب جديد</span>
          </button>

          {isAdmin && (
            <button
              type="button"
              onClick={openNewGroup}
              className="h-11 px-4 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm flex items-center gap-2 cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة كورس ومجموعة</span>
            </button>
          )}
        </div>
      </div>

      {/* TAB 1: STUDENTS & PAYMENTS */}
      {tab === 'students' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-3.5 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="بحث باسم الطالب أو رقم الموبايل..."
                className="w-full h-10 pr-9 pl-3 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>

            <select
              value={groupFilter}
              onChange={(e) => setGroupFilter(e.target.value)}
              className="h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
            >
              <option value="all">كل المجموعات</option>
              {courseGroups.map((g) => (
                <option key={g.id} value={String(g.id)}>
                  {g.courseName} — {g.groupName}
                </option>
              ))}
            </select>

            <select
              value={balanceFilter}
              onChange={(e) =>
                setBalanceFilter(e.target.value as 'all' | 'remaining' | 'paid')
              }
              className="h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
            >
              <option value="all">الكل (مدفوع + متبقي)</option>
              <option value="remaining">عليهم مبالغ متبقية فقط</option>
              <option value="paid">مسدّدون بالكامل فقط</option>
            </select>
          </div>

          {filteredEnrollments.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-2">
              <p className="font-semibold text-slate-800">
                لا يوجد طلاب مطابقون للبحث حاليًا
              </p>
              <p className="text-sm text-slate-500">
                {courseGroups.length === 0
                  ? 'ابدأ بإضافة كورس ومجموعة أولًا ثم سجّل الطلاب فيها.'
                  : 'اضغط «تسجيل طالب جديد» لإضافة طالب ومتابعة أقساطه.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredEnrollments.map((enrollment) => {
                const isExpanded = expandedEnrollmentId === enrollment.id;
                return (
                  <div
                    key={enrollment.id}
                    className="bg-white border border-slate-200 rounded-xl overflow-hidden"
                  >
                    <div className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-base font-bold text-slate-900">
                            {enrollment.studentName}
                          </h3>
                          <span className="text-xs font-mono text-slate-500" dir="ltr">
                            {enrollment.studentPhone}
                          </span>
                        </div>
                        <div className="text-xs text-slate-600 flex items-center gap-1.5 flex-wrap">
                          <span className="font-semibold text-slate-800">
                            {enrollment.courseName}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{enrollment.groupName}</span>
                          <span aria-hidden="true">·</span>
                          <span>المدرب: {enrollment.instructorName}</span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-5">
                        <div className="grid grid-cols-3 gap-4 text-center">
                          <div>
                            <div className="text-xs text-slate-500">المطلوب</div>
                            <div className="text-sm font-bold text-slate-900 tabular-nums">
                              {formatEgp(enrollment.agreedPricePiasters)}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs text-slate-500">المدفوع</div>
                            <div className="text-sm font-bold text-emerald-700 tabular-nums">
                              {formatEgp(enrollment.paidPiasters)}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs text-slate-500">المتبقي</div>
                            <div
                              className={`text-sm font-extrabold tabular-nums ${
                                enrollment.remainingPiasters > 0
                                  ? 'text-amber-700'
                                  : 'text-emerald-700'
                              }`}
                            >
                              {formatEgp(enrollment.remainingPiasters)}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {enrollment.remainingPiasters > 0 && (
                            <button
                              type="button"
                              onClick={() =>
                                setPaymentEnrollmentId(enrollment.id)
                              }
                              className="h-10 px-3.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                            >
                              <CreditCard className="w-4 h-4" />
                              <span>تحصيل دفعة</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedEnrollmentId(
                                isExpanded ? null : enrollment.id
                              )
                            }
                            className="h-10 px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                          >
                            <span>سجل الدفعات ({enrollment.payments.length})</span>
                            {isExpanded ? (
                              <ChevronUp className="w-4 h-4" />
                            ) : (
                              <ChevronDown className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="px-5 py-4 bg-slate-50 border-t border-slate-200">
                        {enrollment.payments.length === 0 ? (
                          <p className="text-xs text-slate-500">
                            لم يتم تحصيل أي دفعات لهذا الطالب بعد. التسجيل وحده لا يُحتسب ضمن إيرادات الشهر.
                          </p>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs text-right">
                              <thead className="text-slate-500 border-b border-slate-200">
                                <tr>
                                  <th className="pb-2 pl-3 font-semibold">
                                    تاريخ التحصيل
                                  </th>
                                  <th className="pb-2 pl-3 font-semibold">
                                    المبلغ المحصّل
                                  </th>
                                  <th className="pb-2 pl-3 font-semibold">
                                    الوسيلة
                                  </th>
                                  <th className="pb-2 pl-3 font-semibold">
                                    المستلم
                                  </th>
                                  <th className="pb-2 pl-3 font-semibold">
                                    ملاحظات
                                  </th>
                                  <th className="pb-2 font-semibold text-left">
                                    إيصال
                                  </th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-200/70">
                                {enrollment.payments.map((p) => (
                                  <tr key={p.id}>
                                    <td className="py-2.5 pl-3 tabular-nums text-slate-700 whitespace-nowrap">
                                      {formatCairoDateArabic(p.cairoDate)}
                                    </td>
                                    <td className="py-2.5 pl-3 tabular-nums font-bold text-emerald-700 whitespace-nowrap">
                                      {formatEgp(p.amountPiasters)}
                                      {p.refundedPiasters > 0 && (
                                        <span className="text-amber-700 font-normal mr-1.5">
                                          (مسترد: {formatEgp(p.refundedPiasters)})
                                        </span>
                                      )}
                                    </td>
                                    <td className="py-2.5 pl-3 text-slate-700">
                                      {PAYMENT_METHOD_LABELS[p.paymentMethod]}
                                    </td>
                                    <td className="py-2.5 pl-3 text-slate-600">
                                      {p.receivedByName}
                                    </td>
                                    <td className="py-2.5 pl-3 text-slate-500">
                                      {p.notes || '—'}
                                    </td>
                                    <td className="py-2.5 text-left">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          onShowReceipt(
                                            buildPaymentReceipt(enrollment, p)
                                          )
                                        }
                                        className="inline-flex items-center gap-1 text-teal-700 hover:text-teal-900 font-semibold cursor-pointer"
                                      >
                                        <Printer className="w-3.5 h-3.5" />
                                        <span>طباعة</span>
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: COURSE GROUPS */}
      {tab === 'groups' && (
        <div>
          {courseGroups.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-3">
              <p className="font-semibold text-slate-800">
                لم يتم إضافة كورسات أو مجموعات بعد
              </p>
              {isAdmin && (
                <button
                  type="button"
                  onClick={openNewGroup}
                  className="h-10 px-5 rounded-lg bg-teal-700 text-white text-sm font-semibold cursor-pointer"
                >
                  إضافة أول كورس ومجموعة
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {courseGroups.map((group) => (
                <div
                  key={group.id}
                  className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-4"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-base font-extrabold text-slate-900">
                          {group.courseName}
                        </h3>
                        <p className="text-sm text-teal-800 font-semibold">
                          {group.groupName}
                        </p>
                      </div>
                      <div className="text-left shrink-0">
                        <div className="text-base font-extrabold text-slate-900 tabular-nums">
                          {formatEgp(group.pricePiasters)}
                        </div>
                        <div className="text-xs text-slate-500">سعر الكورس</div>
                      </div>
                    </div>

                    <div className="text-xs text-slate-600 space-y-1 pt-2 border-t border-slate-100">
                      <div>
                        <span className="text-slate-400">المدرب: </span>
                        <span className="font-medium text-slate-800">
                          {group.instructorName}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400">المواعيد: </span>
                        <span className="font-medium text-slate-800">
                          {group.schedule}
                        </span>
                      </div>
                    </div>

                    <div className="pt-2 grid grid-cols-3 gap-2 text-xs bg-slate-50 p-3 rounded-lg border border-slate-100">
                      <div>
                        <div className="text-slate-500">الطلاب</div>
                        <div className="font-bold text-slate-900 tabular-nums mt-0.5">
                          {group.studentCount}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500">المحصّل</div>
                        <div className="font-bold text-emerald-700 tabular-nums mt-0.5">
                          {formatEgp(group.totalPaidPiasters)}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500">المتبقي</div>
                        <div className="font-bold text-amber-700 tabular-nums mt-0.5">
                          {formatEgp(group.totalRemainingPiasters)}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => openEnrollModal(group.id)}
                      className="h-10 px-4 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold cursor-pointer"
                    >
                      + تسجيل طالب في المجموعة
                    </button>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => openEditGroup(group)}
                        className="h-10 px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center gap-1 cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>تعديل</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ==================== ADD / EDIT COURSE GROUP MODAL ==================== */}
      {showGroupModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-lg bg-white rounded-xl border border-slate-200 overflow-hidden my-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">
                {editingGroup ? 'تعديل الكورس والمجموعة' : 'إضافة كورس ومجموعة جديدة'}
              </h2>
              <button
                type="button"
                onClick={() => setShowGroupModal(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveGroup} className="p-5 space-y-4">
              {groupError && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">
                  <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
                  <span>{groupError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    اسم الكورس
                  </label>
                  <input
                    type="text"
                    required
                    value={courseName}
                    onChange={(e) => setCourseName(e.target.value)}
                    placeholder="مثال: تطوير الويب React & Node"
                    className="w-full h-11 px-3.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    اسم المجموعة
                  </label>
                  <input
                    type="text"
                    required
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    placeholder="مثال: مجموعة نوفمبر - مسائي"
                    className="w-full h-11 px-3.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    اسم المدرب
                  </label>
                  <input
                    type="text"
                    required
                    value={instructorName}
                    onChange={(e) => setInstructorName(e.target.value)}
                    placeholder="مثال: م. أحمد حسن"
                    className="w-full h-11 px-3.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    السعر (ج.م)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    dir="ltr"
                    value={priceEgp}
                    onChange={(e) => setPriceEgp(e.target.value)}
                    placeholder="1500.00"
                    className="w-full h-11 px-3.5 rounded-lg border border-slate-300 text-base font-mono text-left focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  المواعيد
                </label>
                <input
                  type="text"
                  required
                  value={schedule}
                  onChange={(e) => setSchedule(e.target.value)}
                  placeholder="مثال: السبت والثلاثاء من 6:00 م إلى 9:00 م"
                  className="w-full h-11 px-3.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>

              <div className="flex items-center gap-3 pt-1">
                <button
                  type="submit"
                  disabled={groupBusy}
                  className="flex-1 h-11 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white font-bold text-sm cursor-pointer"
                >
                  {groupBusy ? 'جاري الحفظ...' : 'حفظ الكورس'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowGroupModal(false)}
                  className="h-11 px-5 rounded-lg border border-slate-300 bg-white text-slate-700 text-sm font-medium cursor-pointer"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== ENROLL STUDENT MODAL ==================== */}
      {showEnrollModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-lg bg-white rounded-xl border border-slate-200 overflow-hidden my-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">
                تسجيل طالب جديد في كورس
              </h2>
              <button
                type="button"
                onClick={() => setShowEnrollModal(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleEnrollStudent} className="p-5 space-y-4">
              {enrollError && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">
                  <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
                  <span>{enrollError}</span>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  المجموعة
                </label>
                <select
                  value={enrollGroupId}
                  onChange={(e) => {
                    const gid = Number(e.target.value);
                    setEnrollGroupId(gid);
                    const grp = courseGroups.find((g) => g.id === gid);
                    if (grp) setAgreedPriceEgp((grp.pricePiasters / 100).toFixed(2));
                  }}
                  className="w-full h-11 px-3.5 rounded-lg border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                >
                  {courseGroups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.courseName} — {g.groupName} ({formatEgp(g.pricePiasters)})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    اسم الطالب
                  </label>
                  <input
                    type="text"
                    required
                    value={studentName}
                    onChange={(e) => setStudentName(e.target.value)}
                    placeholder="الاسم الثلاثي"
                    className="w-full h-11 px-3.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    رقم الموبايل
                  </label>
                  <input
                    type="tel"
                    required
                    dir="ltr"
                    value={studentPhone}
                    onChange={(e) => setStudentPhone(e.target.value)}
                    placeholder="01012345678"
                    className="w-full h-11 px-3.5 rounded-lg border border-slate-300 text-sm font-mono text-left focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  المبلغ المتفق عليه (ج.م)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  dir="ltr"
                  value={agreedPriceEgp}
                  onChange={(e) => setAgreedPriceEgp(e.target.value)}
                  className="w-full h-11 px-3.5 rounded-lg border border-slate-300 text-base font-mono text-left focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
                <p className="text-xs text-slate-500 mt-1">
                  التسجيل وحده لا يُسجل كإيراد؛ يُحسب الإيراد عند تحصيل كل دفعة بتاريخها الفعلي.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  ملاحظات (اختياري)
                </label>
                <input
                  type="text"
                  value={enrollNotes}
                  onChange={(e) => setEnrollNotes(e.target.value)}
                  placeholder="مثال: خصم طلاب / تقسيط على دفعتين"
                  className="w-full h-11 px-3.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>

              <div className="flex items-center gap-3 pt-1">
                <button
                  type="submit"
                  disabled={enrollBusy}
                  className="flex-1 h-11 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white font-bold text-sm cursor-pointer"
                >
                  {enrollBusy ? 'جاري التسجيل...' : 'تأكيد تسجيل الطالب'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowEnrollModal(false)}
                  className="h-11 px-5 rounded-lg border border-slate-300 bg-white text-slate-700 text-sm font-medium cursor-pointer"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== RECORD PAYMENT MODAL ==================== */}
      {paymentEnrollmentId !== null && (
        <StudentPaymentModal
          enrollments={enrollments}
          initialEnrollmentId={paymentEnrollmentId}
          onClose={() => setPaymentEnrollmentId(null)}
          onSuccess={async (receipt, msg) => {
            setPaymentEnrollmentId(null);
            await onRefreshCourses();
            onNotify('success', msg);
            onShowReceipt(receipt);
          }}
        />
      )}
    </div>
  );
}
