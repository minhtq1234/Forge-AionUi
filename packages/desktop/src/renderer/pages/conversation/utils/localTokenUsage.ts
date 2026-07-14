const STORAGE_KEY = 'aionui.local-token-usage.v1';
const LEDGER_VERSION = 1;
const RETENTION_DAYS = 40;
const DAY_MS = 24 * 60 * 60 * 1000;

export type LocalTokenUsageEvent = {
  id: string;
  inputTokens: number;
  outputTokens: number;
  occurredAt: number;
};

export type LocalTokenUsageSummary = {
  today: number;
  weekToDate: number;
  monthToDate: number;
};

type LocalTokenUsageLedger = {
  version: 1;
  events: LocalTokenUsageEvent[];
};

type LocalTokenUsageListener = () => void;

const listeners = new Set<LocalTokenUsageListener>();

function isValidEvent(value: unknown): value is LocalTokenUsageEvent {
  if (typeof value !== 'object' || value === null) return false;
  const event = value as Partial<LocalTokenUsageEvent>;
  return (
    typeof event.id === 'string' &&
    Number.isFinite(event.inputTokens) &&
    event.inputTokens >= 0 &&
    Number.isFinite(event.outputTokens) &&
    event.outputTokens >= 0 &&
    Number.isFinite(event.occurredAt)
  );
}

function normalizeEvents(events: unknown[], now: number): LocalTokenUsageEvent[] {
  const ids = new Set<string>();
  const cutoff = now - RETENTION_DAYS * DAY_MS;

  return events.filter((event): event is LocalTokenUsageEvent => {
    if (!isValidEvent(event) || event.occurredAt < cutoff || event.occurredAt > now || ids.has(event.id)) {
      return false;
    }
    ids.add(event.id);
    return true;
  });
}

function readLedger(now = Date.now()): LocalTokenUsageLedger {
  try {
    if (typeof localStorage === 'undefined') return { version: LEDGER_VERSION, events: [] };
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: LEDGER_VERSION, events: [] };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return { version: LEDGER_VERSION, events: [] };
    const ledger = parsed as { version?: unknown; events?: unknown };
    if (ledger.version !== LEDGER_VERSION || !Array.isArray(ledger.events)) {
      return { version: LEDGER_VERSION, events: [] };
    }
    const events = normalizeEvents(ledger.events, now);
    const normalizedLedger: LocalTokenUsageLedger = {
      version: LEDGER_VERSION,
      events,
    };
    if (events.length !== ledger.events.length) writeLedger(normalizedLedger);
    return normalizedLedger;
  } catch {
    return { version: LEDGER_VERSION, events: [] };
  }
}

function writeLedger(ledger: LocalTokenUsageLedger): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ledger));
    return true;
  } catch {
    return false;
  }
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function getWindowStarts(now: Date): { today: number; weekToDate: number; monthToDate: number } {
  const today = startOfDay(now);
  const dayOfWeek = now.getDay();
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  weekStart.setDate(weekStart.getDate() - daysSinceMonday);
  const weekToDate = weekStart.getTime();
  const monthToDate = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  return { today, weekToDate, monthToDate };
}

function sumSince(events: LocalTokenUsageEvent[], start: number): number {
  return events.reduce(
    (total, event) => (event.occurredAt >= start ? total + event.inputTokens + event.outputTokens : total),
    0
  );
}

export function getLocalTokenUsageSummary(): LocalTokenUsageSummary {
  const events = readLedger().events;
  const starts = getWindowStarts(new Date());
  return {
    today: sumSince(events, starts.today),
    weekToDate: sumSince(events, starts.weekToDate),
    monthToDate: sumSince(events, starts.monthToDate),
  };
}

export function recordLocalTokenUsage(event: LocalTokenUsageEvent): void {
  const now = Date.now();
  if (!isValidEvent(event) || event.occurredAt > now) return;

  const ledger = readLedger(now);
  if (ledger.events.some((existingEvent) => existingEvent.id === event.id)) return;

  const cutoff = now - RETENTION_DAYS * DAY_MS;
  const events = [...ledger.events, event].filter(
    (storedEvent) => storedEvent.occurredAt >= cutoff && storedEvent.occurredAt <= now
  );
  if (!writeLedger({ version: LEDGER_VERSION, events })) return;

  listeners.forEach((listener) => listener());
}

export function subscribeToLocalTokenUsage(listener: LocalTokenUsageListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
