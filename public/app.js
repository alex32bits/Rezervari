const $ = s => document.querySelector(s);
const ZILE = ['Duminică','Luni','Marți','Miercuri','Joi','Vineri','Sâmbătă'];
const LOOK = { // culoare + emoji + desenul terenului (linii animate)
  minifotbal: { c:'#2f7d4f', e:'⚽', svg:`<rect x="10" y="10" width="280" height="160" rx="4"/><path d="M150 10v160"/><circle cx="150" cy="90" r="28"/><path d="M10 55h38v70H10M290 55h-38v70h38"/>` },
  handbal:    { c:'#2b5fa8', e:'🤾', svg:`<rect x="15" y="22.5" width="270" height="135"/><path d="M150 22.5v135"/><path d="M15 39.4A40.5 40.5 0 0 1 55.5 79.9V100.1A40.5 40.5 0 0 1 15 140.6M285 39.4A40.5 40.5 0 0 0 244.5 79.9V100.1A40.5 40.5 0 0 0 285 140.6"/><path dash d="M34.9 22.5A60.75 60.75 0 0 1 75.75 79.9V100.1A60.75 60.75 0 0 1 34.9 157.5M265.1 22.5A60.75 60.75 0 0 0 224.25 79.9V100.1A60.75 60.75 0 0 0 265.1 157.5"/><path d="M15 79.9h-5v20.2h5M285 79.9h5v20.2h-5"/><path d="M62.25 86.6v6.8M237.75 86.6v6.8"/>` },
  baschet:    { c:'#c97d1f', e:'🏀', svg:`<rect x="15" y="17.7" width="270" height="144.6"/><path d="M150 17.7v144.6M150 72.6a17.4 17.4 0 1 0 0 34.8a17.4 17.4 0 1 0 0-34.8"/><path d="M15 66.4H70.9V113.6H15M285 66.4H229.1V113.6H285"/><path d="M15 26.4H44.1A65.1 65.1 0 0 1 44.1 153.6H15M285 26.4H255.9A65.1 65.1 0 0 0 255.9 153.6H285"/><path d="M70.9 72.6A17.4 17.4 0 0 1 70.9 107.4M229.1 72.6A17.4 17.4 0 0 0 229.1 107.4M15 77.95h15.2A12.05 12.05 0 0 1 30.2 102.05H15M285 77.95h-15.2A12.05 12.05 0 0 0 269.8 102.05H285M26.6 81.3v17.4M273.4 81.3v17.4"/><path dash d="M70.9 72.6A17.4 17.4 0 0 0 70.9 107.4M229.1 72.6A17.4 17.4 0 0 1 229.1 107.4"/><circle cx="30.2" cy="90" r="3"/><circle cx="269.8" cy="90" r="3"/>` },
  tenis:      { c:'#b5532f', e:'🎾', svg:`<rect x="15" y="28" width="270" height="124"/><path d="M15 43.5h270M15 136.5h270"/><path d="M77 43.5v93M223 43.5v93M77 90h146"/><path d="M150 22v136"/><path d="M15 90h7M285 90h-7"/>` },
};
let blocks = [], bookSig = '', quiet = false;
const blockFor = (c, d, s) => blocks.find(b => b.court === c && b.date === d && (!b.start || b.start === s));
let cfg, me, mode = 'login', court, day, bookings = [], justKey = null;

const api = async (url, method = 'GET', body) => {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error || 'Eroare'), { status: r.status, conflicts: d.conflicts });
  return d;
};
const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const longDate = s => new Date(s + 'T12:00').toLocaleDateString('ro-RO', { weekday:'long', day:'numeric', month:'long' });
const past = (d, t) => new Date(`${d}T${t}:00`) < new Date();
function toast(t) { const e = $('#toast'); e.textContent = t; e.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.remove('on'), 2800); }

/* ---------- Autentificare + resetare parolă ---------- */
let resetToken = new URLSearchParams(location.search).get('reset');
function setMode(m) {
  mode = m;
  const tabs = m === 'login' || m === 'register';
  document.querySelectorAll('.auth-tabs button').forEach(x => x.classList.toggle('on', x.dataset.m === m));
  $('#authTabs').hidden = !tabs; $('#authTitle').hidden = tabs; $('#back').hidden = tabs;
  $('#nameRow').hidden = m !== 'register'; $('#emailRow').hidden = m === 'reset'; $('#passRow').hidden = m === 'forgot';
  $('#forgotLink').hidden = m !== 'login';
  $('#authTitle').textContent = m === 'forgot' ? 'Resetare parolă' : 'Alege o parolă nouă';
  $('#passLbl').textContent = m === 'reset' ? 'Parola nouă' : 'Parolă';
  $('#form').password.autocomplete = m === 'login' ? 'current-password' : 'new-password';
  $('#submit').textContent = { login: 'Intră în cont', register: 'Creează cont', forgot: 'Trimite linkul de resetare', reset: 'Salvează parola' }[m];
  $('#err').textContent = ''; $('#info').textContent = '';
}
document.querySelectorAll('.auth-tabs button').forEach(b => b.onclick = () => setMode(b.dataset.m));
$('#forgotLink').onclick = () => setMode('forgot');
$('#back').onclick = () => { if (resetToken) { history.replaceState(null, '', '/'); resetToken = null; } setMode('login'); };
$('#form').onsubmit = async e => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  $('#submit').disabled = true; $('#err').textContent = ''; $('#info').textContent = '';
  try {
    if (mode === 'forgot') {
      await api('/api/forgot', 'POST', { email: f.email });
      $('#info').textContent = 'Dacă există un cont cu această adresă, vei primi un link de resetare (valabil 1 oră). Verifică și folderul Spam. Dacă nu ajunge, contactează administratorul.';
    } else if (mode === 'reset') {
      me = await api('/api/reset', 'POST', { token: resetToken, password: f.password });
      history.replaceState(null, '', '/'); resetToken = null;
      await start(); toast('Parola a fost schimbată ✅');
    } else { me = await api('/api/' + mode, 'POST', f); await start(); }
  } catch (err) { const el = $('#err'); el.textContent = err.message; el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }
  $('#submit').disabled = false;
};
$('#logout').onclick = async () => { await api('/api/logout', 'POST'); location.reload(); };

/* ---------- Pornire ---------- */
async function start() {
  cfg = await api('/api/config');
  court = court || cfg.courts[0].id;
  day = iso(new Date());
  $('#auth').hidden = true; $('#main').hidden = false; $('#logout').hidden = false; $('#uname').hidden = false;
  $('#uname').textContent = '👤 ' + me.name;
  $('#adminTab').hidden = !me.isAdmin;
  await load();
  setInterval(() => load(true), 8000); checkUnread(); setInterval(checkUnread, 6000); // actualizare automată: vezi rezervările celorlalți
}
async function load(silent) {
  try {
    const [b, bl] = await Promise.all([api('/api/bookings'), api('/api/blocks')]);
    // la actualizarea automată (silent) redesenăm doar dacă s-a schimbat ceva (sau a trecut un minut)
    const sig = JSON.stringify([b, bl]) + new Date().toISOString().slice(0, 16);
    if (silent && sig === bookSig) return;
    bookSig = sig; bookings = b; blocks = bl;
    quiet = !!silent; render(); quiet = false; // fără animații de intrare la actualizările automate
  }
  catch (e) { if (e.status === 401) location.reload(); else if (!silent) toast(e.message); }
}

/* ---------- Randare ---------- */
function drawHeader() {
  const L = LOOK[court], c = cfg.courts.find(x => x.id === court);
  document.documentElement.style.setProperty('--court', L.c);
  $('#cname').textContent = c.name;
  $('#cdate').textContent = longDate(day);
  $('#pitch').innerHTML = `<svg viewBox="0 0 300 180">${L.svg.replace(/<(rect|path|circle)(\s+dash)?/g, (m, t, d) => `<${t} class="ln${d ? ' dsh' : ''}" pathLength="1"`)}</svg>`;
}
function renderTabs() {
  $('#courts').innerHTML = cfg.courts.map(c => `<button class="court-btn ${c.id===court?'on':''}" style="--cc:${LOOK[c.id].c}" data-c="${c.id}"><span>${LOOK[c.id].e}</span>${c.name}<small data-n="${c.id}"></small></button>`).join('');
}
function renderDays() {
  const out = [];
  for (let i = 0; i < cfg.daysAhead; i++) { const d = new Date(); d.setDate(d.getDate() + i);
    out.push(`<button class="day ${iso(d)===day?'on':''}" data-d="${iso(d)}"><small>${ZILE[d.getDay()].slice(0,3)}</small><b>${d.getDate()}</b><small>${d.toLocaleDateString('ro-RO',{month:'short'})}</small></button>`); }
  $('#days').innerHTML = out.join('');
}
function renderSlots() {
  const c = cfg.courts.find(x => x.id === court);
  $('#slots').classList.toggle('quiet', quiet);
  $('#slots').innerHTML = c.slots.map(([a, b], i) => {
    const bk = bookings.find(x => x.court === court && x.date === day && x.start === a), p = past(day, a);
    let cls = 'slot', st, btn = '';
    if (bk) { const mine = bk.uid === me.id; cls += mine ? ' mine' : ' busy'; st = mine ? 'Rezervat de tine' : 'Ocupat de ' + esc(bk.name);
      if (mine && !p) btn = `<button class="act del" data-del="${bk.id}">Șterge rezervarea</button>`; }
    else if (blockFor(court, day, a)) { cls += ' blocked'; const bl = blockFor(court, day, a); st = '🔧 Indisponibil' + (bl.reason ? ' · ' + esc(bl.reason) : ''); }
    else if (p) { cls += ' past'; st = 'Interval trecut'; }
    else { st = '<i class="dot"></i>Liber'; btn = `<button class="act" data-book="${a}">Rezervă</button>`; }
    if (justKey === court + day + a) cls += ' just';
    return `<div class="${cls}" style="--i:${i}" data-id="${bk ? bk.id : ''}"><span class="t">${a} – ${b}</span><span class="s">${st}</span>${btn}</div>`;
  }).join('');
  justKey = null;
}
function renderMine() {
  const m = bookings.filter(b => b.uid === me.id && !past(b.date, b.start)).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  $('#mine').classList.toggle('quiet', quiet);
  $('#mine').innerHTML = m.length ? m.map((b, i) => `<div class="row" style="animation-delay:${i*50}ms"><span><b>${esc(cfg.courts.find(c => c.id === b.court).name)}</b> · ${longDate(b.date)} · ${b.start}–${b.end}</span><span class="rb"><button class="chip" data-ics="${b.id}">📅 Calendar</button><button class="act del" data-del="${b.id}">Șterge</button></span></div>`).join('')
    : '<p class="empty">Nu ai nicio rezervare activă. Alege un interval liber de mai sus.</p>';
  $('#cnt').textContent = `(${m.length}/${cfg.maxActive})`;
  banner(m[0]);
}
const rel = b => { const m = Math.max(0, Math.round((new Date(`${b.date}T${b.start}:00`) - new Date()) / 60000)), d = Math.floor(m / 1440);
  return m < 60 ? `peste ${m} min` : m < 1440 ? `peste ${Math.floor(m / 60)} h` : d === 1 ? 'mâine' : `peste ${d} zile`; };
function banner(b) {
  const n = $('#next'); n.hidden = false;
  n.innerHTML = b
    ? `<span class="em">⏰</span><div><b>Următoarea ta rezervare · ${rel(b)}</b><br>${esc(cfg.courts.find(c => c.id === b.court).name)} · ${longDate(b.date)} · ${b.start}–${b.end}</div>`
    : `<span class="em">👋</span><div><b>Salut, ${esc(me.name.split(' ')[0])}!</b><br>Alege un teren și un interval liber ca să faci prima rezervare.</div>`;
}
function updateCounts() {
  cfg.courts.forEach(c => {
    const n = c.slots.filter(([s]) => !past(day, s) && !bookings.some(b => b.court === c.id && b.date === day && b.start === s) && !blockFor(c.id, day, s)).length;
    const el = document.querySelector(`[data-n="${c.id}"]`); if (el) el.textContent = n ? n + (n === 1 ? ' liber' : ' libere') : 'complet';
  });
}
function confetti(el) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, cols = ['#f5b50a', '#2f7d4f', '#2b5fa8', '#d33a2c', '#e8478b'];
  for (let i = 0; i < 26; i++) {
    const p = document.createElement('i'), ang = Math.random() * Math.PI * 2, d = 60 + Math.random() * 110;
    p.className = 'cf';
    p.style.cssText = `left:${x}px;top:${y}px;background:${cols[i % 5]};--dx:${Math.cos(ang) * d}px;--dy:${Math.sin(ang) * d + 40}px;--r:${Math.random() * 720 - 360}deg`;
    document.body.appendChild(p); setTimeout(() => p.remove(), 1000);
  }
}
function downloadIcs(b) {
  if (!b) return;
  const f = (d, t) => d.replace(/-/g, '') + 'T' + t.replace(':', '') + '00';
  const name = cfg.courts.find(c => c.id === b.court).name;
  const txt = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Baza Sportiva//RO', 'BEGIN:VEVENT', `UID:${b.id}@baza-sportiva`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`, `DTSTART:${f(b.date, b.start)}`, `DTEND:${f(b.date, b.end)}`,
    `SUMMARY:${name} – Baza Sportivă`, 'LOCATION:Baza Sportivă', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([txt], { type: 'text/calendar' })); a.download = `rezervare-${b.date}.ics`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function render(full) {
  if (full || !$('#courts').children.length) { renderTabs(); renderDays(); drawHeader(); }
  renderSlots(); renderMine(); updateCounts();
}

/* ---------- Acțiuni ---------- */
$('#main').addEventListener('click', async e => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.view) setView(t.dataset.view);
  else if (t.dataset.ics) downloadIcs(bookings.find(b => b.id === t.dataset.ics));
  else if (t.dataset.at) { atab = t.dataset.at; renderAdmin(); }
  else if (t.dataset.adel) { if (confirm('Anulezi această rezervare? Clientul o va vedea ca ștearsă.')) adminDo('/api/admin/bookings/' + t.dataset.adel, 'DELETE', 'Rezervare anulată'); }
  else if (t.dataset.bdel) { if (confirm('Ștergi această blocare?')) adminDo('/api/admin/blocks/' + t.dataset.bdel, 'DELETE', 'Blocare ștearsă'); }
  else if (t.dataset.msdel) { if (confirm('Ștergi acest mesaj?')) adminDo('/api/admin/messages/' + t.dataset.msdel, 'DELETE', 'Mesaj șters'); }
  else if (t.dataset.udel) { if (confirm('Ștergi acest utilizator, cu rezervările și mesajele lui?')) adminDo('/api/admin/users/' + t.dataset.udel, 'DELETE', 'Utilizator șters'); }
  else if (t.dataset.ureset) {
    try { const r = await api(`/api/admin/users/${t.dataset.ureset}/reset`, 'POST'); prompt('Trimite acest link clientului (valabil 1 oră). Copiază-l cu Ctrl+C:', r.link); }
    catch (err) { toast(err.message); }
  }
  else if (t.dataset.room) { room = t.dataset.room; chatSig = ''; seen.clear(); $('#msgs').innerHTML = ''; renderRooms(); loadChat(true); }
  else if (t.dataset.mdel) {
    if (!confirm('Ștergi acest mesaj?')) return;
    try { await api(`/api/chat/${room}/${t.dataset.mdel}`, 'DELETE'); chatSig = ''; loadChat(true); } catch (err) { toast(err.message); }
  }
  else if (t.dataset.tpl) {
    const sport = cfg.courts.find(c => c.id === room).name.toLowerCase();
    const f = $('#chatForm').text;
    f.value = t.dataset.tpl === 'search'
      ? `Caut încă ... jucători pentru ${sport}, în data de ... la ora ... Cine se alătură?`
      : `Mai avem nevoie de ... oameni la ${sport}, azi la ora ... Scrieți-mi dacă vreți să veniți!`;
    f.focus();
  }
  else if (t.dataset.c) { court = t.dataset.c; render(true); }
  else if (t.dataset.d) { day = t.dataset.d; render(true); }
  else if (t.dataset.book) {
    t.disabled = true; t.textContent = 'Se salvează…';
    try { await api('/api/bookings', 'POST', { court, date: day, start: t.dataset.book }); justKey = court + day + t.dataset.book; toast('Rezervare confirmată ✅'); confetti(t); }
    catch (err) { toast(err.message); }
    await load();
  } else if (t.dataset.del) {
    if (!confirm('Sigur ștergi această rezervare?')) return;
    const card = t.closest('.slot, .row'); if (card) card.classList.add('gone');
    try { await api('/api/bookings/' + t.dataset.del, 'DELETE'); toast('Rezervarea a fost ștearsă'); }
    catch (err) { toast(err.message); }
    setTimeout(load, 300);
  }
});

/* ---------- Chat pe grupuri ---------- */
let room = null, chatSig = '', chatTimer = null;
const seen = new Set();
const when = t => { const d = new Date(t), h = d.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' });
  return iso(d) === iso(new Date()) ? h : d.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' }) + ', ' + h; };
function setView(v) {
  $('#bookView').hidden = v !== 'book'; $('#chatView').hidden = v !== 'chat'; $('#adminView').hidden = v !== 'admin';
  document.querySelectorAll('.views button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  clearInterval(chatTimer);
  if (v === 'chat') { room = room || court; chatSig = ''; seen.clear(); $('#msgs').innerHTML = ''; renderRooms(); loadChat(true); chatTimer = setInterval(loadChat, 3000); }
  else if (v === 'admin') loadAdmin();
  else render(true);
}
function renderRooms() {
  $('#rooms').innerHTML = cfg.courts.map(c => `<button class="court-btn ${c.id === room ? 'on' : ''}" style="--cc:${LOOK[c.id].c}" data-room="${c.id}"><span>${LOOK[c.id].e}</span>${c.name}<i class="badge" data-rb="${c.id}" hidden></i></button>`).join('');
  document.documentElement.style.setProperty('--court', LOOK[room].c);
  $('#chatTitle').textContent = 'Grup ' + cfg.courts.find(c => c.id === room).name;
  applyBadges();
}
let unread = {};
const avatar = n => { const p = n.trim().split(/\s+/); const ini = ((p[0] || '?')[0] + (p[1] ? p[1][0] : '')).toUpperCase(); let h = 0; for (const ch of n) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `<span class="av" style="background:hsl(${h} 55% 42%)">${esc(ini)}</span>`; };
const readMap = () => { try { return JSON.parse(localStorage.getItem('chatRead_' + me.id) || '{}'); } catch { return {}; } };
const saveRead = m => { try { localStorage.setItem('chatRead_' + me.id, JSON.stringify(m)); } catch {} };
function markRead(r, at) { const m = readMap(); if ((m[r] || 0) < at) { m[r] = at; saveRead(m); } unread[r] = 0; applyBadges(); }
function applyBadges() {
  const inChat = !$('#chatView').hidden; let total = 0;
  cfg.courts.forEach(c => {
    const n = inChat && c.id === room ? 0 : (unread[c.id] || 0); total += n;
    const el = document.querySelector(`[data-rb="${c.id}"]`); if (el) { el.hidden = !n; el.textContent = n > 9 ? '9+' : n; }
  });
  const b = $('#chatBadge'); b.hidden = !total; b.textContent = total > 9 ? '9+' : total;
  document.title = (total ? `(${total}) ` : '') + 'Baza Sportivă – Rezervări';
}
async function checkUnread() {
  try {
    const m = readMap(), r = await api('/api/chat-unread?since=' + encodeURIComponent(JSON.stringify(m)));
    let ch = false; cfg.courts.forEach(c => { if (m[c.id] === undefined) { m[c.id] = r.now; ch = true; } }); if (ch) saveRead(m);
    unread = r.counts; applyBadges();
  } catch {}
}
async function loadChat(force) {
  if (document.hidden && force !== true) return;
  const r = room;
  try {
    const msgs = await api('/api/chat/' + r);
    if (r !== room) return;
    const sig = r + msgs.map(m => m.id).join(',');
    if (sig === chatSig) return;
    const first = chatSig === '';
    if (msgs.length) markRead(r, msgs[msgs.length - 1].at);
    chatSig = sig;
    const box = $('#msgs'), near = box.scrollHeight - box.scrollTop - box.clientHeight < 90;
    box.innerHTML = msgs.length ? msgs.map(m => {
      const mine = m.uid === me.id, fresh = !first && !seen.has(m.id);
      return `<div class="msg ${mine ? 'me' : ''} ${fresh ? 'new' : ''}">${mine ? '' : avatar(m.name)}<div class="bub"><b>${mine ? 'Tu' : esc(m.name)}</b><p>${esc(m.text)}</p><small>${when(m.at)}${mine || me.isAdmin ? ` · <button class="lnk" data-mdel="${m.id}">șterge</button>` : ''}</small></div></div>`;
    }).join('') : '<p class="empty">Niciun mesaj încă. Scrie primul: spune ce joc cauți și când.</p>';
    msgs.forEach(m => seen.add(m.id));
    if (near || first) { box.style.scrollBehavior = 'auto'; box.scrollTop = box.scrollHeight; box.style.scrollBehavior = ''; }
  } catch (e) { if (e.status === 401) location.reload(); }
}
async function sendChat() {
  const f = $('#chatForm').text, text = f.value.trim();
  if (!text) return;
  f.disabled = true;
  try { await api('/api/chat/' + room, 'POST', { text }); f.value = ''; chatSig = ''; await loadChat(true); const b = $('#msgs'); b.scrollTop = b.scrollHeight; }
  catch (err) { toast(err.message); }
  f.disabled = false; f.focus();
}
$('#chatForm').onsubmit = e => { e.preventDefault(); sendChat(); };
$('#chatForm').text.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } });

/* ---------- Contact administrator ---------- */
$('#contactBtn').onclick = async () => {
  try {
    const i = await api('/api/contact-info');
    $('#cname2').textContent = i.name;
    $('#cphone').textContent = '📞 ' + i.phone; $('#cphone').href = 'tel:' + i.phone.replace(/\s/g, '');
    $('#cmail').textContent = '✉ ' + i.email; $('#cmail').href = 'mailto:' + i.email + '?subject=Rezervări teren';
  } catch {}
  $('#msgForm').hidden = !me; $('#msgHint').hidden = !!me; $('#merr').textContent = '';
  $('#contact').showModal();
};
$('#contact').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.close(); });
$('#msgForm').onsubmit = async e => {
  e.preventDefault();
  try { await api('/api/contact', 'POST', { message: e.target.message.value }); e.target.reset(); $('#contact').close(); toast('Mesaj trimis. Administratorul te va contacta ✅'); }
  catch (err) { $('#merr').textContent = err.message; }
};

/* ---------- Panou de administrare ---------- */
let adm = null, atab = 'bk';
const blk = { court: null };
const cName = id => (cfg.courts.find(c => c.id === id) || {}).name || id;
const slotOpts = id => '<option value="">Toată ziua</option>' + cfg.courts.find(c => c.id === id).slots.map(([s, e]) => `<option value="${s}">${s} – ${e}</option>`).join('');
const blockLabel = b => { const c = cfg.courts.find(x => x.id === b.court), s = b.start && c.slots.find(x => x[0] === b.start); return s ? `${s[0]}–${s[1]}` : 'toată ziua'; };
async function loadAdmin() { try { adm = await api('/api/admin/data'); renderAdmin(); } catch (e) { toast(e.message); } }
async function adminDo(url, method, okMsg) { try { await api(url, method); toast(okMsg); await load(true); await loadAdmin(); } catch (err) { toast(err.message); } }
function renderAdmin() {
  if (!adm) return;
  const today = iso(new Date());
  $('#stats').innerHTML = [['📅', adm.bookings.length, 'rezervări active'], ['☀️', adm.bookings.filter(b => b.date === today).length, 'rezervări azi'], ['👥', adm.users.length, 'utilizatori'], ['✉️', adm.messages.length, 'mesaje']]
    .map(([e, n, l], i) => `<div class="stat" style="animation-delay:${i * 60}ms"><span>${e}</span><b>${n}</b><small>${l}</small></div>`).join('');
  document.querySelectorAll('#atabs button').forEach(b => b.classList.toggle('on', b.dataset.at === atab));
  let h = '';
  if (atab === 'bk') {
    h = adm.bookings.length ? adm.bookings.map(b => `<div class="row"><div class="grow"><b>${esc(cName(b.court))}</b> · ${longDate(b.date)} · ${b.start}–${b.end}<br><small>${esc(b.name)} · ${esc(b.email)}</small></div><button class="act del" data-adel="${b.id}">Anulează</button></div>`).join('')
      : '<p class="empty">Nicio rezervare activă.</p>';
  } else if (atab === 'bl') {
    blk.court = blk.court || cfg.courts[0].id;
    h = `<form id="blForm" class="bform">
      <label>Teren<select name="court" id="blCourt">${cfg.courts.map(c => `<option value="${c.id}" ${c.id === blk.court ? 'selected' : ''}>${c.name}</option>`).join('')}</select></label>
      <label>Data<input type="date" name="date" min="${today}" required></label>
      <label>Interval<select name="start" id="blSlot">${slotOpts(blk.court)}</select></label>
      <label>Motiv (îl văd clienții)<input name="reason" maxlength="80" placeholder="Ex: turneu, reparații, ploaie"></label>
      <button class="btn">Blochează</button></form><h3>Blocări active</h3>`;
    h += blocks.length ? blocks.slice().sort((x, y) => (x.date + (x.start || '')).localeCompare(y.date + (y.start || ''))).map(b => `<div class="row"><div class="grow"><b>${esc(cName(b.court))}</b> · ${longDate(b.date)} · ${blockLabel(b)}${b.reason ? `<br><small>${esc(b.reason)}</small>` : ''}</div><button class="act del" data-bdel="${b.id}">Șterge</button></div>`).join('')
      : '<p class="empty">Nicio blocare activă.</p>';
  } else if (atab === 'ms') {
    h = adm.messages.length ? adm.messages.map(m => `<div class="row"><div class="grow"><b>${esc(m.name)}</b> · <small>${esc(m.email)} · ${when(m.at)}</small><p class="msgtxt">${esc(m.text)}</p></div><span class="rb"><a class="chip" href="mailto:${esc(m.email)}?subject=Re: mesajul tău">Răspunde</a><button class="act del" data-msdel="${m.id}">Șterge</button></span></div>`).join('')
      : '<p class="empty">Niciun mesaj primit.</p>';
  } else {
    h = adm.users.map(u => `<div class="row"><div class="grow"><b>${esc(u.name)}</b>${u.admin ? '<span class="tag">admin</span>' : ''}<br><small>${esc(u.email)} · ${u.bookings} rezervări active</small></div><span class="rb"><button class="chip" data-ureset="${u.id}">🔑 Link resetare</button>${u.admin ? '' : `<button class="act del" data-udel="${u.id}">Șterge</button>`}</span></div>`).join('');
  }
  $('#apanel').innerHTML = h;
}
$('#main').addEventListener('change', e => { if (e.target.id === 'blCourt') { blk.court = e.target.value; $('#blSlot').innerHTML = slotOpts(blk.court); } });
$('#main').addEventListener('submit', async e => {
  if (e.target.id !== 'blForm') return;
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  if (!f.date) return toast('Alege data.');
  const body = { court: f.court, date: f.date, start: f.start || null, reason: f.reason };
  try {
    let r;
    try { r = await api('/api/admin/blocks', 'POST', body); }
    catch (err) {
      if (err.status !== 409 || !err.conflicts) throw err;
      if (!confirm(`Se vor anula ${err.conflicts} rezervări existente în acest interval. Continui?`)) return;
      r = await api('/api/admin/blocks', 'POST', { ...body, force: true });
    }
    toast(r.cancelled ? `Blocat. ${r.cancelled} rezervări anulate.` : 'Interval blocat ✅');
    await load(true); await loadAdmin();
  } catch (err) { toast(err.message); }
});

/* ---------- Start ---------- */
(async () => {
  if (resetToken) { $('#auth').hidden = false; setMode('reset'); return; }
  try { me = await api('/api/me'); await start(); }
  catch { $('#auth').hidden = false; }
})();