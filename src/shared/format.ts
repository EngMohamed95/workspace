import type { LedgerEntryType, PaymentMethod, UserRole } from './types.ts';

export const CAIRO_TIMEZONE = 'Africa/Cairo';

export function egpToPiasters(egp: number | string): number {
  const num = typeof egp === 'string' ? Number(egp.trim()) : egp;
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100);
}

export function piastersToEgpNumber(piasters: number): number {
  return Math.round(piasters) / 100;
}

export function formatEgp(piasters: number, showSign = false): string {
  const abs = Math.abs(piasters) / 100;
  const formatted = abs.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const sign = piasters < 0 ? '-' : showSign && piasters > 0 ? '+' : '';
  return `${sign}${formatted} ج.م`;
}

export function formatEgpNumber(piasters: number): string {
  return (piasters / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function calculateSessionCostPiasters(
  durationMinutes: number,
  hourlyRatePiasters: number
): number {
  const safeMinutes = Math.max(0, Math.round(durationMinutes));
  return Math.round((safeMinutes * hourlyRatePiasters) / 60);
}

export function calculateDurationMinutes(startedAtIso: string, endedAtIso: string): number {
  const startMs = new Date(startedAtIso).getTime();
  const endMs = new Date(endedAtIso).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return 0;
  }
  return Math.round((endMs - startMs) / 60000);
}

export function formatDurationArabic(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  const hrs = Math.floor(safe / 60);
  const mins = safe % 60;
  if (hrs === 0) return `${mins} دقيقة`;
  if (mins === 0) return hrs === 1 ? 'ساعة واحدة' : hrs === 2 ? 'ساعتان' : `${hrs} ساعات`;
  const hrLabel = hrs === 1 ? 'ساعة' : hrs === 2 ? 'ساعتان' : `${hrs} ساعات`;
  return `${hrLabel} و ${mins} دقيقة`;
}

export function formatLiveTimer(startedAtIso: string, nowMs: number): string {
  const startMs = new Date(startedAtIso).getTime();
  const diffSec = Math.max(0, Math.floor((nowMs - startMs) / 1000));
  const hrs = Math.floor(diffSec / 3600);
  const mins = Math.floor((diffSec % 3600) / 60);
  const secs = diffSec % 60;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function getCairoDateParts(isoOrDate: string | Date): {
  cairoDate: string;
  cairoMonth: string;
} {
  const date = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: CAIRO_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const cairoDate = formatter.format(date); // YYYY-MM-DD
  return {
    cairoDate,
    cairoMonth: cairoDate.slice(0, 7), // YYYY-MM
  };
}

export function getCurrentCairoMonth(): string {
  return getCairoDateParts(new Date()).cairoMonth;
}

export function getCurrentCairoDate(): string {
  return getCairoDateParts(new Date()).cairoDate;
}

/**
 * Converts a Cairo calendar date (YYYY-MM-DD) into an ISO UTC timestamp anchored at 12:00 PM Cairo time,
 * guaranteeing that getCairoDateParts(result).cairoDate === cairoDate regardless of DST transitions.
 */
export function cairoDateToIsoNoon(cairoDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cairoDate)) {
    return new Date().toISOString();
  }
  // 10:00 UTC is always 12:00 or 13:00 in Africa/Cairo (UTC+2 / UTC+3)
  return `${cairoDate}T10:00:00.000Z`;
}

export function formatCairoTime(iso: string): string {
  return new Intl.DateTimeFormat('ar-EG', {
    timeZone: CAIRO_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso));
}

export function formatCairoDateTime(iso: string): string {
  return new Intl.DateTimeFormat('ar-EG', {
    timeZone: CAIRO_TIMEZONE,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso));
}

export function formatCairoDateArabic(cairoDate: string): string {
  const iso = cairoDateToIsoNoon(cairoDate);
  return new Intl.DateTimeFormat('ar-EG', {
    timeZone: CAIRO_TIMEZONE,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(iso));
}

export function formatCairoMonthArabic(cairoMonth: string): string {
  if (!/^\d{4}-\d{2}$/.test(cairoMonth)) return cairoMonth;
  const iso = `${cairoMonth}-15T10:00:00.000Z`;
  return new Intl.DateTimeFormat('ar-EG', {
    timeZone: CAIRO_TIMEZONE,
    year: 'numeric',
    month: 'long',
  }).format(new Date(iso));
}

export function shiftCairoMonth(cairoMonth: string, deltaMonths: number): string {
  const [y, m] = cairoMonth.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + deltaMonths, 15));
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'كاش',
  instapay: 'إنستاباي',
  e_wallet: 'محفظة إلكترونية',
  card: 'بطاقة بنكية',
};

export const LEDGER_TYPE_LABELS: Record<LedgerEntryType, string> = {
  session_revenue: 'تحصيل جلسة',
  drinks_revenue: 'تحصيل مشروبات',
  course_payment: 'دفعة كورس',
  other_revenue: 'إيراد تشغيلي آخر',
  expense: 'مصروف تشغيلي',
  refund: 'استرداد لعميل',
  owner_deposit: 'إيداع صاحب المكان',
  owner_withdrawal: 'سحب شخصي لصاحب المكان',
};

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'مدير',
  receptionist: 'موظف استقبال',
};

export function generateIdempotencyKey(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}
