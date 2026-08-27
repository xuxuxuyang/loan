const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..', '..');
const envExample = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');
const nginx = fs.readFileSync(path.join(projectRoot, 'nginx.conf'), 'utf8');

function extractBlocks(source, opener) {
  const blocks = [];
  const matcher = new RegExp(opener.source, `${opener.flags.replace('g', '')}g`);
  let match;

  while ((match = matcher.exec(source))) {
    const openBrace = source.indexOf('{', match.index);
    let depth = 0;

    for (let index = openBrace; index < source.length; index += 1) {
      if (source[index] === '{') depth += 1;
      if (source[index] === '}') depth -= 1;
      if (depth === 0) {
        blocks.push(source.slice(match.index, index + 1));
        matcher.lastIndex = index + 1;
        break;
      }
    }
  }

  return blocks;
}

const serverBlocks = extractBlocks(nginx, /\bserver\s*\{/);

function getServerBlock(label, predicate) {
  const matches = serverBlocks.filter(predicate);
  assert.equal(matches.length, 1, `${label} server block must exist exactly once`);
  return matches[0];
}

function getLocationBlock(serverBlock, locationPattern, label) {
  const locationBlocks = extractBlocks(serverBlock, /\blocation\s+(?:\^~\s+)?[^\s{]+\s*\{/);
  const matches = locationBlocks.filter((block) => locationPattern.test(block));
  assert.equal(matches.length, 1, `${label} location must exist exactly once`);
  return matches[0];
}

function assertProxyLocation(serverBlock, locationPattern, target, label) {
  const locationBlock = getLocationBlock(serverBlock, locationPattern, label);
  assert.match(locationBlock, new RegExp(`proxy_pass\\s+${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')};`));
  assert.match(locationBlock, /proxy_set_header\s+X-Real-IP\s+\$remote_addr;/, `${label} must retain X-Real-IP audit forwarding`);
}

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
  assert.ok(/^ADMIN_LOGIN_SECURITY_SECRET=$/m.test(envExample), 'the example must not contain a committed login security secret');
  assert.ok(/必须替换为当前环境短信平台已备案签名/.test(envExample), 'the SMS template must explain registered-signature replacement');
  assert.ok(/开发、生产环境.*独立.*密钥/.test(envExample), 'Chinese comments must require independent development and production secrets');
  assert.ok(/43200000 表示 12 小时/.test(envExample), 'Chinese comments must document the 12-hour session TTL');
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

test('preserves the HTTP admin redirect and ACME exception', () => {
  const adminHttp = getServerBlock(
    'admin HTTP',
    (block) => /listen\s+80;/.test(block) && /server_name\s+admin\.wenshuosc\.com;/.test(block),
  );
  const acmeLocation = getLocationBlock(adminHttp, /location\s+\^~\s+\/\.well-known\/acme-challenge\//, 'admin HTTP ACME');
  const redirectLocation = getLocationBlock(adminHttp, /location\s+\//, 'admin HTTP redirect');

  assert.match(acmeLocation, /root\s+\/var\/www\/certbot;/);
  assert.match(acmeLocation, /default_type\s+"text\/plain";/);
  assert.match(acmeLocation, /allow\s+all;/);
  assert.match(redirectLocation, /return 301 https:\/\/\$host\$request_uri;/);
  assert.doesNotMatch(redirectLocation, /proxy_pass|fastcgi_pass|root\s|try_files|auth_basic/i);
  assert.doesNotMatch(adminHttp, /proxy_pass|fastcgi_pass|proxy_set_header|auth_basic/i);
});

test('preserves the required deployment routes, TLS paths, and proxy audit headers', () => {
  const defaultHttp = getServerBlock(
    'default HTTP storefront',
    (block) => /listen\s+80\s+default_server;/.test(block) && /server_name\s+_;/.test(block),
  );
  const storefrontHttps = getServerBlock(
    'storefront HTTPS',
    (block) => /listen\s+443\s+ssl;/.test(block) && /server_name\s+wenshuosc\.com\s+www\.wenshuosc\.com;/.test(block),
  );
  const adminHttps = getServerBlock(
    'admin HTTPS',
    (block) => /listen\s+443\s+ssl;/.test(block) && /server_name\s+admin\.wenshuosc\.com;/.test(block),
  );
  const trafficAdmin = getServerBlock(
    'traffic admin',
    (block) => /listen\s+8081;/.test(block) && /server_name\s+_;/.test(block),
  );
  const storefrontHttp = getServerBlock(
    'storefront HTTP',
    (block) => /listen\s+80;/.test(block) && /server_name\s+wenshuosc\.com\s+www\.wenshuosc\.com;/.test(block),
  );

  assert.match(getLocationBlock(defaultHttp, /^location\s+\/\s*\{/, 'default HTTP storefront root'), /root\s+\/var\/1bossshop;/);
  assert.match(getLocationBlock(storefrontHttps, /^location\s+\/\s*\{/, 'HTTPS storefront root'), /root\s+\/var\/1bossshop;/);
  assert.match(getLocationBlock(adminHttps, /^location\s+\/\s*\{/, 'HTTPS admin root'), /root\s+\/var\/1bossadmin;/);
  assert.match(getLocationBlock(trafficAdmin, /^location\s+\/\s*\{/, 'traffic admin root'), /root\s+\/var\/1admin-liuliang;/);

  for (const [label, serverBlock] of [['storefront HTTPS', storefrontHttps], ['admin HTTPS', adminHttps]]) {
    assert.match(serverBlock, /ssl_certificate\s+\/etc\/letsencrypt\/live\/wenshuosc\.com\/fullchain\.pem;/, `${label} certificate path must remain unchanged`);
    assert.match(serverBlock, /ssl_certificate_key\s+\/etc\/letsencrypt\/live\/wenshuosc\.com\/privkey\.pem;/, `${label} key path must remain unchanged`);
    assert.match(serverBlock, /include\s+\/etc\/letsencrypt\/options-ssl-nginx\.conf;/, `${label} TLS options include must remain unchanged`);
    assert.match(serverBlock, /ssl_dhparam\s+\/etc\/letsencrypt\/ssl-dhparams\.pem;/, `${label} DH params path must remain unchanged`);
  }

  for (const [label, serverBlock] of [['default HTTP', defaultHttp], ['storefront HTTPS', storefrontHttps], ['traffic admin', trafficAdmin]]) {
    assertProxyLocation(serverBlock, /location\s+\/api\//, 'http://127.0.0.1:3110/api/', `${label} API`);
    assertProxyLocation(serverBlock, /location\s+\/risk-api\//, 'http://127.0.0.1:3110/risk-api/', `${label} risk API`);
    assertProxyLocation(serverBlock, /location\s+\/static\//, 'http://127.0.0.1:3110/static/', `${label} static API`);
  }

  for (const [label, serverBlock] of [['storefront HTTP', storefrontHttp], ['storefront HTTPS', storefrontHttps]]) {
    assertProxyLocation(serverBlock, /location\s+\^~\s+\/market\/halfFlow\/447285613150998528\/open\//, 'http://127.0.0.1:3110/market/halfFlow/447285613150998528/open/', `${label} partner route`);
  }

  for (const serverBlock of serverBlocks) {
    for (const locationBlock of extractBlocks(serverBlock, /\blocation\s+(?:\^~\s+)?[^\s{]+\s*\{/)) {
      if (/\bproxy_pass\b/.test(locationBlock)) {
        assert.match(locationBlock, /proxy_set_header\s+X-Real-IP\s+\$remote_addr;/, 'every existing proxy block must retain X-Real-IP audit forwarding');
      }
    }
  }
});
