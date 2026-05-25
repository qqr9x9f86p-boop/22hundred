const db = require('./_db');
const { Resend } = require('resend');
const twilio = require('twilio');
const crypto = require('crypto');

const DISCORD = 'https://discord.com/api/webhooks/1508601284951801856/9f_Iesfpjb5vGNwGo1ewkedYEZ5zgyQTZfdmkjdZOd_hWnBMe5DnM43oX6WVWiERFKAe';

function genPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusable chars (0/O, 1/I)
  let p = '';
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) p += chars[bytes[i] % chars.length];
  return p.slice(0, 3) + '-' + p.slice(3); // format: XXX-XXX
}

function normalizePhone(phone) {
  const d = phone.replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d[0] === '1') return `+${d}`;
  return null;
}

// Get current drop number from Firestore
async function nextDropNumber() {
  const snap = await db.collection('22h_drops').orderBy('createdAt', 'desc').limit(1).get();
  if (snap.empty) return '000';
  const last = snap.docs[0].data().dropNumber || '000';
  return String(parseInt(last, 10) + 1).padStart(3, '0');
}

module.exports = async (req, res) => {
  // Verify cron secret to block unauthorized calls
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const twilioReady = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER;
  const smsClient = twilioReady ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN) : null;

  const password = genPassword();
  const dropNumber = await nextDropNumber();
  const now = new Date();
  const closeAt = new Date(now.getTime() + 48 * 60 * 60 * 1000);

  // Save the active drop
  await db.collection('22h_drops').doc(`drop_${dropNumber}`).set({
    dropNumber,
    password,
    status: 'active',
    createdAt: now.toISOString(),
    openAt: now.toISOString(),
    closeAt: closeAt.toISOString(),
  });

  // Get all signups
  const signups = await db.collection('22h_signups').where('active', '==', true).get();
  const docs = signups.docs.map(d => d.data());

  let emailsSent = 0, smsSent = 0, errors = 0;

  await Promise.all(docs.map(async (s) => {
    const msg = `22HUNDRED DROP ${dropNumber} IS LIVE\n\nYour password: ${password}\n\nShop is open for 48 hours.\n22hundred.shop/shop`;

    // Email
    if (s.email) {
      try {
        await resend.emails.send({
          from: '22HUNDRED <drop@getmaya.support>',
          to: s.email,
          subject: `DROP ${dropNumber} IS LIVE — Your Password`,
          html: `
            <div style="background:#000;color:#f4f4f4;font-family:monospace;padding:48px 32px;max-width:480px;margin:0 auto;">
              <div style="font-size:11px;letter-spacing:0.2em;color:#8a8a8a;margin-bottom:32px;">22HUNDRED</div>
              <div style="font-size:22px;font-weight:700;letter-spacing:0.1em;margin-bottom:8px;">DROP ${dropNumber} IS LIVE</div>
              <div style="font-size:12px;color:#8a8a8a;letter-spacing:0.15em;margin-bottom:40px;">SHOP OPEN FOR 48 HOURS</div>
              <div style="font-size:11px;color:#8a8a8a;letter-spacing:0.2em;margin-bottom:12px;">YOUR PASSWORD</div>
              <div style="font-size:32px;font-weight:700;letter-spacing:0.3em;color:#f4f4f4;background:#111;padding:20px 24px;margin-bottom:40px;text-align:center;">${password}</div>
              <a href="https://22hundred.shop/shop" style="display:block;background:#f4f4f4;color:#000;text-align:center;padding:16px;font-size:11px;font-weight:700;letter-spacing:0.3em;text-decoration:none;">ENTER THE SHOP</a>
              <div style="margin-top:32px;font-size:10px;color:#3a3a3a;letter-spacing:0.15em;">SHOP CLOSES ${closeAt.toLocaleString('en-US',{timeZone:'America/Detroit',hour12:true})} ET</div>
            </div>
          `,
        });
        emailsSent++;
      } catch { errors++; }
    }

    // SMS
    if (twilioReady && s.phone) {
      const to = normalizePhone(s.phone);
      if (to) {
        try {
          await smsClient.messages.create({
            body: msg,
            from: process.env.TWILIO_PHONE_NUMBER,
            to,
          });
          smsSent++;
        } catch { errors++; }
      }
    }
  }));

  // Update drop record with blast stats
  await db.collection('22h_drops').doc(`drop_${dropNumber}`).update({
    blastSentAt: new Date().toISOString(),
    emailsSent, smsSent, errors,
    recipientCount: docs.length,
  });

  // Discord log
  await fetch(DISCORD, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      embeds: [{
        title: `22HUNDRED — DROP ${dropNumber} LAUNCHED`,
        color: 0x22c55e,
        fields: [
          { name: 'Password', value: `\`${password}\``, inline: true },
          { name: 'Recipients', value: String(docs.length), inline: true },
          { name: 'Emails Sent', value: String(emailsSent), inline: true },
          { name: 'SMS Sent', value: String(smsSent), inline: true },
          { name: 'Errors', value: String(errors), inline: true },
          { name: 'Shop Closes', value: closeAt.toLocaleString('en-US', { timeZone: 'America/Detroit', hour12: true }) + ' ET', inline: false },
        ],
        footer: { text: '22hundred.shop' },
      }],
    }),
  }).catch(() => {});

  res.json({ ok: true, dropNumber, password, emailsSent, smsSent, errors });
};
