const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const chromium = require('@sparticuz/chromium');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Raw session key (e.g., phone number)
const rawSessionKey = '+255776822641';
const sessionKey = rawSessionKey.replace(/[^a-zA-Z0-9_-]/g, '');

console.log(`🆔 Using clientId: ${sessionKey}`);

(async () => {
  const client = new Client({
    authStrategy: new LocalAuth({ clientId: sessionKey }),
    puppeteer: {
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox']
    }
  });

  // 🔑 SHOW QR CODE FOR PAIRING
  client.on('qr', qr => {
    console.log('\n📷 WhatsApp QR Code (scan this with your phone):');
    console.log(qr);
    console.log('\n📱 Open WhatsApp > Linked Devices > Scan QR Code');
  });

  client.on('ready', () => {
    console.log(`✅ WhatsApp is ready for ${sessionKey}!`);
  });

  client.on('authenticated', async () => {
    console.log(`🔐 Successfully authenticated for number: ${sessionKey}`);

    const sessionPath = path.join('.wwebjs_auth', `session-${sessionKey}`, 'creds.json');
    try {
      const sessionData = fs.readFileSync(sessionPath, 'utf-8');
      console.log('\n🔒 ====== WHATSAPP SESSION (creds.json) ======');
      console.log(sessionData);
      console.log('🔒 ====== END OF SESSION DATA ======\n');
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

  client.on('pairing-code', code => {
    console.log(`🔑 Real WhatsApp Pairing Code: ${code}`);
    console.log('📱 Go to WhatsApp > Linked Devices > Use Pairing Code.');
  });

  await client.initialize();
})();

// 🌐 Express server to satisfy Render port binding
app.get('/', (req, res) => {
  res.send(`✅ WhatsApp bot is running for ${sessionKey}`);
});

app.listen(PORT, () => {
  console.log(`🌐 Express server listening on port ${PORT}`);
});