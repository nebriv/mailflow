import { describe, it, expect } from 'vitest';

import { guardReason, isGuarded, GUARD_EXEMPT_BUNDLES } from './guards.js';
import { extractSignals } from './signals.js';

const sig = (subject, from = 'news@vendor.com') =>
  extractSignals({ id: 'm', from_email: from, subject, is_bulk: true, category: 'newsletter' });

const guardOf = (subject, from) => guardReason(sig(subject, from));

describe('guardReason — the two failures from the spec', () => {
  // §1.2: the client's Newsletters bucket contains a CRITICAL VMware vCenter advisory. It carries
  // List-Unsubscribe, so header classification files it with marketing. The guard is the only thing
  // that separates them.
  it('holds back a CRITICAL VMware advisory that carries bulk headers', () => {
    expect(guardOf('VMSA-2026-0011: CRITICAL vCenter Server vulnerability', 'security-noreply@vmware.com'))
      .toBe('security');
  });

  // §1.2: and a Binance account-action notice.
  it('holds back a Binance account-action notice', () => {
    expect(guardOf('Action Required: Verify your account to continue trading', 'no-reply@binance.com'))
      .toBe('security');
  });
});

describe('guardReason — security', () => {
  it.each([
    'Security alert for your account',
    'Unusual sign-in activity detected',
    'New login from Chrome on Windows',
    'Your verification code is 448210',
    'Reset your password',
    'Two-factor authentication is now enabled',
    'Your one-time passcode',
    'We detected a data breach affecting your account',
    'CVE-2026-1337 affects your deployment',
    'Critical security update available',
    'Immediate attention required for your account',
  ])('fires on %j', (subject) => {
    expect(guardOf(subject)).toBe('security');
  });
});

describe('guardReason — financial', () => {
  it.each([
    'Your invoice for August',
    'Receipt for your payment',
    'Payment failed for your subscription',
    'Your card ending in 4242 expires soon',
    'Statement available',
    'Refund processed',
    'Your plan renews on 1 September',
    'Balance due: $42.00',
  ])('fires on %j', (subject) => {
    expect(guardOf(subject)).toBe('financial');
  });
});

describe('guardReason — transactional', () => {
  it.each([
    'Your order #10482 has shipped',
    'Your package is out for delivery',
    'Tracking number for your shipment',
    'Your booking is confirmed',
    'Your flight departs tomorrow',
    'Your appointment is confirmed for Tuesday',
  ])('fires on %j', (subject) => {
    expect(guardOf(subject)).toBe('transactional');
  });
});

describe('guardReason — calendar', () => {
  // MailFlow maps text/calendar to category 'automated', which would bundle an invite into
  // Notifications. The Content-Type is not persisted, so the subject convention is the signal.
  it.each([
    'Invitation: Design review @ Mon Aug 17, 10am',
    'Updated invitation: Standup',
    'Accepted: Coffee',
    'Canceled: All hands',
    'Cancelled: All hands',
  ])('fires on %j', (subject) => {
    expect(guardOf(subject)).toBe('calendar');
  });

  it('anchors calendar prefixes at the start so marketing copy does not trip them', () => {
    expect(guardOf('Your exclusive invitation: 20% off everything')).toBeNull();
  });
});

describe('guardReason — lifecycle', () => {
  it.each([
    'We are updating our Terms of Service',
    'Changes to our privacy policy',
    'Your account will be deactivated',
    'We are shutting down this service',
  ])('fires on %j', (subject) => {
    expect(guardOf(subject)).toBe('lifecycle');
  });
});

describe('guardReason — operational senders', () => {
  it('fires on an operational local part regardless of subject', () => {
    expect(guardOf('Monthly digest', 'security@acme.com')).toBe('operational-sender');
    expect(guardOf('Monthly digest', 'billing@acme.com')).toBe('operational-sender');
  });

  it('strips a +tag before matching the local part', () => {
    expect(guardOf('Monthly digest', 'billing+acme@shop.com')).toBe('operational-sender');
  });

  // Deliberately NOT exempt: Zillow and most newsletters the client enjoys send from alerts@ and
  // notifications@. Exempting those local parts would empty the bundles and defeat the feature.
  it.each(['alerts@zillow.com', 'notifications@github.com', 'news@wired.com', 'hello@crowdsupply.com'])(
    'does not fire on %s', (from) => {
      expect(guardOf('This week in gear', from)).toBeNull();
    }
  );
});

describe('guardReason — mail the client reads for pleasure stays bundleable', () => {
  // §1: volume is not the problem. These senders must keep bundling or ROW_BUDGET is spent on the
  // very mail the bundles exist to hold.
  it.each([
    ['New listings in your saved search', 'alerts@zillow.com'],
    ['This week on Crowd Supply', 'newsletter@crowdsupply.com'],
    ['The best gear we tested this month', 'newsletter@wired.com'],
    ['New Humble Bundle: indie games', 'contact@humblebundle.com'],
    ['Your weekly Kobo picks', 'news@kobo.com'],
    ['20% off everything this weekend', 'deals@shop.com'],
    ['Weekly digest', 'digest@substack.com'],
  ])('leaves %j from %s bundleable', (subject, from) => {
    expect(guardOf(subject, from)).toBeNull();
  });
});

describe('guardReason — edges', () => {
  it('is case-insensitive', () => {
    expect(guardOf('SECURITY ALERT')).toBe('security');
    expect(guardOf('security alert')).toBe('security');
  });

  it('returns a reason for null signals rather than silently passing', () => {
    expect(guardReason(null)).toBe('no-signals');
    expect(isGuarded(null)).toBe(true);
  });

  it('has no objection to an empty subject from an ordinary sender', () => {
    expect(guardOf('')).toBeNull();
  });

  it('exempts no bundle from the guard', () => {
    expect(GUARD_EXEMPT_BUNDLES).toEqual([]);
  });
});
