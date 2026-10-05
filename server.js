const express = require('express');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const Database = require('better-sqlite3');

const PORT = process.env.PORT || 3000;
const SECRET = process.env.SECRET || 'schimba-acest-secret-in-productie';
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'baza.db');
const DAYS_AHEAD = 7;
const MAX_ACTIVE = Number(process.env.MAX_ACTIVE) || 4; // rezervări active / utilizator
// Datele administratorului – setează-le cu variabile de mediu sau modifică aici
const ADMIN = {
  name: process.env.ADMIN_NAME || 'Alex Solomon',
  phone: process.env.ADMIN_PHONE || '+40 745324567',
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

// ---- Baza de date SQLite (un singur fișier: baza.db) ----
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, hash TEXT NOT NULL, ver INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY, court TEXT NOT NULL, date TEXT NOT NULL, start TEXT NOT NULL, stop TEXT NOT NULL,
  uid TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, at INTEGER NOT NULL,
  UNIQUE (court, date, start));            -- imposibil să existe două rezervări pe același interval
CREATE INDEX IF NOT EXISTS idx_bookings_uid ON bookings(uid);
CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date);
CREATE TABLE IF NOT EXISTS blocks (
  id TEXT PRIMARY KEY, court TEXT NOT NULL, date TEXT NOT NULL, start TEXT, reason TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS chat (
  id TEXT PRIMARY KEY, room TEXT NOT NULL, uid TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_chat_room ON chat(room, at);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, uid TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, email TEXT NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS resets (
  h TEXT PRIMARY KEY, uid TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, exp INTEGER NOT NULL);
`);

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pad = n => String(n).padStart(2, '0');
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const nowKey = () => { const d = new Date(); return `${isoDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
// Rezervările, cu numele (și emailul) clientului, în forma folosită de aplicație
const BOOKINGS = `SELECT b.id, b.court, b.date, b.start, b.stop AS "end", b.uid, b.at, u.name, u.email
                  FROM bookings b JOIN users u ON u.id = b.uid`;

// Curățenie zilnică: rezervări/blocări mai vechi de 90 de zile și linkuri de resetare expirate
const cleanup = () => {
  db.prepare("DELETE FROM bookings WHERE date < date('now','-90 days')").run();
  db.prepare("DELETE FROM blocks WHERE date < date('now','-90 days')").run();
  db.prepare('DELETE FROM resets WHERE exp < ?').run(Date.now());
};
cleanup(); setInterval(cleanup, 864e5).unref();

// ---- Server HTTP + API REST ----
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Middleware pentru autentificare: verifică tokenul JWT din cookie și atașează userul la req.user
const auth = (req, res, next) => {
  try {
    const { id, ver } = jwt.verify(req.cookies.token, SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user || user.ver !== (ver || 0)) throw 0; // parola schimbată => sesiunile vechi expiră
    req.user = user;
    next();
  } catch { res.status(401).json({ error: 'Trebuie să fii autentificat.' }); }
};
const login = (res, user) => {
  const token = jwt.sign({ id: user.id, ver: user.ver }, SECRET, { expiresIn: '30d' });
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 864e5 });
  res.json({ id: user.id, name: user.name, isAdmin: isAdmin(user) });
};
// ---- Rute API pentru clientul web ----
app.post('/api/register', (req, res) => {
  const { name = '', email = '', password = '' } = req.body;
  if (name.trim().length < 2) return res.status(400).json({ error: 'Introdu un nume (minim 2 caractere).' });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Adresa de email nu este validă.' });
  if (password.length < 6) return res.status(400).json({ error: 'Parola trebuie să aibă minim 6 caractere.' });
  const user = { id: uid(), name: name.trim(), email: email.trim().toLowerCase(), hash: bcrypt.hashSync(password, 10), ver: 0 };
  try { db.prepare('INSERT INTO users (id,name,email,hash,ver) VALUES (@id,@name,@email,@hash,@ver)').run(user); }
  catch (e) { if (String(e.code).startsWith('SQLITE_CONSTRAINT')) return res.status(409).json({ error: 'Există deja un cont cu acest email.' }); throw e; }
  login(res, user);
});

app.post('/api/login', (req, res) => {
  const { email = '', password = '' } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).trim().toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.hash)) return res.status(401).json({ error: 'Email sau parolă greșită.' });
  login(res, user);
});

app.post('/api/logout', (req, res) => { res.clearCookie('token'); res.json({ ok: true }); });
app.get('/api/me', auth, (req, res) => res.json({ id: req.user.id, name: req.user.name, isAdmin: isAdmin(req.user) }));
app.get('/api/config', auth, (req, res) => res.json({ courts: COURTS, daysAhead: DAYS_AHEAD, maxActive: MAX_ACTIVE }));

app.get('/api/bookings', auth, (req, res) => {
  const rows = db.prepare(`${BOOKINGS} WHERE b.date >= ? ORDER BY b.date, b.start`).all(isoDate(new Date()));
  res.json(rows.map(({ email, ...b }) => b)); // emailul clienților nu e public
});

app.post('/api/bookings', auth, (req, res) => {
  const { court, date, start } = req.body;
  const c = COURTS.find(x => x.id === court);
  const slot = c && c.slots.find(s => s[0] === start);
  if (!slot) return res.status(400).json({ error: 'Teren sau interval invalid.' });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(date + 'T00:00:00') - today) / 864e5);
  if (isNaN(diff) || diff < 0 || diff >= DAYS_AHEAD) return res.status(400).json({ error: 'Data este în afara perioadei de rezervare.' });
  if (`${date}T${start}` < nowKey()) return res.status(400).json({ error: 'Intervalul a trecut deja.' });
  if (db.prepare('SELECT 1 FROM blocks WHERE court = ? AND date = ? AND (start IS NULL OR start = ?)').get(court, date, start))
    return res.status(409).json({ error: 'Intervalul nu este disponibil (blocat de administrator).' });
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE uid = ? AND date || 'T' || start >= ?").get(req.user.id, nowKey());
  if (n >= MAX_ACTIVE) return res.status(400).json({ error: `Ai atins limita de ${MAX_ACTIVE} rezervări active. Șterge una ca să poți face alta.` });
  const b = { id: uid(), court, date, start, end: slot[1], uid: req.user.id, name: req.user.name, at: Date.now() };
  try { db.prepare('INSERT INTO bookings (id,court,date,start,stop,uid,at) VALUES (?,?,?,?,?,?,?)').run(b.id, court, date, start, b.end, b.uid, b.at); }
  catch (e) { if (String(e.code).startsWith('SQLITE_CONSTRAINT')) return res.status(409).json({ error: 'Intervalul a fost rezervat între timp de altcineva.' }); throw e; }
  res.status(201).json(b);
});

app.delete('/api/bookings/:id', auth, (req, res) => {
  const b = db.prepare('SELECT uid FROM bookings WHERE id = ?').get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Rezervarea nu mai există.' });
  if (b.uid !== req.user.id) return res.status(403).json({ error: 'Poți șterge doar rezervările tale.' });
  db.prepare('DELETE FROM bookings WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---- Chat pe grupuri: câte un grup pentru fiecare sport ----
const inRoom = (req, res, next) => COURTS.some(c => c.id === req.params.room) ? next() : res.status(404).json({ error: 'Grup inexistent.' });
app.get('/api/chat/:room', auth, inRoom, (req, res) => {
  res.json(db.prepare(`SELECT id, room, uid, name, text, at FROM
    (SELECT rowid AS rid, * FROM chat WHERE room = ? ORDER BY at DESC, rowid DESC LIMIT 100) ORDER BY at, rid`).all(req.params.room));
});
app.post('/api/chat/:room', auth, inRoom, (req, res) => {
  const text = String(req.body.text || '').trim(), room = req.params.room;
  if (!text) return res.status(400).json({ error: 'Scrie un mesaj.' });
  if (text.length > 500) return res.status(400).json({ error: 'Mesajul este prea lung (maxim 500 caractere).' });
  if (db.prepare('SELECT COUNT(*) AS n FROM chat WHERE uid = ? AND at > ?').get(req.user.id, Date.now() - 30000).n >= 10)
    return res.status(429).json({ error: 'Scrii prea repede. Așteaptă câteva secunde.' });
  const m = { id: uid(), room, uid: req.user.id, name: req.user.name, text, at: Date.now() };
  db.prepare('INSERT INTO chat (id,room,uid,name,text,at) VALUES (@id,@room,@uid,@name,@text,@at)').run(m);
  // păstrăm ultimele 300 de mesaje / grup
  db.prepare('DELETE FROM chat WHERE room = ? AND id NOT IN (SELECT id FROM chat WHERE room = ? ORDER BY at DESC, rowid DESC LIMIT 300)').run(room, room);
  res.status(201).json(m);
});
app.delete('/api/chat/:room/:id', auth, inRoom, (req, res) => {
  const m = db.prepare('SELECT uid FROM chat WHERE id = ? AND room = ?').get(req.params.id, req.params.room);
  if (!m) return res.status(404).json({ error: 'Mesajul nu mai există.' });
  if (m.uid !== req.user.id && !isAdmin(req.user)) return res.status(403).json({ error: 'Poți șterge doar mesajele tale.' });
  db.prepare('DELETE FROM chat WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Mesaje necitite pe grupuri (clientul trimite ultima oră citită pentru fiecare grup)
app.get('/api/chat-unread', auth, (req, res) => {
  let since = {};
  try { since = JSON.parse(req.query.since || '{}'); } catch {}
  const now = Date.now(), counts = {};
  COURTS.forEach(c => {
    counts[c.id] = db.prepare('SELECT COUNT(*) AS n FROM chat WHERE room = ? AND uid != ? AND at > ?')
      .get(c.id, req.user.id, Number(since[c.id]) || now).n;
  });
  res.json({ now, counts });
});

// ---- Contact administrator ----
app.get('/api/contact-info', (req, res) => res.json(ADMIN));
app.post('/api/contact', auth, (req, res) => {
  const text = String(req.body.message || '').trim();
  if (text.length < 5) return res.status(400).json({ error: 'Scrie un mesaj de minim 5 caractere.' });
  if (text.length > 1000) return res.status(400).json({ error: 'Mesajul este prea lung (maxim 1000 caractere).' });
  if (db.prepare('SELECT COUNT(*) AS n FROM messages WHERE uid = ? AND at > ?').get(req.user.id, Date.now() - 60000).n >= 3)
    return res.status(429).json({ error: 'Ai trimis prea multe mesaje. Încearcă peste un minut.' });
  db.prepare('INSERT INTO messages (id,uid,name,email,text,at) VALUES (?,?,?,?,?,?)').run(uid(), req.user.id, req.user.name, req.user.email, text, Date.now());
  console.log(`[MESAJ NOU] ${req.user.name} <${req.user.email}>: ${text}`);
  res.status(201).json({ ok: true });
});

// ---- Resetare parolă ----
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
  db.prepare('DELETE FROM resets WHERE uid = ? OR exp < ?').run(user.id, Date.now());
  db.prepare('INSERT INTO resets (h,uid,exp) VALUES (?,?,?)').run(sha(token), user.id, Date.now() + 3600e3); // valabil 1 oră
  return token;
}
const forgotTries = new Map();
app.post('/api/forgot', async (req, res) => {
  const now = Date.now(), list = (forgotTries.get(req.ip) || []).filter(t => now - t < 900e3);
  if (list.length >= 5) return res.status(429).json({ error: 'Prea multe încercări. Încearcă din nou peste 15 minute.' });
  list.push(now); forgotTries.set(req.ip, list);
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(req.body.email || '').trim().toLowerCase());
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
  const r = db.prepare('SELECT * FROM resets WHERE h = ? AND exp > ?').get(sha(String(token)), Date.now());
  if (!r) return res.status(400).json({ error: 'Linkul de resetare este invalid sau a expirat.' });
  db.transaction(() => {
    db.prepare('UPDATE users SET hash = ?, ver = ver + 1 WHERE id = ?').run(bcrypt.hashSync(password, 10), r.uid);
    db.prepare('DELETE FROM resets WHERE h = ?').run(r.h);
  })();
  login(res, db.prepare('SELECT * FROM users WHERE id = ?').get(r.uid));
});

// ---- Panou de administrare ----
const adminOnly = (req, res, next) => isAdmin(req.user) ? next() : res.status(403).json({ error: 'Acces interzis.' });
app.get('/api/blocks', auth, (req, res) =>
  res.json(db.prepare('SELECT id, court, date, start, reason FROM blocks WHERE date >= ? ORDER BY date, start').all(isoDate(new Date()))));

app.get('/api/admin/data', auth, adminOnly, (req, res) => {
  const today = isoDate(new Date());
  res.json({
    bookings: db.prepare(`${BOOKINGS} WHERE b.date >= ? ORDER BY b.date, b.start`).all(today),
    users: db.prepare(`SELECT u.id, u.name, u.email, (SELECT COUNT(*) FROM bookings b WHERE b.uid = u.id AND b.date >= ?) AS bookings
                       FROM users u ORDER BY u.rowid`).all(today).map(u => ({ ...u, admin: isAdmin(u) })),
    messages: db.prepare('SELECT id, uid, name, email, text, at FROM messages ORDER BY at DESC, rowid DESC').all(),
  });
});
app.delete('/api/admin/bookings/:id', auth, adminOnly, (req, res) => {
  if (!db.prepare('DELETE FROM bookings WHERE id = ?').run(req.params.id).changes) return res.status(404).json({ error: 'Rezervarea nu mai există.' });
  res.json({ ok: true });
});
app.post('/api/admin/blocks', auth, adminOnly, (req, res) => {
  const { court, date = '', reason = '', force } = req.body, start = req.body.start || null;
  const c = COURTS.find(x => x.id === court);
  if (!c) return res.status(400).json({ error: 'Teren invalid.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < isoDate(new Date())) return res.status(400).json({ error: 'Data nu este validă (nu poate fi în trecut).' });
  if (start && !c.slots.some(s => s[0] === start)) return res.status(400).json({ error: 'Interval invalid.' });
  const conflicts = db.prepare('SELECT id FROM bookings WHERE court = ? AND date = ? AND (? IS NULL OR start = ?)').all(court, date, start, start);
  if (conflicts.length && !force) return res.status(409).json({ error: 'Există rezervări în acest interval.', conflicts: conflicts.length });
  const block = { id: uid(), court, date, start, reason: String(reason).trim().slice(0, 80) };
  db.transaction(() => {
    for (const b of conflicts) db.prepare('DELETE FROM bookings WHERE id = ?').run(b.id);
    db.prepare('INSERT INTO blocks (id,court,date,start,reason) VALUES (@id,@court,@date,@start,@reason)').run(block);
  })();
  res.status(201).json({ block, cancelled: conflicts.length });
});
app.delete('/api/admin/blocks/:id', auth, adminOnly, (req, res) => {
  if (!db.prepare('DELETE FROM blocks WHERE id = ?').run(req.params.id).changes) return res.status(404).json({ error: 'Blocarea nu mai există.' });
  res.json({ ok: true });
});
app.delete('/api/admin/messages/:id', auth, adminOnly, (req, res) => {
  db.prepare('DELETE FROM messages WHERE id = ?').run(req.params.id); res.json({ ok: true });
});
app.post('/api/admin/users/:id/reset', auth, adminOnly, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Utilizator inexistent.' });
  res.json({ link: `${baseUrl(req)}/?reset=${makeResetToken(u)}` });
});
app.delete('/api/admin/users/:id', auth, adminOnly, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Utilizator inexistent.' });
  if (isAdmin(u)) return res.status(400).json({ error: 'Nu poți șterge un administrator.' });
  db.prepare('DELETE FROM users WHERE id = ?').run(u.id); // rezervările, mesajele și linkurile lui se șterg automat (CASCADE)
  res.json({ ok: true });
});

const server = app.listen(PORT, () => console.log(`Rezervări pornite pe http://localhost:${PORT} (baza de date: ${path.basename(DB_FILE)})`));
const stop = () => { server.close(); db.close(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);