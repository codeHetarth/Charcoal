# Charcoal

Charcoal is a lightweight markdown note-taking app. Write in the browser, manage notes from a sidebar, and export them as `.md` files. You can try it instantly as a guest, or sign in so notes are saved to your account.

## Features

- **Markdown editor** — [Milkdown](https://milkdown.dev/) with GitHub Flavored Markdown (headings, lists, tables, task lists, strikethrough, code blocks, and syntax highlighting)
- **Links** — type or paste `[text](https://example.com)` (or a bare URL) to create a clickable link; click opens it in a new tab
- **Auto-save** — title and content save as you type
- **Note sidebar** — create, switch, and delete notes; on small screens the list opens as a drawer
- **Guest mode** — notes live in the browser session (until the browser is closed)
- **Accounts** — register, log in, update name and email, log out, and delete your account
- **Transactional email** — welcome, password-reset, and account-deletion emails via [Resend](https://resend.com/)
- **Password reset** — email link (expires in 15 minutes)
- **Export** — download the current note as a markdown file in the browser

## Tech stack

| Layer | Stack |
| --- | --- |
| Frontend | HTML, CSS, vanilla JavaScript (`public/`) |
| Editor | Milkdown 7 (loaded from [esm.sh](https://esm.sh/) on the notes page) |
| Backend | Node.js, Express |
| Database | PostgreSQL |
| Auth | express-session, bcrypt |
| Email | [Resend](https://resend.com/) |

## Project structure

```
Charcoal/
├── Backend/
│   ├── server.js          # Express API and static file server
│   ├── package.json
│   └── .env.example       # copy to .env and fill in values
├── public/                # pages, styles, scripts, images
└── README.md
```

Pages:

- `/` → `/landingpage.html` — landing page (About and Account sections)
- `/notespage.html` — editor
- `/auth.html` — login / register
- `/forgotpassword.html` and `/resetpassword.html` — password reset
- `/privacy.html`, `/terms.html`, `/legal.html` — legal document pages

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later recommended)
- [PostgreSQL](https://www.postgresql.org/) running locally

## Setup

### 1. Install dependencies

```bash
cd Backend
npm install
```

### 2. Configure environment

Copy `Backend/.env.example` to `Backend/.env` and fill in your values:

```
PORT=3000
SESSION_SECRET=change-this-to-a-long-random-string

PGUSER=postgres
PGHOST=localhost
PGDATABASE=charcoalnotesapp
PGPASSWORD=your_postgres_password
PGPORT=5432

RESEND_API_KEY=
```

`RESEND_API_KEY` is required for welcome, account-deletion, and password-reset emails. Without it, those emails will fail (the rest of the app still works).

### 3. Create the database

In PostgreSQL:

```sql
CREATE DATABASE charcoalnotesapp;
```

Then connect to that database and create the tables:

```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL
);

CREATE TABLE notes (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE password_reset_tokens (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
```

### 4. Start the server

From the `Backend/` folder:

```bash
npm start
```

Open [http://localhost:3000/](http://localhost:3000/). The server serves files from `public/` and exposes the API on the same origin.

If port 3000 is already in use:

```bash
PORT=3010 node server.js
```

Do not open the HTML files with `file://` — the notes page talks to the API over HTTP.

## How the editor works

- Notes use markdown. GitHub Flavored Markdown is supported (tables, task lists, strikethrough, fenced code blocks).
- A markdown link such as `[Resend](https://resend.com/)` becomes a clickable **Resend** link. Clicking it opens the URL in a new tab.
- Enter, Arrow Down, or Arrow Right at the end of a code block moves the cursor to a new line below the block.
- Export builds a `.md` file in the browser and downloads it. Nothing is uploaded for export.

## API overview

All requests that need a login use the session cookie (`credentials: include`).

### Auth

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/auth/register` | Create account and sign in |
| `POST` | `/auth/login` | Sign in |
| `POST` | `/auth/logout` | Sign out |
| `GET` | `/auth/me` | Current user |
| `PUT` | `/auth/me` | Update name and email |
| `DELETE` | `/auth/me` | Delete account and notes |
| `POST` | `/auth/forgot-password` | Send reset email |
| `GET` | `/auth/verify-reset-token` | Check reset token |
| `POST` | `/auth/reset-password` | Set a new password |

### Notes

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/notes/mode` | `"account"` or `"guest"` |
| `GET` | `/notes` | List notes |
| `POST` | `/notes` | Create a note |
| `PUT` | `/notes/:id` | Update a note |
| `DELETE` | `/notes/:id` | Delete a note |

Logged-in notes are stored in PostgreSQL. Guest notes are stored in the session and use negative IDs.

## Scripts

| Command | Description |
| --- | --- |
| `npm start` | Run `node server.js` |

## License

Private university project.
