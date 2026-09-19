// Content › Files (spec 025): name derivation, reference extraction, upload-from-URL guards.

import { jest } from '@jest/globals';
import { ValidationError } from '../../src/middleware/errorHandler.js';
import { fetchPublicResource, isForbiddenAddress } from '../../src/utils/safeFetch.js';
import { displayName, fileIdsInHtml } from '../../src/services/StoreFileService.js';
import { validateUpdateStoreFile } from '../../src/api/validators/storeFileValidators.js';

describe('displayName', () => {
  it('strips path, extension and query string', () => {
    expect(displayName('/a/b/Sponsor Packet.PDF')).toBe('Sponsor Packet');
    expect(displayName('hero.image.png?x=1')).toBe('hero.image');
    expect(displayName('')).toBe('file');
    expect(displayName('%20spaced%20.png')).toBe('spaced');
  });
});

describe('fileIdsInHtml', () => {
  it('finds relative and absolute file URLs once each', () => {
    const hash = 'a'.repeat(64);
    const html = `<img src="/files/ckabc123/${hash}/hero.png"><a href="https://api.example.com/files/ckdef456/${hash}/packet.pdf?download=1">x</a><img src="/files/ckabc123/${hash}/hero.png">`;
    expect(fileIdsInHtml(html)).toEqual(['ckabc123', 'ckdef456']);
    expect(fileIdsInHtml('<p>none</p>')).toEqual([]);
    expect(fileIdsInHtml(null)).toEqual([]);
  });
});

describe('isForbiddenAddress', () => {
  it('blocks loopback, private, link-local, metadata and mapped addresses', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.9',
      '192.168.1.1',
      '169.254.169.254',
      '0.0.0.0',
      '::1',
      'fe80::1',
      'fd00::1',
      '::ffff:10.0.0.1',
    ]) {
      expect(isForbiddenAddress(ip)).toBe(true);
    }
  });
  it('allows public addresses', () => {
    expect(isForbiddenAddress('93.184.216.34')).toBe(false);
    expect(isForbiddenAddress('2606:2800:220:1:248:1893:25c8:1946')).toBe(false);
  });
});

describe('fetchPublicResource', () => {
  const publicLookup = async () => [{ address: '93.184.216.34' }];
  const privateLookup = async () => [{ address: '10.0.0.5' }];
  const ok = (body, headers = {}) => ({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'image/png', ...headers }),
    body: null,
    arrayBuffer: async () => body,
  });

  it('rejects non-http schemes, credentials and private hosts', async () => {
    await expect(
      fetchPublicResource('ftp://x.test/a', { maxBytes: 10, lookup: publicLookup })
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      fetchPublicResource('https://u:p@x.test/a', { maxBytes: 10, lookup: publicLookup })
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      fetchPublicResource('https://x.test/a', { maxBytes: 10, lookup: privateLookup })
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      fetchPublicResource('http://localhost:3000/a', { maxBytes: 10, lookup: publicLookup })
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      fetchPublicResource('http://127.0.0.1/a', { maxBytes: 10 })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('re-checks every redirect hop', async () => {
    const lookup = jest.fn(async (host) =>
      host === 'internal.test' ? [{ address: '10.0.0.5' }] : [{ address: '93.184.216.34' }]
    );
    const fetchImpl = jest.fn(async () => ({
      ok: false,
      status: 302,
      headers: new Headers({ location: 'http://internal.test/secret' }),
    }));
    await expect(
      fetchPublicResource('https://x.test/a', { maxBytes: 10, lookup, fetchImpl })
    ).rejects.toThrow('not reachable');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('caps the body size and returns the bytes', async () => {
    const fetchImpl = jest.fn(async () => ok(new Uint8Array(5).buffer));
    const result = await fetchPublicResource('https://x.test/a.png', {
      maxBytes: 10,
      lookup: publicLookup,
      fetchImpl,
    });
    expect(result.buffer.length).toBe(5);
    expect(result.contentType).toBe('image/png');
    expect(result.finalUrl).toBe('https://x.test/a.png');

    const big = jest.fn(async () => ok(new Uint8Array(11).buffer));
    await expect(
      fetchPublicResource('https://x.test/a.png', {
        maxBytes: 10,
        lookup: publicLookup,
        fetchImpl: big,
      })
    ).rejects.toThrow('larger than');

    const declared = jest.fn(async () =>
      ok(new Uint8Array(1).buffer, { 'content-length': '999999' })
    );
    await expect(
      fetchPublicResource('https://x.test/a.png', {
        maxBytes: 10,
        lookup: publicLookup,
        fetchImpl: declared,
      })
    ).rejects.toThrow('larger than');
  });
});

describe('validateUpdateStoreFile', () => {
  const run = (body) => {
    const next = jest.fn();
    validateUpdateStoreFile({ body }, {}, next);
    return next.mock.calls[0]?.[0];
  };
  it('whitelists keys and checks ranges', () => {
    expect(run({ name: 'Hero', altText: 'x', focalX: 0.2 })).toBeUndefined();
    expect(run({ extension: 'exe' })).toBeInstanceOf(ValidationError);
    expect(run({ name: 'a/b' })).toBeInstanceOf(ValidationError);
    expect(run({ focalY: 2 })).toBeInstanceOf(ValidationError);
    expect(run({})).toBeInstanceOf(ValidationError);
  });
});
