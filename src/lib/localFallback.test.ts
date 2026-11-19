import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deleteLocalReview,
  getLocalReviews,
  isPermissionDenied,
  saveLocalContactMessage,
  saveLocalSubscriber,
  writeStoredList,
  readStoredList,
} from './localFallback';

function createMemoryStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
  };
}

function setupMockWindow() {
  const events: string[] = [];
  (globalThis as Record<string, unknown>).CustomEvent = class {
    type: string;
    constructor(type: string) {
      this.type = type;
    }
  };
  (globalThis as Record<string, unknown>).window = {
    localStorage: createMemoryStorage(),
    dispatchEvent: (ev: { type: string }) => {
      events.push(ev.type);
      return true;
    },
  };
  return { events };
}

test('isPermissionDenied identifies Firebase permission-denied errors only', () => {
  assert.equal(isPermissionDenied({ code: 'permission-denied' }), true);
  assert.equal(isPermissionDenied({ code: 'unavailable' }), false);
  assert.equal(isPermissionDenied(null), false);
  assert.equal(isPermissionDenied(new Error('permission-denied')), false);
});

test('localFallback stores, sorts, and deletes reviews cleanly', () => {
  const { events } = setupMockWindow();
  writeStoredList('naijapages_local_reviews_v1', [
    { id: 'r1', businessId: 'b1', author: 'Ada', rating: 5, comment: 'Great service', date: 'Just now', createdAt: 100 },
    { id: 'r2', businessId: 'b1', author: 'Tunde', rating: 4, comment: 'Solid place', date: 'Just now', createdAt: 200 },
    { id: 'r3', businessId: 'b2', author: 'Bola', rating: 5, comment: 'Other biz', date: 'Just now', createdAt: 300 },
  ]);

  const b1 = getLocalReviews('b1');
  assert.equal(b1.length, 2);
  assert.equal(b1[0].id, 'r2');
  assert.equal(b1[1].id, 'r1');

  assert.equal(deleteLocalReview('r1'), true);
  assert.equal(deleteLocalReview('missing'), false);
  assert.equal(getLocalReviews('b1').length, 1);
  assert.ok(events.length >= 2);
});

test('localFallback deduplicates newsletter subscribers and saves contact messages', () => {
  setupMockWindow();
  saveLocalSubscriber('User@Example.com', 'homepage_banner');
  saveLocalSubscriber('user@example.com', 'homepage_banner');
  const subs = readStoredList<{ email: string }>('naijapages_local_newsletter_v1');
  assert.equal(subs.length, 1);
  assert.equal(subs[0].email, 'user@example.com');

  saveLocalContactMessage({
    name: 'Chidi',
    email: 'chidi@example.com',
    subject: '[General question] Listing update',
    message: 'Please update our opening hours.',
  });
  const msgs = readStoredList<{ name: string }>('naijapages_local_contact_v1');
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].name, 'Chidi');
});
