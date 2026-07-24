import { describe, expect, it } from 'vitest';
import { formatMoney, paymentLabel, relativeTime, statusLabel } from './format';

describe('statusLabel — Vietnamese business terminology', () => {
  it('maps each status to its agreed label', () => {
    expect(statusLabel('DRAFT')).toBe('Bản nháp');
    expect(statusLabel('NEW')).toBe('Chờ chi nhánh tạo');
    expect(statusLabel('COMPLETED')).toBe('Đã xác nhận tạo');
    expect(statusLabel('ARCHIVED')).toBe('Đã lưu trữ');
  });

  it('never uses a misleading "creates a booking" label', () => {
    const labels = ['DRAFT', 'READY', 'NEW', 'COMPLETED', 'ARCHIVED'].map(statusLabel).join(' ');
    expect(labels).not.toMatch(/Hoàn thành đặt phòng|Kas đã tạo|Tạo booking trong Kas/);
  });
});

describe('money and payment formatting', () => {
  it('formats VND with a dash for unknown amounts', () => {
    expect(formatMoney(850_000)).toBe('850.000 ₫');
    expect(formatMoney(null)).toBe('—');
  });

  it('labels payment status with the operational CHECK-IN wording', () => {
    expect(paymentLabel('PAY_BEFORE')).toBe('PAY BEFORE CHECK-IN');
    expect(paymentLabel('PAY_AFTER')).toBe('PAY AFTER CHECK-IN');
  });
});

describe('relativeTime', () => {
  const now = new Date('2026-07-21T10:00:00.000Z');
  it('returns coarse Vietnamese relative labels', () => {
    expect(relativeTime('2026-07-21T09:59:50.000Z', now)).toBe('vừa xong');
    expect(relativeTime('2026-07-21T09:55:00.000Z', now)).toBe('5 phút trước');
    expect(relativeTime('2026-07-21T07:00:00.000Z', now)).toBe('3 giờ trước');
    expect(relativeTime(null, now)).toBe('—');
  });
});
