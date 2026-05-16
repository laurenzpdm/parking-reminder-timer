import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addMinutes,
  completeSession,
  createParkingSession,
  formatCountdown,
  getMascotMood,
  getProgress,
  hasFreeTrial,
  packageIdForPlan,
  planForFreeTrialPreference,
  priceLabelForPlan,
  productIdForPlan,
  REVENUECAT_OFFERING_ID,
} from '../src/parkingSession';

test('creates a bounded parking session with a warning before expiry', () => {
  const session = createParkingSession({ durationMinutes: 2, startedAt: 1_000, note: 'Level 3' });
  assert.equal(session.durationMinutes, 5);
  assert.equal(session.endsAt, 301_000);
  assert.equal(session.warningAt, 241_000);
});

test('adds minutes without losing the parking note', () => {
  const session = createParkingSession({ durationMinutes: 30, startedAt: 10_000, note: 'Green zone' });
  const extended = addMinutes(session, 15);
  assert.equal(extended.durationMinutes, 45);
  assert.equal(extended.note, 'Green zone');
});

test('formats countdown and progress for active sessions', () => {
  const session = createParkingSession({ durationMinutes: 90, startedAt: 0 });
  assert.equal(formatCountdown(61 * 60_000), '1h 01m');
  assert.equal(formatCountdown(59 * 60_000), '59m');
  assert.equal(getProgress(session, 45 * 60_000), 0.5);
});

test('updates ticket-free streak once per day', () => {
  const day = 1_700_000_000_000;
  const first = completeSession({ ticketFreeDays: 0, sessionsCompleted: 0 }, day);
  const sameDay = completeSession(first, day + 60_000);
  const nextDay = completeSession(sameDay, day + 25 * 60 * 60_000);
  assert.equal(first.ticketFreeDays, 1);
  assert.equal(sameDay.ticketFreeDays, 1);
  assert.equal(nextDay.ticketFreeDays, 2);
});

test('maps mascot mood and plan ids', () => {
  const session = createParkingSession({ durationMinutes: 20, startedAt: 0 });
  assert.equal(getMascotMood(session, 11 * 60_000, { ticketFreeDays: 0, sessionsCompleted: 0 }), 'watching');
  assert.equal(getMascotMood(null, 0, { ticketFreeDays: 7, sessionsCompleted: 7 }), 'proud');
  assert.equal(productIdForPlan('annual'), 'parking_reminder_timer_annual');
});

test('keeps RevenueCat offering and package identifiers stable', () => {
  assert.equal(REVENUECAT_OFFERING_ID, 'parking_timer_default');
  assert.equal(packageIdForPlan('weekly'), '$rc_weekly');
  assert.equal(packageIdForPlan('annual'), '$rc_annual');
});

test('maps free trial toggle to weekly plan only', () => {
  assert.equal(planForFreeTrialPreference(true), 'weekly');
  assert.equal(planForFreeTrialPreference(false), 'annual');
  assert.equal(hasFreeTrial('weekly'), true);
  assert.equal(hasFreeTrial('annual'), false);
});

test('keeps weekly higher and annual lower to nudge annual choice', () => {
  assert.equal(priceLabelForPlan('weekly'), '$4.99 / week');
  assert.equal(priceLabelForPlan('annual'), '$19.99 / year');
});
