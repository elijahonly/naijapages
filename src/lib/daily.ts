import { useEffect, useState } from 'react';
import { SITE_TZ } from './config';

const dateParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: SITE_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function partsOf(d: Date) {
  const out: Record<string, number> = {};
  for (const p of dateParts.formatToParts(d)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out;
}

/** Calendar day in Nigerian time, e.g. "2026-10-31". Everyone worldwide gets the same key at the same moment. */
export function dayKey(d: Date = new Date()): string {
  const p = partsOf(d);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Milliseconds until the next midnight in Nigerian time. */
export function msUntilNextDay(d: Date = new Date()): number {
  const p = partsOf(d);
  const elapsed = ((p.hour * 60 + p.minute) * 60 + p.second) * 1000 + d.getMilliseconds();
  return 24 * 60 * 60 * 1000 - elapsed;
}

/**
 * Small, fast, well-distributed 32-bit string hash (xmur3).
 * Deterministic across browsers, so every visitor computes the same result.
 */
export function hashString(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

interface Scored<T> {
  item: T;
  id: string;
  score: number;
}

const byScore = <T,>(a: Scored<T>, b: Scored<T>) =>
  a.score - b.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Picks `count` items "at random" for a given day.
 *
 * Each item gets a pseudo-random score from hash(day + salt + id) and the
 * lowest scores win. That means:
 *  - every visitor sees the same picks on the same day,
 *  - the picks change at midnight (Nigerian time),
 *  - a listing added mid-day only changes the picks if it happens to win a
 *    slot, instead of reshuffling the whole carousel.
 */
export function pickDaily<T>(
  items: readonly T[],
  idOf: (item: T) => string,
  count: number,
  day: string,
  salt = '',
): T[] {
  if (count <= 0 || items.length === 0) return [];
  const top: Scored<T>[] = [];
  for (const item of items) {
    const id = idOf(item);
    const s: Scored<T> = { item, id, score: hashString(`${day}|${salt}|${id}`) };
    if (top.length < count) {
      top.push(s);
      top.sort(byScore);
    } else if (byScore(s, top[top.length - 1]) < 0) {
      top[top.length - 1] = s;
      top.sort(byScore);
    }
  }
  return top.map((s) => s.item);
}

/** React hook: today's key, re-evaluated automatically at midnight (and when a sleeping tab wakes up). */
export function useDayKey(): string {
  const [key, setKey] = useState(() => dayKey());

  useEffect(() => {
    let timer: number | undefined;
    const schedule = () => {
      timer = window.setTimeout(() => {
        setKey(dayKey());
        schedule();
      }, msUntilNextDay() + 1000);
    };
    schedule();

    const onVisible = () => {
      if (document.visibilityState === 'visible') setKey(dayKey());
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (timer) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return key;
}
