# Baza Sportivă – Rezervări

Node.js + Express, conturi cu email/parolă, bază de date SQLite (fișierul `baza.db`).

## Pornire
```bash
npm install
npm run dev      # sau: npm start
```
Deschide http://localhost:3000

## Baza de date
- Totul se salvează în `baza.db` (se creează singur la prima pornire).
- Pornește goală: nu se importă nimic din `data.json`. Fișierul vechi poate fi șters.
- **Copie de siguranță:** oprește serverul și copiază `baza.db` (și, dacă există, `baza.db-wal` / `baza.db-shm`).
- Rezervările și blocările mai vechi de 90 de zile se șterg automat.
- Poți vedea tabelele cu extensia „SQLite Viewer” din VS Code sau cu DB Browser for SQLite.

## Configurare (variabile de mediu)
- `SECRET` – cheie pentru sesiuni (obligatoriu în producție)
- `PORT` – portul serverului (implicit 3000)
- `DB_FILE` – calea fișierului bazei de date (implicit `baza.db`)
- `ADMIN_EMAILS` – conturile cu aceste emailuri (separate prin virgulă) sunt administratori. Creează contul de admin imediat după prima pornire!
- `ADMIN_PHONE`, `ADMIN_EMAIL`, `ADMIN_NAME` – datele de contact afișate în butonul „Contact”
- `MAX_ACTIVE` – câte rezervări active poate avea un utilizator (implicit 4)
- `BASE_URL` – adresa publică a site-ului, folosită în linkurile de resetare (ex: https://rezervari.ro)
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` – trimiterea emailurilor de resetare.
  Fără ele, linkul apare în consola serverului, iar adminul poate genera linkuri din panou.

Terenurile și intervalele se schimbă în `server.js`, la `COURTS`.

## Structură
- `server.js` – API, baza de date, autentificare, validări
- `public/` – interfața (`index.html`, `style.css`, `app.js`)