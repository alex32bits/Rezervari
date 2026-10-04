# Baza Sportivă – Rezervări

Node.js + Express, conturi cu email/parolă, stocare în `data.json`.

## Pornire
```bash
npm install
npm run dev      # sau: npm start
```
Deschide http://localhost:3000

## Configurare
- `SECRET` – cheie pentru sesiuni (obligatoriu în producție): `SECRET=ceva-lung npm start`
- `ADMIN_PHONE`, `ADMIN_EMAIL`, `ADMIN_NAME` – datele de contact afișate în butonul „Contact”
- `ADMIN_EMAILS` – conturile cu aceste emailuri (separate prin virgulă) sunt administratori. Implicit = `ADMIN_EMAIL`. Creează contul de admin imediat după prima pornire!
- `BASE_URL` – adresa publică a site-ului, folosită în linkurile de resetare (ex: https://rezervari.ro)
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` – trimiterea emailurilor de resetare. Fără ele, linkul apare în consola serverului, iar adminul poate genera linkuri din panou.
- `MAX_ACTIVE` – câte rezervări active poate avea un utilizator (implicit 4)
- `PORT` – portul serverului (implicit 3000)
- Terenurile și intervalele se schimbă în `server.js`, la `COURTS`.

## Structură
- `server.js` – API (autentificare, rezervări, validări)
- `public/` – interfața (`index.html`, `style.css`, `app.js`)