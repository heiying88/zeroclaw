import assert from 'node:assert/strict';
import test from 'node:test';

async function loadValidationWarningMessage() {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { __ZEROCLAW_BASE__: '', __ZEROCLAW_LOCALE__: 'en' },
  });
  // The window stub above pins English copy: the assertion below matches an
  // English string and the app default locale is zh.
  const { validationWarningMessage } = await import('./validationWarnings.ts');
  delete (globalThis as { window?: unknown }).window;
  return validationWarningMessage;
}

test('known config warnings resolve through the dashboard catalog', async () => {
  const validationWarningMessage = await loadValidationWarningMessage();
  const auditMessage = validationWarningMessage({
    code: 'security_audit_disabled_drops_certificate_record',
    message: 'unlocalized audit fallback',
    path: 'security.audit.enabled',
  });

  assert.match(auditMessage, /certificate issuance and renewal have no audit-log record/i);
  assert.match(auditMessage, /command execution is not audited/i);
  assert.doesNotMatch(auditMessage, /unlocalized audit fallback/);
});

test('unknown config warnings retain the API fallback message', async () => {
  const validationWarningMessage = await loadValidationWarningMessage();
  const message = validationWarningMessage({
    code: 'future_warning',
    message: 'future fallback',
    path: 'future.path',
  });

  assert.equal(message, 'future fallback');
});
