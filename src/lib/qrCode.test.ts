import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDirectWebsiteQrUrl,
  buildDirectWhatsAppQrUrl,
  buildQrFileName,
  formatCompactUrl,
  normalizeWhatsAppDigits,
  resolveBusinessQrTargets,
} from './qrCode';

test('normalizeWhatsAppDigits converts Nigerian local and international phone formats', () => {
  assert.equal(normalizeWhatsAppDigits('0801 234 5678'), '2348012345678');
  assert.equal(normalizeWhatsAppDigits('01-278-7000'), '23412787000');
  assert.equal(normalizeWhatsAppDigits('02 231 1600'), '23422311600');
  assert.equal(normalizeWhatsAppDigits('+234 809-876-5432'), '2348098765432');
  assert.equal(normalizeWhatsAppDigits('2347031112222'), '2347031112222');
  assert.equal(normalizeWhatsAppDigits('8012345678'), '2348012345678');
  assert.equal(normalizeWhatsAppDigits('+44 20 7946 0958'), '442079460958');
  assert.equal(normalizeWhatsAppDigits('123'), null);
  assert.equal(normalizeWhatsAppDigits(''), null);
});

test('buildDirectWhatsAppQrUrl produces bare wa.me link or includes encoded greeting', () => {
  assert.equal(
    buildDirectWhatsAppQrUrl('08012345678', ''),
    'https://wa.me/2348012345678',
  );
  assert.equal(
    buildDirectWhatsAppQrUrl('08012345678', 'Hello there!'),
    'https://wa.me/2348012345678?text=Hello%20there!',
  );
  assert.equal(buildDirectWhatsAppQrUrl('invalid'), null);
});

test('buildDirectWebsiteQrUrl upgrades bare domains and rejects unsafe schemes', () => {
  assert.equal(buildDirectWebsiteQrUrl('zenithbank.com'), 'https://zenithbank.com/');
  assert.equal(buildDirectWebsiteQrUrl('https://paystack.com/nigeria'), 'https://paystack.com/nigeria');
  assert.equal(buildDirectWebsiteQrUrl('javascript:alert(1)'), null);
  assert.equal(buildDirectWebsiteQrUrl('data:text/html,hi'), null);
  assert.equal(buildDirectWebsiteQrUrl('not-a-domain'), null);
  assert.equal(buildDirectWebsiteQrUrl(''), null);
});

test('resolveBusinessQrTargets handles both, WhatsApp-only, website-only, and empty businesses', () => {
  const both = resolveBusinessQrTargets({
    name: 'Eko Tech Works',
    whatsapp: '08031234567',
    phone: '08090001111',
    website: 'ekotech.ng',
  });
  assert.equal(both.hasAnyTarget, true);
  assert.equal(both.defaultTarget, 'whatsapp');
  assert.deepEqual(both.availableTypes, ['whatsapp', 'website']);
  assert.ok(both.targets.whatsapp.url?.startsWith('https://wa.me/2348031234567?text='));
  assert.equal(both.targets.website.url, 'https://ekotech.ng/');

  const noGreeting = resolveBusinessQrTargets(
    { name: 'Eko Tech Works', whatsapp: '08031234567', phone: '', website: '' },
    { includeGreeting: false },
  );
  assert.equal(noGreeting.targets.whatsapp.url, 'https://wa.me/2348031234567');
  assert.equal(noGreeting.targets.website.available, false);

  const phoneFallback = resolveBusinessQrTargets({
    name: 'Lagos Bakery',
    whatsapp: undefined,
    phone: '+234 802 555 0199',
    website: undefined,
  });
  assert.equal(phoneFallback.defaultTarget, 'whatsapp');
  assert.equal(phoneFallback.targets.whatsapp.displayValue, '+2348025550199');

  const webOnly = resolveBusinessQrTargets({
    name: 'Web Studio NG',
    whatsapp: '',
    phone: '',
    website: 'https://webstudio.ng/contact',
  });
  assert.equal(webOnly.defaultTarget, 'website');
  assert.deepEqual(webOnly.availableTypes, ['website']);
  assert.equal(webOnly.targets.whatsapp.available, false);

  const empty = resolveBusinessQrTargets({
    name: 'Offline Shop',
    whatsapp: '',
    phone: '',
    website: '',
  });
  assert.equal(empty.hasAnyTarget, false);
  assert.equal(empty.defaultTarget, null);
});

test('formatCompactUrl and buildQrFileName format clean labels and safe filenames', () => {
  assert.equal(formatCompactUrl('https://www.zenithbank.com/corporate/'), 'zenithbank.com/corporate');
  assert.equal(buildQrFileName('Zenith Bank Head Office!', 'whatsapp', 'png'), 'zenith-bank-head-office-whatsapp-qr.png');
  assert.equal(buildQrFileName('   ', 'website', 'svg'), 'business-website-qr.svg');
});
