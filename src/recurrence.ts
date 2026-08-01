import type { RecurrenceRule, Weekday } from './types';

export const MAX_RECURRENCE_OCCURRENCES = 2000;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const FREQUENCIES = new Set(['daily', 'weekly', 'monthly']);

function parseDate(value: unknown) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return date;
}

function addUtcDay(date: Date) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

function sortedUniqueNumbers(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter((item): item is number => typeof item === 'number' && Number.isInteger(item)),
    ),
  ].sort((left, right) => left - right);
}

function validWeekdays(value: unknown): value is Weekday[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      item => typeof item === 'number' && Number.isInteger(item) && item >= 0 && item <= 6,
    )
  );
}

function validMonthDays(value: unknown) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      item => typeof item === 'number' && Number.isInteger(item) && item >= 1 && item <= 31,
    )
  );
}

export function recurrenceRuleError(value: unknown): string | null {
  if (!value || typeof value !== 'object') return '請先設定重複排程。';
  const rule = value as Partial<RecurrenceRule>;
  if (!FREQUENCIES.has(String(rule.frequency))) return '重複頻率不正確。';
  const start = parseDate(rule.startDate);
  const end = parseDate(rule.endDate);
  if (!start || !end) return '重複排程的起訖日期不正確。';
  if (end < start) return '重複排程的結束日期不可早於開始日期。';
  if (
    typeof rule.hoursPerOccurrence !== 'number' ||
    !Number.isFinite(rule.hoursPerOccurrence) ||
    rule.hoursPerOccurrence <= 0
  )
    return '每次安排時數必須大於 0。';
  if (rule.frequency === 'weekly' && !validWeekdays(rule.weekdays))
    return '每週重複至少要選擇一天。';
  if (rule.frequency === 'monthly' && !validMonthDays(rule.monthDays))
    return '每月重複至少要選擇一個日期。';
  return null;
}

export function isValidRecurrenceRule(value: unknown): value is RecurrenceRule {
  return recurrenceRuleError(value) === null;
}

export function normalizeRecurrenceRule(value: unknown): RecurrenceRule | null {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== 'object') return null;
  const rule = value as Partial<RecurrenceRule>;
  const normalized: RecurrenceRule = {
    frequency:
      rule.frequency === 'daily' || rule.frequency === 'weekly' || rule.frequency === 'monthly'
        ? rule.frequency
        : 'daily',
    startDate: typeof rule.startDate === 'string' ? rule.startDate : '',
    endDate: typeof rule.endDate === 'string' ? rule.endDate : '',
    hoursPerOccurrence:
      typeof rule.hoursPerOccurrence === 'number' && Number.isFinite(rule.hoursPerOccurrence)
        ? Math.max(0, rule.hoursPerOccurrence)
        : 0,
    weekdays: sortedUniqueNumbers(rule.weekdays).filter(
      (item): item is Weekday => item >= 0 && item <= 6,
    ),
    monthDays: sortedUniqueNumbers(rule.monthDays).filter(item => item >= 1 && item <= 31),
  };
  return isValidRecurrenceRule(normalized) ? normalized : null;
}

export function recurrenceDates(rule: RecurrenceRule): string[] {
  const error = recurrenceRuleError(rule);
  if (error) throw new Error(error);
  const start = parseDate(rule.startDate)!;
  const end = parseDate(rule.endDate)!;
  const dates: string[] = [];
  const weekdays = new Set(rule.weekdays);
  const monthDays = new Set(rule.monthDays);

  for (let current = start; current <= end; current = addUtcDay(current)) {
    const matches =
      rule.frequency === 'daily' ||
      (rule.frequency === 'weekly' && weekdays.has(current.getUTCDay() as Weekday)) ||
      (rule.frequency === 'monthly' && monthDays.has(current.getUTCDate()));
    if (matches) dates.push(current.toISOString().slice(0, 10));
    if (dates.length > MAX_RECURRENCE_OCCURRENCES) {
      throw new Error(`重複排程不可超過 ${MAX_RECURRENCE_OCCURRENCES} 次。`);
    }
  }
  return dates;
}
