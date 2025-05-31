const { Client, LocalAuth } = require('whatsapp-web.js');
const chromium = require('@sparticuz/chromium');
const fs = require('fs');
const path = require('path');

// Use this as the session key and storage folder
const sessionKey = '+255776822641';

(async () => {
  const client = new Client({
    authStrategy: new LocalAuth({ clientId: sessionKey }),
    puppeteer: {
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      args: chromium.args,
    }
  });

  client.on('ready', () => {
    console.log(`✅ WhatsApp is ready for ${sessionKey}!`);
  });

  client.on('authenticated', async () => {
    console.log(`🔐 Successfully authenticated for number: ${sessionKey}`);

    const sessionPath = path.join('.wwebjs_auth', `session-${sessionKey}`, 'creds.json');
    
    try {
      const sessionData = fs.readFileSync(sessionPath, 'utf-8');
      console.log('📦 FULL SESSION DATA:');
      console.log(sessionData);
    } catch (err) {
      console.error('❌ Could not read session file:', err);
    }
  });

  client.on('auth_failure', msg => {
    console.error('❌ Authentication failure:', msg);
  });

  client.on('disconnected', reason => {
    console.warn('⚠️ Client disconnected:', reason);
    process.exit(0);
  });

  client.on('pairing-code', (code) => {
    console.log(`🔑 Real WhatsApp Pairing Code: ${code}`);
    console.log('📱 Go to WhatsApp > Linked Devices > Use Pairing Code.');
  });

  await client.initialize();
})();