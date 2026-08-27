const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..', '..');
const envExample = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');
const nginx = fs.readFileSync(path.join(projectRoot, 'nginx.conf'), 'utf8');

test('records all admin SMS login deployment settings in the example environment', () => {
  const requiredSettings = {
    ADMIN_LOGIN_SMS_MODE: 'enforce',
    ADMIN_LOGIN_SECURITY_SECRET: undefined,
    ADMIN_LOGIN_SMS_MSG_TEMPLATE: undefined,
    ADMIN_LOGIN_OTP_TTL_MS: '300000',
    ADMIN_LOGIN_OTP_RESEND_MS: '60000',
    ADMIN_LOGIN_OTP_HOURLY_SEND_LIMIT: '10',
    ADMIN_LOGIN_OTP_MAX_ATTEMPTS: '5',
    ADMIN_LOGIN_SESSION_TTL_MS: '43200000',
  };

  for (const [key, expectedValue] of Object.entries(requiredSettings)) {
    const match = envExample.match(new RegExp(`^${key}=(.*)$`, 'm'));
    assert.ok(match, `${key} must be documented in .env.example`);
    if (expectedValue !== undefined) {
      assert.equal(match[1], expectedValue, `${key} must use the approved default`);
    }
  }

  assert.match(
    envExample,
    /^ADMIN_LOGIN_SMS_MSG_TEMPLATE=.*\{code\}/m,
    'the SMS template must retain the {code} placeholder',
  );
});

test('removes admin IP access controls and redirects the 8080 admin entrypoint to HTTPS', () => {
  assert.doesNotMatch(nginx, /115\.152\.87\.204|60\.179\.212\.69|39\.189\.46\.72/);
  assert.doesNotMatch(nginx, /geo\s+\$admin_ip_allowed|admin_ip_allowed|admin_request_denied/);
  assert.doesNotMatch(nginx, /allow\s+(?:115\.152\.87\.204|60\.179\.212\.69|39\.189\.46\.72)|deny\s+all/);
  assert.match(nginx, /proxy_set_header\s+X-Real-IP\s+\$remote_addr;/);

  const port8080Server = nginx.match(/server\s*\{\s*listen\s+8080;[\s\S]*?\n\s*\}/);
  assert.ok(port8080Server, 'the 8080 server block must exist');
  assert.match(port8080Server[0], /return 301 https:\/\/admin\.wenshuosc\.com\$request_uri;/);
  assert.doesNotMatch(port8080Server[0], /location\s|proxy_pass|root\s+\/var\/1bossadmin/);
});
