export const APP_VERSION = '1.1.0';
export const SCHEMA_VERSION = 1;
export type Interval = { start: number; end: number };
export type Availability = Interval & { id: string; state: 'available' | 'unavailable' | 'preferred' | 'unknown' };
export interface Person { id: string; name: string; team: string; alias: string; tags: string[]; color: string; availability: Availability[]; allowedRoleIds: string[]; blockedDates: string[]; maxDaily?: number; maxTotal?: number; maxContinuous?: number; minBreak?: number; desiredMinutes?: number; minMinutes?: number; minMode: 'soft' | 'hard'; }
export interface EventDay { id: string; date: string; start: string; end: string; nextDay: boolean; }
export interface Location { id: string; name: string; }
export interface Role { id: string; name: string; requiredTags: string[]; }
export interface Demand extends Interval { id: string; locationId: string; roleId: string; count: number; leaderTag: string; leaderMin: number; phase: string; }
export interface Assignment extends Interval { id: string; personId: string; locationId: string; roleId: string; locked: boolean; source: 'manual' | 'auto'; }
export interface ProgramItem extends Interval { id: string; title: string; locationId: string; personId: string; dedicated: boolean; publicNote: string; internalNote: string; allowSharedLocation: boolean; }
export interface Policy { gridMinutes: number; minimumAssignment: number; preferredShift: number; travelMinutes: number; allowOverstaff: boolean; preset: 'balanced' | 'continuous' | 'preferred'; seed: number; timeLimitMs: number; }
export interface EventData { schemaVersion: 1; appVersion: string; id: string; name: string; organization: string; logoDataUrl?: string; description: string; timezone: 'Asia/Seoul'; days: EventDay[]; locations: Location[]; roles: Role[]; demands: Demand[]; people: Person[]; assignments: Assignment[]; programs: ProgramItem[]; policy: Policy; mode: 'staffing' | 'program'; status: 'draft' | 'confirmed' | 'archived'; revision: number; edition: number; createdAt: string; updatedAt: string; snapshots: Snapshot[]; }
export type SnapshotData = Omit<EventData, 'snapshots'>;
export interface Snapshot { id: string; version: number; confirmedAt: string; data: SnapshotData; }
export interface Issue { code: string; message: string; severity: 'error' | 'warning'; assignmentIds?: string[]; personId?: string; start?: number; end?: number; }
export interface Shortage extends Interval { locationId: string; roleId: string; needed: number; assigned: number; missing: number; leaderMissing: number; reason: string; }
export interface ValidationResult { errors: Issue[]; warnings: Issue[]; shortages: Shortage[]; requiredMinutes: number; coveredMinutes: number; shortageMinutes: number; personMinutes: Record<string, number>; dailyMinutes: Record<string, Record<string, number>>; locationStats: Record<string, { requiredMinutes: number; coveredMinutes: number; shortageMinutes: number }>; }
export interface ScheduleOptions { mode: 'fill' | 'selected' | 'all'; range?: Interval; locationId?: string; seed?: number; timeLimitMs?: number; shouldCancel?: () => boolean; }
export interface ScheduleResult { assignments: Assignment[]; validation: ValidationResult; elapsedMs: number; status: 'complete' | 'partial' | 'timeout' | 'cancelled' | 'invalid-fixed'; seed: number; attempts: number; explanation: string; }
export type UpdateEvent = (next: EventData, label?: string) => void;
