const db = require('./_db');
const crypto = require('crypto');

const DISCORD = 'https://discord.com/api/webhooks/1508601284951801856/9f_Iesfpjb5vGNwGo1ewkedYEZ5zgyQTZfdmkjdZOd_hWnBMe5DnM43oX6WVWiERFKAe';

function uid() {
  return '22h_' + crypto.randomBytes(5).toString('hex');
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { name, phone, email } = req.body || {};
  if (!name || (!phone && !email)) {
    return res.status(400).json({ error: 'Name and phone or email required' });
  }

  // Server-side dedup — check Firestore
  const col = db.collection('22h_signups');
  if (email) {
    const existing = await col.where('email', '==', email.toLowerCase()).limit(1).get();
    if (!existing.empty) return res.json({ ok: true, dup: true });
  }
  if (phone && !email) {
    const existing = await col.where('phone', '==', phone).limit(1).get();
    if (!existing.empty) return res.json({ ok: true, dup: true });
  }

  const id = uid();
  const ts = new Date().toISOString();
  const detroit = new Date().toLocaleString('en-US', { timeZone: 'America/Detroit', hour12: true });

  await col.doc(id).set({
    id, name,
    phone: phone || '',
    email: email ? email.toLowerCase() : '',
    signedUpAt: ts,
    active: true,
  });

  // Discord embed
  await fetch(DISCORD, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      embeds: [{
        title: '22HUNDRED — New Signup',
        color: 0xd4af37,
        fields: [
          { name: 'ID',    value: `\`${id}\``, inline: true },
          { name: 'Name',  value: name,         inline: true },
          { name: 'Email', value: email || '—', inline: false },
          { name: 'Phone', value: phone || '—', inline: true },
          { name: 'Time',  value: detroit,       inline: true },
        ],
        footer: { text: '22hundred.shop' },
      }],
    }),
  }).catch(() => {});

  res.json({ ok: true, id });
};
