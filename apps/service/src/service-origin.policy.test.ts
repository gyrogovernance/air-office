import { describe, expect, test } from 'bun:test';
import { bootstrapRequestOrigin, desktopServiceOrigins, trustedServiceOrigin } from './service-origin.policy';

describe('trustedServiceOrigin', () => {
  test('accepts the packaged desktop origin', () => {
    expect(trustedServiceOrigin('air-office://localhost')).toBe('air-office://localhost');
    expect(desktopServiceOrigins).toContain('air-office://localhost');
  });

  test('accepts loopback HTTP origins with a valid port', () => {
    expect(trustedServiceOrigin('http://127.0.0.1:5173')).toBe('http://127.0.0.1:5173');
    expect(trustedServiceOrigin('http://localhost:4317')).toBe('http://localhost:4317');
  });

  test('rejects foreign origins', () => {
    expect(trustedServiceOrigin('https://example.com')).toBeNull();
    expect(trustedServiceOrigin('null')).toBeNull();
    expect(trustedServiceOrigin('')).toBeNull();
  });
});

describe('bootstrapRequestOrigin', () => {
  test('uses Origin when present', () => {
    const request = new Request('http://127.0.0.1:9/bootstrap', {
      method: 'POST',
      headers: { origin: 'air-office://localhost' },
    });
    expect(bootstrapRequestOrigin(request)).toBe('air-office://localhost');
  });

  test('falls back to desktop Referer when Origin is absent', () => {
    const request = new Request('http://127.0.0.1:9/bootstrap', {
      method: 'POST',
      headers: { referer: 'air-office://localhost/index.html' },
    });
    expect(bootstrapRequestOrigin(request)).toBe('air-office://localhost');
  });

  test('rejects an untrusted Origin even when Referer is desktop', () => {
    const request = new Request('http://127.0.0.1:9/bootstrap', {
      method: 'POST',
      headers: {
        origin: 'https://evil.example',
        referer: 'air-office://localhost/index.html',
      },
    });
    expect(bootstrapRequestOrigin(request)).toBeNull();
  });
});
