'use strict';

const path = require('path');
const { dumpCookiesFromBrowserTarget } = require('../lib/cdp-cookie-manager');

const PORT = parseInt(process.env.MASTER_PORT || '9225', 10);

async function probe() {
  console.log(`[CDP Cookie Probe] Connecting to Browser Target on port ${PORT}...`);
  try {
    const startTime = Date.now();
    const cookies = await dumpCookiesFromBrowserTarget(PORT, 5000);
    const elapsed = Date.now() - startTime;

    console.log(`[CDP Cookie Probe] Successfully retrieved ${cookies.length} cookies in ${elapsed}ms.`);

    const gptCookies = cookies.filter(c => 
      c.domain.includes('chatgpt.com') || 
      c.domain.includes('openai.com') ||
      c.domain.includes('auth0.openai.com')
    );

    console.log(`\n=== ChatGPT / OpenAI Domain Cookies (${gptCookies.length}) ===`);
    const keyTokens = [
      '__Secure-next-auth.session-token',
      '__cf_bm',
      'cf_clearance',
      '_puid',
      'oai-did'
    ];

    const foundKeyTokens = {};
    for (const cookie of gptCookies) {
      const isKey = keyTokens.includes(cookie.name);
      if (isKey) {
        foundKeyTokens[cookie.name] = cookie;
      }
      const expDate = cookie.expires > 0 ? new Date(cookie.expires * 1000).toISOString() : 'Session';
      const valPreview = cookie.value.length > 20 
        ? `${cookie.value.substring(0, 10)}...${cookie.value.substring(cookie.value.length - 8)}` 
        : cookie.value;
      console.log(`- [${cookie.name}] domain: ${cookie.domain}, path: ${cookie.path}, expires: ${expDate}, secure: ${cookie.secure}, httpOnly: ${cookie.httpOnly}, value: ${valPreview}`);
    }

    console.log('\n=== Key Authentication Token Status ===');
    for (const token of keyTokens) {
      if (foundKeyTokens[token]) {
        console.log(`[PASS] ${token}: Present (Domain: ${foundKeyTokens[token].domain})`);
      } else {
        console.log(`[MISS] ${token}: Not found`);
      }
    }

    const hasSessionToken = !!foundKeyTokens['__Secure-next-auth.session-token'];
    console.log(`\n=== Master Seed Login Readiness ===`);
    if (hasSessionToken) {
      console.log(`STATUS: READY (ChatGPT login session token detected in memory)`);
    } else {
      console.log(`STATUS: AWAITING_LOGIN (Browser is open, but session token not detected yet)`);
    }

    return {
      total: cookies.length,
      gptCount: gptCookies.length,
      hasSessionToken,
      keyTokens: Object.keys(foundKeyTokens)
    };
  } catch (err) {
    console.error(`[CDP Cookie Probe FAILED] ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  probe();
}

module.exports = { probe };
