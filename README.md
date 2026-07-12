# PURE MACROS — Calorie & Macro Tracker

A full-stack calorie tracking app: an Express backend persists food logs to a
local JSON file and computes daily totals; a vanilla HTML/CSS/JS dashboard
lets you log meals, watch a calorie progress ring, and track protein/carbs/fat
against daily goals. The UI is locked to an iPhone-width layout, with a
frosted-glass login/register screen gating access — every account gets its
own private dashboard and food log.

Food is logged by picking an item from a local reference database and
entering its weight in grams — the server multiplies each food's per-100g
baseline by `grams / 100` to get exact calories and macros, so there's no
manual macro entry.

The backend serves the frontend directly (static files + JSON API on one
Express server), so there's only ever **one process to run** — no need to
juggle two terminals or ports.

## Run it

```bash
npm install
npm start
```

Then open **http://localhost:3000**.

On Windows you can also just double-click **start.bat** — it installs
dependencies on first run, starts the server, and opens the app in your
browser automatically.

For auto-restart on file changes during development:

```bash
npm run dev
```

## Project layout

```
calorie-tracker-app/
├── server/
│   ├── server.js       Express app: API routes + serves public/
│   ├── db.js            Reads/writes the JSON data file
│   └── data/db.json      Created automatically on first run
├── public/
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
├── package.json
└── start.bat
```

## API

Every route below except `/api/auth/*` and `/api/foods` requires a session
token: send `Authorization: Bearer <token>` (the token returned by register
or login). Each user's entries, settings, water, and weight logs are stored
separately — no account can see another's data.

| Method | Route                    | Description                                   |
|--------|---------------------------|------------------------------------------------|
| POST   | `/api/auth/register`      | Create an account — body `{ username, password }`, returns `{ token, username }` |
| POST   | `/api/auth/login`         | Log in — body `{ username, password }`, returns `{ token, username }` |
| POST   | `/api/auth/logout`        | Invalidate the current session token           |
| GET    | `/api/auth/me`            | Confirm the current token is valid             |
| GET    | `/api/foods`              | Local reference database (kcal/macros per 100g) |
| GET    | `/api/day?date=YYYY-MM-DD`| Entries, totals, and settings for one day      |
| GET    | `/api/entries?date=...`   | List food entries for a date                   |
| POST   | `/api/entries`            | Add a food entry — body `{ date, meal, foodId, grams }` |
| DELETE | `/api/entries/:id`        | Remove a food entry                             |
| GET    | `/api/settings`           | Get calorie/macro goals                         |
| PUT    | `/api/settings`           | Update calorie/macro goals                      |

`POST /api/entries` looks up `foodId` in the server's `FOOD_DB` and computes
`calories`/`protein`/`carbs`/`fat` as `baseline * (grams / 100)` — the client
never sends macro values directly.

Passwords are hashed with `scrypt` (Node's built-in `crypto`); session tokens
are random UUIDs kept in `db.json` and have no expiry, since this is a local,
single-server demo rather than a production auth system.

Data is stored in `server/data/db.json`, created automatically the first time
the server runs. The very first account ever registered inherits any data
logged before accounts existed.
