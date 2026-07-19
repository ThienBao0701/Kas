import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

const app = createApp();

describe('GET /api/health', () => {
  it('returns 200 with a real database connectivity result', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.database.connected).toBe(true);
    expect(typeof response.body.database.latencyMs).toBe('number');
    expect(typeof response.body.uptimeSeconds).toBe('number');
  });

  it('echoes a request id header', async () => {
    const response = await request(app).get('/api/health');

    expect(response.headers['x-request-id']).toBeTruthy();
  });
});
