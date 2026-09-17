import { api } from './client';

export type ShiftType = 'A' | 'B' | 'C' | 'A4' | 'C4';

export interface ShiftOption {
  code: ShiftType;
  name: string;
  startLocalTime: string;
  endLocalTime: string;
  crossesMidnight: boolean;
  graceMinutes: number;
}

export interface ShiftSession {
  id: string;
  branchId: number;
  shiftType: ShiftType;
  shiftName: string;
  /** "06:00 – 14:00", built by the server so the times exist in one place. */
  shiftWindow: string;
  receptionistName: string;
  startedAt: string;
  nominalEndAt: string;
  graceEndAt: string;
  closedAt: string | null;
  /**
   * TRUE once the nominal end plus the 10-minute grace has passed.
   *
   * COMPUTED BY THE SERVER, deliberately. The alternative — comparing
   * `graceEndAt` against the browser's clock — would make the handover prompt
   * depend on how accurately each reception PC is set, and a machine running ten
   * minutes fast would nag its receptionist early, every shift.
   */
  promptDue: boolean;
}

export interface CheckInInput {
  shiftType: ShiftType;
  receptionistName: string;
}

export const shiftsApi = {
  options: () => api.get<{ shifts: ShiftOption[] }>('/reception/shifts/options'),

  /** The open session, or null when nobody is checked in yet. */
  current: () => api.get<{ session: ShiftSession | null }>('/reception/shifts/current'),

  checkIn: (input: CheckInInput) =>
    api.post<{ session: ShiftSession }>('/reception/shifts/check-in', input),

  close: () => api.post<{ closed: number }>('/reception/shifts/close', {}),
};
