import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

const app = createApp();

describe('error responses', () => {
  it('returns 404 for an unknown route', async () => {
    const response = await request(app).get('/api/khong-ton-tai');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 404 for an unknown non-API path', async () => {
    const response = await request(app).get('/totally-unknown');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('uses one consistent error body shape', async () => {
    const response = await request(app).post('/api/khong-ton-tai');

    expect(response.body).toMatchObject({
      error: {
        code: expect.any(String),
        message: expect.any(String),
      },
      requestId: expect.any(String),
    });
    // The error object carries exactly code/message (+ optional details).
    expect(Object.keys(response.body).sort()).toEqual(['error', 'requestId']);
  });

  it('rejects malformed JSON with a 400 in the same shape', async () => {
    const response = await request(app)
      .post('/api/khong-ton-tai')
      .set('Content-Type', 'application/json')
      .send('{"broken":');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('BAD_REQUEST');
    expect(response.body.requestId).toBeTruthy();
  });
});
