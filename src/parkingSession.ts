export type ParkingPlan = 'weekly' | 'annual';

export type ParkingSessionInput = {
  durationMinutes: number;
  startedAt: number;
  note?: string;
  locationLabel?: string;
};

export type ParkingSession = ParkingSessionInput & {
  id: string;
  endsAt: number;
  warningAt: number;
};

export type StreakState = {
  ticketFreeDays: number;
  sessionsCompleted: number;
  lastCompletedAt?: number;
};

export const WEEKLY_PRODUCT_ID = 'parking_reminder_timer_weekly';
export const ANNUAL_PRODUCT_ID = 'parking_reminder_timer_annual';
export const REVENUECAT_OFFERING_ID = 'parking_timer_default';

export function createParkingSession(input: ParkingSessionInput): ParkingSession {
  const safeDuration = Math.max(5, Math.min(24 * 60, Math.round(input.durationMinutes)));
  const endsAt = input.startedAt + safeDuration * 60_000;

  return {
    ...input,
    durationMinutes: safeDuration,
    id: `parking-${input.startedAt}-${safeDuration}`,
    endsAt,
    warningAt: endsAt - Math.min(10, Math.max(1, Math.floor(safeDuration / 4))) * 60_000,
  };
}

export function addMinutes(session: ParkingSession, minutes: number): ParkingSession {
  const added = Math.max(1, Math.min(180, Math.round(minutes)));
  const durationMinutes = session.durationMinutes + added;
  return createParkingSession({
    durationMinutes,
    startedAt: session.startedAt,
    note: session.note,
    locationLabel: session.locationLabel,
  });
}

export function getRemainingMs(session: ParkingSession, now: number): number {
  return Math.max(0, session.endsAt - now);
}

export function getProgress(session: ParkingSession, now: number): number {
  const total = session.endsAt - session.startedAt;
  if (total <= 0) return 1;
  return Math.min(1, Math.max(0, (now - session.startedAt) / total));
}

export function formatCountdown(ms: number): string {
  const totalMinutes = Math.ceil(Math.max(0, ms) / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes}m`;
  return `${hours}h ${minutes.toString().padStart(2, '0')}m`;
}

export function completeSession(streak: StreakState, completedAt: number): StreakState {
  const oneDay = 24 * 60 * 60 * 1000;
  const last = streak.lastCompletedAt ?? 0;
  const isSameDay = last > 0 && new Date(last).toDateString() === new Date(completedAt).toDateString();
  const isNextDay = last > 0 && completedAt - last < oneDay * 2 && !isSameDay;

  return {
    ticketFreeDays: isSameDay ? streak.ticketFreeDays : isNextDay ? streak.ticketFreeDays + 1 : Math.max(1, streak.ticketFreeDays || 1),
    sessionsCompleted: streak.sessionsCompleted + 1,
    lastCompletedAt: completedAt,
  };
}

export function getMascotMood(session: ParkingSession | null, now: number, streak: StreakState): string {
  if (!session) {
    return streak.ticketFreeDays >= 7 ? 'proud' : 'ready';
  }
  const remaining = getRemainingMs(session, now);
  if (remaining === 0) return 'urgent';
  if (remaining <= 10 * 60_000) return 'watching';
  return 'calm';
}

export function productIdForPlan(plan: ParkingPlan): string {
  return plan === 'annual' ? ANNUAL_PRODUCT_ID : WEEKLY_PRODUCT_ID;
}

export function packageIdForPlan(plan: ParkingPlan): string {
  return plan === 'annual' ? '$rc_annual' : '$rc_weekly';
}

export function proFeaturesForPlan(plan: ParkingPlan): string[] {
  const shared = ['Unlimited parking sessions', 'Smart pre-expiry alerts', 'Ticket-free streak cards'];
  if (plan === 'annual') {
    return ['7-day free trial', 'Best value for regular city parking', ...shared];
  }
  return ['Flexible weekly access', ...shared];
}
