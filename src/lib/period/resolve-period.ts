import { z } from 'zod';
import { AppError } from '../errors';

const DateOnlyRegex = /^\d{4}-\d{2}-\d{2}$/;

export type WeekStartsOn = 'monday' | 'sunday';

export type PeriodPreset =
  | 'this_week'
  | 'next_week'
  | 'last_week'
  | 'this_month'
  | 'next_month'
  | 'last_month';

export type PeriodUnit = 'day' | 'week' | 'month';
export type PeriodDirection = 'past' | 'next';

export type PeriodInput =
  | { kind: 'preset'; preset: PeriodPreset }
  | { kind: 'relative'; direction: PeriodDirection; unit: PeriodUnit; count: number };

export const PeriodInputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('preset'),
    preset: z.enum(['this_week', 'next_week', 'last_week', 'this_month', 'next_month', 'last_month']),
  }),
  z.object({
    kind: z.literal('relative'),
    direction: z.enum(['past', 'next']),
    unit: z.enum(['day', 'week', 'month']),
    count: z.number().int().min(1).max(52),
  }),
]);

export type ResolvedPeriod = {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  source: 'explicit' | 'period';
};

export type ResolvePeriodOptions = {
  period?: PeriodInput;
  startDate?: string;
  endDate?: string;
  now?: Date;
  weekStartsOn?: WeekStartsOn;
};

function formatDateOnlyUtc(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseDateOnlyUtc(value: string): Date {
  if (!DateOnlyRegex.test(value)) {
    throw new AppError(`Invalid date format: ${value}. Expected YYYY-MM-DD.`, {
      status: 400,
      code: 'invalid_date',
    });
  }

  const [yStr, mStr, dStr] = value.split('-');
  const year = Number(yStr);
  const month = Number(mStr);
  const day = Number(dStr);
  const date = new Date(Date.UTC(year, month - 1, day));

  // Validate that Date didn't overflow (e.g., 2025-02-31).
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new AppError(`Invalid calendar date: ${value}.`, { status: 400, code: 'invalid_date' });
  }

  return date;
}

function startOfDayUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDaysUtc(date: Date, days: number): Date {
  const ms = date.getTime() + days * 24 * 60 * 60 * 1000;
  return new Date(ms);
}

function startOfWeekUtc(date: Date, weekStartsOn: WeekStartsOn): Date {
  const day = date.getUTCDay(); // 0=Sun,1=Mon,...
  const offset =
    weekStartsOn === 'monday'
      ? (day + 6) % 7 // Mon=0 ... Sun=6
      : day; // Sun=0 ... Sat=6
  return addDaysUtc(date, -offset);
}

function startOfMonthUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function endOfMonthUtc(date: Date): Date {
  // Day 0 of next month = last day of current month
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

function addMonthsUtc(date: Date, months: number): Date {
  // Always operate on first-of-month when used in this module to avoid day overflow.
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function resolveFromPreset(nowUtc: Date, preset: PeriodPreset, weekStartsOn: WeekStartsOn): ResolvedPeriod {
  const today = startOfDayUtc(nowUtc);
  const thisWeekStart = startOfWeekUtc(today, weekStartsOn);
  const thisWeekEnd = addDaysUtc(thisWeekStart, 6);
  const thisMonthStart = startOfMonthUtc(today);
  const thisMonthEnd = endOfMonthUtc(today);

  switch (preset) {
    case 'this_week':
      return {
        startDate: formatDateOnlyUtc(thisWeekStart),
        endDate: formatDateOnlyUtc(thisWeekEnd),
        source: 'period',
      };
    case 'next_week': {
      const start = addDaysUtc(thisWeekStart, 7);
      const end = addDaysUtc(thisWeekEnd, 7);
      return { startDate: formatDateOnlyUtc(start), endDate: formatDateOnlyUtc(end), source: 'period' };
    }
    case 'last_week': {
      const start = addDaysUtc(thisWeekStart, -7);
      const end = addDaysUtc(thisWeekEnd, -7);
      return { startDate: formatDateOnlyUtc(start), endDate: formatDateOnlyUtc(end), source: 'period' };
    }
    case 'this_month':
      return {
        startDate: formatDateOnlyUtc(thisMonthStart),
        endDate: formatDateOnlyUtc(thisMonthEnd),
        source: 'period',
      };
    case 'next_month': {
      const start = addMonthsUtc(thisMonthStart, 1);
      const end = endOfMonthUtc(start);
      return { startDate: formatDateOnlyUtc(start), endDate: formatDateOnlyUtc(end), source: 'period' };
    }
    case 'last_month': {
      const start = addMonthsUtc(thisMonthStart, -1);
      const end = endOfMonthUtc(start);
      return { startDate: formatDateOnlyUtc(start), endDate: formatDateOnlyUtc(end), source: 'period' };
    }
  }
}

function resolveFromRelative(nowUtc: Date, direction: PeriodDirection, unit: PeriodUnit, count: number): ResolvedPeriod {
  const today = startOfDayUtc(nowUtc);

  if (unit === 'month') {
    // Interpret as whole calendar months (excluding the current partial month), which matches "next month" / "last month".
    if (direction === 'next') {
      const start = addMonthsUtc(startOfMonthUtc(today), 1);
      const end = endOfMonthUtc(addMonthsUtc(start, count - 1));
      return { startDate: formatDateOnlyUtc(start), endDate: formatDateOnlyUtc(end), source: 'period' };
    }
    const end = endOfMonthUtc(addMonthsUtc(startOfMonthUtc(today), -1));
    const start = addMonthsUtc(startOfMonthUtc(end), -(count - 1));
    return { startDate: formatDateOnlyUtc(start), endDate: formatDateOnlyUtc(end), source: 'period' };
  }

  const unitDays = unit === 'week' ? 7 : 1;
  const totalDays = count * unitDays;

  if (direction === 'next') {
    const start = today;
    const end = addDaysUtc(start, totalDays - 1);
    return { startDate: formatDateOnlyUtc(start), endDate: formatDateOnlyUtc(end), source: 'period' };
  }

  const end = today;
  const start = addDaysUtc(end, -(totalDays - 1));
  return { startDate: formatDateOnlyUtc(start), endDate: formatDateOnlyUtc(end), source: 'period' };
}

export function resolvePeriod(options: ResolvePeriodOptions): ResolvedPeriod {
  const nowUtc = options.now ?? new Date();
  const weekStartsOn: WeekStartsOn = options.weekStartsOn ?? 'monday';

  const hasExplicit = options.startDate !== undefined || options.endDate !== undefined;
  const hasPeriod = options.period !== undefined;

  if (hasExplicit && hasPeriod) {
    throw new AppError('Provide either (startDate/endDate) or period, not both.', {
      status: 400,
      code: 'invalid_period',
    });
  }

  if (hasExplicit) {
    if (!options.startDate || !options.endDate) {
      throw new AppError('Both startDate and endDate are required when using explicit dates.', {
        status: 400,
        code: 'invalid_period',
      });
    }
    const start = parseDateOnlyUtc(options.startDate);
    const end = parseDateOnlyUtc(options.endDate);
    if (start.getTime() > end.getTime()) {
      throw new AppError('startDate must be <= endDate.', { status: 400, code: 'invalid_period' });
    }
    return { startDate: options.startDate, endDate: options.endDate, source: 'explicit' };
  }

  const period = options.period;

  if (!period) {
    // Default behavior across tools.
    return resolveFromPreset(nowUtc, 'this_week', weekStartsOn);
  }

  if (period.kind === 'preset') {
    return resolveFromPreset(nowUtc, period.preset, weekStartsOn);
  }

  return resolveFromRelative(nowUtc, period.direction, period.unit, period.count);
}
