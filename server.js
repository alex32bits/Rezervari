const express = require('express');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

const PORT = process.env.PORT || 3000;
const SECRET = process.env.SECRET || '001122';
const DB_FILE = path.join(__dirname, 'data.json');
const DAYS_AHEAD = 7;
const MAX_ACTIVE = Number(process.env.MAX_ACTIVE) || 4; // rezervări active / utilizator
// Datele administratorului – setează-le cu variabile de mediu sau modifică aici
const ADMIN = {
  name: process.env.ADMIN_NAME || 'Alex Solomon',
  phone: process.env.ADMIN_PHONE || '+40 745241004',
  email: process.env.ADMIN_EMAIL || 'admin@baza-sportiva.ro',
};
// Conturile cu aceste adrese de email sunt administratori (separate prin virgulă).
// IMPORTANT: creează-ți contul de administrator imediat după prima pornire.
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || ADMIN.email).split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
const isAdmin = u => ADMIN_EMAILS.includes(u.email);

// ---- Terenuri și intervale (o singură sursă de adevăr, folosită și de client) ----
const hm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const tennis = [];
for (let m = 8 * 60 + 30; m < 23 * 60 + 30; m += 90) tennis.push([hm(m), hm(m + 90)]);
const night = [['20:30', '22:00'], ['22:00', '23:00']];
const COURTS = [
  { id: 'minifotbal', name: 'Minifotbal', slots: night },
  { id: 'handbal', name: 'Handbal', slots: night },
  { id: 'baschet', name: 'Baschet', slots: night },
  { id: 'tenis', name: 'Tenis de câmp', slots: tennis },
];

// ---- Stocare simplă în fișier JSON ----
let db = { users: [], bookings: [], messages: [], chat: [], blocks: [], resets: [] };
if (fs.existsSync(DB_FILE)) db = { ...db, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) };
const save = () => {
  fs.writeFileSync(DB_FILE + '.tmp', JSON.stringify(db, null, 2));
  fs.renameSync(DB_FILE + '.tmp', DB_FILE);
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pad = n => String(n).padStart(2, '0');
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const auth = (req, res, next) => {
  try {
    const { id, ver } = jwt.verify(req.cookies.token, SECRET);
    const user = db.users.find(u => u.id === id);
    if (!user || (user.ver || 0) !== (ver || 0)) throw 0; // parola schimbată => sesiunile vechi expiră
    req.user = user;
    next();
  } catch { res.status(401).json({ error: 'Trebuie să fii autentificat.' }); }
};
const login = (res, user) => {
  const token = jwt.sign({ id: user.id, ver: user.ver || 0 }, SECRET, { expiresIn: '30d' });
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 864e5 });
  res.json({ id: user.id, name: user.name, isAdmin: isAdmin(user) });
};

app.post('/api/register', (req, res) => {
  const { name = '', email = '', password = '' } = req.body;
  if (name.trim().length < 2) return res.status(400).json({ error: 'Introdu un nume (minim 2 caractere).' });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Adresa de email nu este validă.' });
  if (password.length < 6) return res.status(400).json({ error: 'Parola trebuie să aibă minim 6 caractere.' });
  if (db.users.some(u => u.email === email.toLowerCase())) return res.status(409).json({ error: 'Există deja un cont cu acest email.' });
  const user = { id: uid(), name: name.trim(), email: email.toLowerCase(), hash: bcrypt.hashSync(password, 10) };
  db.users.push(user); save();
  login(res, user);
});

app.post('/api/login', (req, res) => {
  const { email = '', password = '' } = req.body;
  const user = db.users.find(u => u.email === email.toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.hash)) return res.status(401).json({ error: 'Email sau parolă greșită.' });
  login(res, user);
});

app.post('/api/logout', (req, res) => { res.clearCookie('token'); res.json({ ok: true }); });
app.get('/api/me', auth, (req, res) => res.json({ id: req.user.id, name: req.user.name, isAdmin: isAdmin(req.user) }));
app.get('/api/config', auth, (req, res) => res.json({ courts: COURTS, daysAhead: DAYS_AHEAD, maxActive: MAX_ACTIVE }));

app.get('/api/bookings', auth, (req, res) => {
  const today = isoDate(new Date());
  res.json(db.bookings.filter(b => b.date >= today));
});

app.post('/api/bookings', auth, (req, res) => {
  const { court, date, start } = req.body;
  const c = COURTS.find(x => x.id === court);
  const slot = c && c.slots.find(s => s[0] === start);
  if (!slot) return res.status(400).json({ error: 'Teren sau interval invalid.' });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(date + 'T00:00:00');
  const diff = Math.round((d - today) / 864e5);
  if (isNaN(diff) || diff < 0 || diff >= DAYS_AHEAD) return res.status(400).json({ error: 'Data este în afara perioadei de rezervare.' });
  if (new Date(`${date}T${start}:00`) < new Date()) return res.status(400).json({ error: 'Intervalul a trecut deja.' });
  if (db.blocks.some(b => b.court === court && b.date === date && (!b.start || b.start === start)))
    return res.status(409).json({ error: 'Intervalul nu este disponibil (blocat de administrator).' });
  const active = db.bookings.filter(b => b.uid === req.user.id && new Date(`${b.date}T${b.start}:00`) >= new Date()).length;
  if (active >= MAX_ACTIVE) return res.status(400).json({ error: `Ai atins limita de ${MAX_ACTIVE} rezervări active. Șterge una ca să poți face alta.` });
  if (db.bookings.some(b => b.court === court && b.date === date && b.start === start))
    return res.status(409).json({ error: 'Intervalul a fost rezervat între timp de altcineva.' });
  const b = { id: uid(), court, date, start, end: slot[1], uid: req.user.id, name: req.user.name, at: Date.now() };
  db.bookings.push(b); save();
  res.status(201).json(b);
});

app.delete('/api/bookings/:id', auth, (req, res) => {
  const i = db.bookings.findIndex(b => b.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Rezervarea nu mai există.' });
  if (db.bookings[i].uid !== req.user.id) return res.status(403).json({ error: 'Poți șterge doar rezervările tale.' });
  db.bookings.splice(i, 1); save();
  res.json({ ok: true });
});

// ---- Chat pe grupuri: câte un grup pentru fiecare sport ----
const inRoom = (req, res, next) => COURTS.some(c => c.id === req.params.room) ? next() : res.status(404).json({ error: 'Grup inexistent.' });
app.get('/api/chat/:room', auth, inRoom, (req, res) => {
  res.json(db.chat.filter(m => m.room === req.params.room).slice(-100));
});
app.post('/api/chat/:room', auth, inRoom, (req, res) => {
  const text = String(req.body.text || '').trim();
  const room = req.params.room;
  if (!text) return res.status(400).json({ error: 'Scrie un mesaj.' });
  if (text.length > 500) return res.status(400).json({ error: 'Mesajul este prea lung (maxim 500 caractere).' });
  const recent = db.chat.filter(m => m.uid === req.user.id && Date.now() - m.at < 30000);
  if (recent.length >= 10) return res.status(429).json({ error: 'Scrii prea repede. Așteaptă câteva secunde.' });
  const m = { id: uid(), room, uid: req.user.id, name: req.user.name, text, at: Date.now() };
  db.chat.push(m);
  const keep = db.chat.filter(x => x.room === room).slice(-300); // păstrăm ultimele 300 / grup
  db.chat = db.chat.filter(x => x.room !== room || keep.includes(x));
  save();
  res.status(201).json(m);
});
app.delete('/api/chat/:room/:id', auth, inRoom, (req, res) => {
  const i = db.chat.findIndex(m => m.id === req.params.id && m.room === req.params.room);
  if (i < 0) return res.status(404).json({ error: 'Mesajul nu mai există.' });
  if (db.chat[i].uid !== req.user.id && !isAdmin(req.user)) return res.status(403).json({ error: 'Poți șterge doar mesajele tale.' });
  db.chat.splice(i, 1); save();
  res.json({ ok: true });
});

// Mesaje necitite pe grupuri (clientul trimite ultima oră citită pentru fiecare grup)
app.get('/api/chat-unread', auth, (req, res) => {
  let since = {};
  try { since = JSON.parse(req.query.since || '{}'); } catch {}
  const now = Date.now(), counts = {};
  COURTS.forEach(c => {
    const t = Number(since[c.id]) || now;
    counts[c.id] = db.chat.filter(m => m.room === c.id && m.uid !== req.user.id && m.at > t).length;
  });
  res.json({ now, counts });
});

// ---- Contact administrator ----
app.get('/api/contact-info', (req, res) => res.json(ADMIN));
app.post('/api/contact', auth, (req, res) => {
  const text = String(req.body.message || '').trim();
  if (text.length < 5) return res.status(400).json({ error: 'Scrie un mesaj de minim 5 caractere.' });
  if (text.length > 1000) return res.status(400).json({ error: 'Mesajul este prea lung (maxim 1000 caractere).' });
  const recent = db.messages.filter(m => m.uid === req.user.id && Date.now() - m.at < 60000);
  if (recent.length >= 3) return res.status(429).json({ error: 'Ai trimis prea multe mesaje. Încearcă peste un minut.' });
  db.messages.push({ id: uid(), uid: req.user.id, name: req.user.name, email: req.user.email, text, at: Date.now() });
  save();
  console.log(`[MESAJ NOU] ${req.user.name} <${req.user.email}>: ${text}`);
  res.status(201).json({ ok: true });
});
// ---- Resetare parolă ----
const crypto = require('crypto');
let mailer = null;
if (process.env.SMTP_HOST) {
  try {
    mailer = require('nodemailer').createTransport({
      host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT) || 587, secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  } catch { console.warn('SMTP_HOST este setat, dar nodemailer nu e instalat. Rulează: npm install'); }
}
const sha = t => crypto.createHash('sha256').update(t).digest('hex');
const baseUrl = req => process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
function makeResetToken(user) {
  const token = crypto.randomBytes(32).toString('hex');
  db.resets = db.resets.filter(r => r.uid !== user.id && r.exp > Date.now());
  db.resets.push({ h: sha(token), uid: user.id, exp: Date.now() + 3600e3 }); // valabil 1 oră
  save();
  return token;
}
const forgotTries = new Map();
app.post('/api/forgot', async (req, res) => {
  const now = Date.now(), list = (forgotTries.get(req.ip) || []).filter(t => now - t < 900e3);
  if (list.length >= 5) return res.status(429).json({ error: 'Prea multe încercări. Încearcă din nou peste 15 minute.' });
  list.push(now); forgotTries.set(req.ip, list);
  const user = db.users.find(u => u.email === String(req.body.email || '').trim().toLowerCase());
  if (user) {
    const link = `${baseUrl(req)}/?reset=${makeResetToken(user)}`;
    if (mailer) {
      try {
        await mailer.sendMail({ from: process.env.MAIL_FROM || ADMIN.email, to: user.email, subject: 'Resetare parolă – Baza Sportivă',
          text: `Salut, ${user.name}!\n\nAi cerut resetarea parolei. Intră pe linkul de mai jos (valabil 1 oră):\n${link}\n\nDacă nu ai cerut tu asta, ignoră acest mesaj.` });
      } catch (e) { console.error('Eroare la trimiterea emailului:', e.message); }
    } else console.log(`[RESETARE PAROLĂ] ${user.email}: ${link}`);
  }
  res.json({ ok: true }); // același răspuns indiferent dacă emailul există
});
app.post('/api/reset', (req, res) => {
  const { token = '', password = '' } = req.body;
  if (password.length < 6) return res.status(400).json({ error: 'Parola trebuie să aibă minim 6 caractere.' });
  const r = db.resets.find(x => x.h === sha(String(token)) && x.exp > Date.now());
  const user = r && db.users.find(u => u.id === r.uid);
  if (!user) return res.status(400).json({ error: 'Linkul de resetare este invalid sau a expirat.' });
  user.hash = bcrypt.hashSync(password, 10);
  user.ver = (user.ver || 0) + 1;
  db.resets = db.resets.filter(x => x !== r);
  save();
  login(res, user);
});

// ---- Panou de administrare ----
const adminOnly = (req, res, next) => isAdmin(req.user) ? next() : res.status(403).json({ error: 'Acces interzis.' });
app.get('/api/blocks', auth, (req, res) => res.json(db.blocks.filter(b => b.date >= isoDate(new Date()))));

app.get('/api/admin/data', auth, adminOnly, (req, res) => {
  const today = isoDate(new Date()), byId = Object.fromEntries(db.users.map(u => [u.id, u]));
  res.json({
    bookings: db.bookings.filter(b => b.date >= today).map(b => ({ ...b, email: (byId[b.uid] || {}).email || '' }))
      .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)),
    users: db.users.map(u => ({ id: u.id, name: u.name, email: u.email, admin: isAdmin(u),
      bookings: db.bookings.filter(b => b.uid === u.id && b.date >= today).length })),
    messages: db.messages.slice().reverse(),
  });
});
app.delete('/api/admin/bookings/:id', auth, adminOnly, (req, res) => {
  const n = db.bookings.length;
  db.bookings = db.bookings.filter(b => b.id !== req.params.id);
  if (db.bookings.length === n) return res.status(404).json({ error: 'Rezervarea nu mai există.' });
  save(); res.json({ ok: true });
});
app.post('/api/admin/blocks', auth, adminOnly, (req, res) => {
  const { court, date = '', reason = '', force } = req.body, start = req.body.start || null;
  const c = COURTS.find(x => x.id === court);
  if (!c) return res.status(400).json({ error: 'Teren invalid.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < isoDate(new Date())) return res.status(400).json({ error: 'Data nu este validă (nu poate fi în trecut).' });
  if (start && !c.slots.some(s => s[0] === start)) return res.status(400).json({ error: 'Interval invalid.' });
  const hit = b => b.court === court && b.date === date && (!start || b.start === start);
  const conflicts = db.bookings.filter(hit);
  if (conflicts.length && !force) return res.status(409).json({ error: 'Există rezervări în acest interval.', conflicts: conflicts.length });
  db.bookings = db.bookings.filter(b => !hit(b));
  const block = { id: uid(), court, date, start, reason: String(reason).trim().slice(0, 80) };
  db.blocks.push(block); save();
  res.status(201).json({ block, cancelled: conflicts.length });
});
app.delete('/api/admin/blocks/:id', auth, adminOnly, (req, res) => {
  const n = db.blocks.length;
  db.blocks = db.blocks.filter(b => b.id !== req.params.id);
  if (db.blocks.length === n) return res.status(404).json({ error: 'Blocarea nu mai există.' });
  save(); res.json({ ok: true });
});
app.delete('/api/admin/messages/:id', auth, adminOnly, (req, res) => {
  db.messages = db.messages.filter(m => m.id !== req.params.id); save(); res.json({ ok: true });
});
app.post('/api/admin/users/:id/reset', auth, adminOnly, (req, res) => {
  const u = db.users.find(x => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'Utilizator inexistent.' });
  res.json({ link: `${baseUrl(req)}/?reset=${makeResetToken(u)}` });
});
app.delete('/api/admin/users/:id', auth, adminOnly, (req, res) => {
  const u = db.users.find(x => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'Utilizator inexistent.' });
  if (isAdmin(u)) return res.status(400).json({ error: 'Nu poți șterge un administrator.' });
  db.users = db.users.filter(x => x.id !== u.id);
  db.bookings = db.bookings.filter(b => b.uid !== u.id);
  db.chat = db.chat.filter(m => m.uid !== u.id);
  db.messages = db.messages.filter(m => m.uid !== u.id);
  db.resets = db.resets.filter(r => r.uid !== u.id);
  save(); res.json({ ok: true });
});

app.listen(PORT, () => console.log(`Rezervări pornite pe http://localhost:${PORT}`));