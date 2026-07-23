import { describe, expect, it } from 'vitest';
import { payStatusCopy, relativeTime, statusLabel } from './format';

describe('Vietnamese operational labels', () => {
  it('maps each database status to the agreed UI label', () => {
    expect(statusLabel('DRAFT')).toBe('Bản nháp');
    expect(statusLabel('NEW')).toBe('Chờ chi nhánh tạo');
    expect(statusLabel('COMPLETED')).toBe('Đã xác nhận tạo');
    expect(statusLabel('ARCHIVED')).toBe('Đã lưu trữ');
  });

  it('never uses a misleading "Kas created the booking" phrase', () => {
    const labels = ['DRAFT', 'NEW', 'COMPLETED', 'ARCHIVED'].map(statusLabel).join(' ');
    expect(labels).not.toMatch(/Kas đã tạo|Hoàn tất đặt phòng|Complete Booking/i);
  });

  it('copies the exact PAY BEFORE / PAY AFTER token', () => {
    expect(payStatusCopy('PAY_BEFORE')).toBe('PAY BEFORE');
    expect(payStatusCopy('PAY_AFTER')).toBe('PAY AFTER');
  });

  it('formats a short Vietnamese relative time', () => {
    const now = Date.parse('2026-07-21T10:00:00.000Z');
    expect(relativeTime('2026-07-21T09:55:00.000Z', now)).toBe('5 phút trước');
    expect(relativeTime('2026-07-21T09:59:40.000Z', now)).toBe('Vừa xong');
    expect(relativeTime('2026-07-21T08:00:00.000Z', now)).toBe('2 giờ trước');
  });
});
