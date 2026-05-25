const db = require('./_db');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { password } = req.body || {};
  if (!password) return res.status(400).json({ ok: false });

  const now = new Date();

  // Find an active drop whose window is currently open
  const snap = await db.collection('22h_drops')
    .where('status', '==', 'active')
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get();

  if (snap.empty) return res.json({ ok: false, reason: 'no_active_drop' });

  const drop = snap.docs[0].data();
  const closeAt = new Date(drop.closeAt);

  if (now > closeAt) {
    // Auto-close expired drops
    await snap.docs[0].ref.update({ status: 'closed' });
    return res.json({ ok: false, reason: 'drop_closed' });
  }

  if (password.toUpperCase().trim() !== drop.password) {
    return res.json({ ok: false, reason: 'invalid_password' });
  }

  res.json({
    ok: true,
    dropNumber: drop.dropNumber,
    closeAt: drop.closeAt,
  });
};
