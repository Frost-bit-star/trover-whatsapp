const { Client, LocalAuth } = require('whatsapp-web.js');

function generatePairingCode() {
  return Math.floor(10000000 + Math.random() * 90000000).toString();
}

(async () => {
  const pairingCode = generatePairingCode();
  console.log(`\n🔑 Your pairing code (session key) is: ${pairingCode}\n`);

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: pairingCode }),
    puppeteer: {
      headless: false, // open browser UI to see numeric pairing code
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
  });

  client.on('qr', (qr) => {
    // QR event still fires if multi-device is off, but you won't use it
    console.log('⚠️ QR code generated (ignore if using numeric code):', qr);
  });

  client.on('ready', () => {
    console.log(`✅ WhatsApp client is ready and authenticated with pairing code: ${pairingCode}`);
  });

  client.on('authenticated', () => {
    console.log(`🔐 Authenticated! Session saved with pairing code: ${pairingCode}`);
  });

  client.on('auth_failure', msg => {
    console.error('❌ Authentication failure:', msg);
  });

  client.on('disconnected', reason => {
    console.warn('⚠️ Client disconnected:', reason);
    process.exit(0);
  });

  await client.initialize();
})();