// Daily submission limit for techs. One number for the whole team,
// stored in the settings table so the admin can change it any time
// from the Team page. Blank / unset = no limit.
//
// A "submission" is a project sent for approval (pending or
// published). Drafts don't count; deleting a submission frees its
// slot. The day resets at midnight in the business's time zone, not
// UTC, so a tech working late doesn't get an early reset.
// Admins are never limited.

import { getSetting, setSetting, deleteSetting, countSubmittedSince } from './db.js';

const KEY = 'daily_submission_limit';
const TIME_ZONE = process.env.BUSINESS_TIMEZONE || 'America/Chicago';

export function getDailyLimit() {
  const n = parseInt(getSetting(KEY), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Accepts a number or a form string. Anything that isn't a positive
// whole number clears the limit.
export function setDailyLimit(value) {
  const n = parseInt(String(value ?? '').trim(), 10);
  if (Number.isInteger(n) && n > 0) setSetting(KEY, String(n));
  else deleteSetting(KEY);
}

// Today's midnight in TIME_ZONE, expressed as a UTC timestamp string
// comparable with SQLite's datetime('now') values.
export function dayStartUtc(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: TIME_ZONE, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(now).map(p => [p.type, p.value])
  );
  // UTC instant of 00:00 on the local calendar date, before offset.
  const guess = Date.UTC(+parts.year, +parts.month - 1, +parts.day);
  // Zone offset at that instant. DST switches happen at 2am local, so
  // the offset at local midnight matches the offset at `guess`.
  const offsetMs = zoneOffsetMs(new Date(guess));
  return new Date(guess - offsetMs).toISOString().slice(0, 19).replace('T', ' ');
}

function zoneOffsetMs(date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: TIME_ZONE, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(date).map(x => [x.type, x.value])
  );
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - date.getTime();
}

// Quota for a user today. Returns null when no limit applies (admin,
// or no limit configured) so callers can just check `quota?.reached`.
export function submissionQuota(user, now = new Date()) {
  if (!user || user.role === 'admin') return null;
  const limit = getDailyLimit();
  if (!limit) return null;
  const used = countSubmittedSince(user.id, dayStartUtc(now));
  return {
    limit,
    used,
    remaining: Math.max(0, limit - used),
    reached: used >= limit,
  };
}
