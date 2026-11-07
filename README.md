# Charcoal

Charcoal is a browser-based markdown note application developed as part of a university web development project. Users can write notes in the editor, organise them from a sidebar, and export a note as a `.md` file.

## Functionality

Charcoal provides a guest mode to store notes temporarily. Guest notes are kept in the PostgreSQL session row for that browser. The browser drops the session cookie when it closes, signing in replaces the guest session, and the server deletes leftover guest rows within 24 hours of the last guest activity. To store notes permanently, users can register with an account (email and password) and keep their notes in the database, attached to their account.

The navbar on the home page links to the About section and the Account section, where a signed-in user can view and change their details. The footer links to the Privacy Policy, Terms of Service, and Legal Notice.

The notes editor has two views. **Note** is a [Milkdown](https://milkdown.dev/) preview with GitHub Flavored Markdown: headings, lists, tables, task lists, strikethrough, links, and fenced code blocks, with syntax highlighting inside code blocks. **Markdown** is the source of the same note. Changes to the title and the note body are saved automatically from either view. Deleting a note asks for confirmation first.

The notes sidebar is used to create and select a note. On narrow viewports a drawer is used for the same actions. The notes-page navbar can delete and export the current note, and it links to the Account section. Export builds the markdown file in the browser and downloads it locally. The file is not uploaded to the server.

Account features include registration, login, profile updates (name and email), logout, and account deletion. Deleting an account requires the current password and also removes that account’s notes and sessions. Passwords must be 8 to 128 characters, must not contain the account name or email, and must not be a common password. A reset password must differ from the current one.

If a [Resend](https://resend.com/) API key is configured, the application sends transactional email: address confirmation, welcome, password reset, notice of an email change, and deletion confirmation. A new account cannot sign in until the address is confirmed. Confirmation links expire after 24 hours. Changing the email requires the current password; the new address is stored only as a pending address until that link is used, and the current address is notified. Password-reset links expire after 15 minutes and sign out every existing session. If the key is omitted, accounts are created and signed in immediately, an email change is applied at once, and email features are skipped. 

## Implementation

The frontend is written in HTML, CSS and JavaScript.
The server is Node.js with Express.
PostgreSQL stores users, notes, email and password tokens, and sessions.
Sessions use express-session with connect-pg-simple, so the session row lives in the `session` table. The cookie is `connect.sid` (httpOnly, SameSite=Lax, and Secure when `NODE_ENV=production`).
Passwords are stored as bcrypt hashes. Reset and confirmation tokens are stored as SHA-256 hashes.
The server sets `X-Frame-Options`, `X-Content-Type-Options`, and `Referrer-Policy`, and it rate-limits registration, login, and password-reset requests.
Milkdown 7 is loaded from [esm.sh](https://esm.sh/) when the notes page is opened.

## Project structure

```
Charcoal/
├── Backend/
│   ├── server.js          # HTTP API and static file server
│   ├── schema.sql         # reference dump of the account tables
│   ├── package.json
│   ├── test/api.test.js   # registration, login, notes, password reset
│   └── .env.example       # copy to .env
├── public/                # pages, styles, scripts, images
└── README.md
```

Routes (older `*.html` paths redirect to these):

- `/` and `/landingpage` redirect to `/landingpage/home`
- `/landingpage/home`, `/landingpage/about`, `/landingpage/account` — landing page sections
- `/notespage` — notes editor
- `/auth/login`, `/auth/register` — login and registration (`/auth` redirects to login)
- `/forgotpassword`, `/resetpassword` — password reset
- `/verify-email` — confirm an address from the emailed link
- `/privacy`, `/terms`, `/legal` — legal documents

## Requirements

- Node.js 18 or later
- PostgreSQL running locally, or Docker to start the database container below

## Setup

From `Backend/`:

```bash
cd Backend
npm install
```

Copy `Backend/.env.example` as `Backend/.env` and set the following values.

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

`RESEND_API_KEY` is required for confirmation, welcome, password-reset, email-change, and account-deletion emails. When it is set, a new account cannot sign in until the address is confirmed from the email. If the key is omitted, accounts are created and signed in immediately, and email features are skipped.

`SESSION_SECRET` is required. The server exits if it is missing. Optional `APP_BASE_URL` (for example `https://notes.example.com`) is used in email links. When it is omitted, links use `http://localhost:<PORT>`.

Guest notes are stored in the session row. The cookie ends when the browser closes, and the server deletes the row within 24 hours of the last guest activity. Each guest session is limited to 50 notes and 256 KB. Signed-in notes are limited to 500 per account. A title is limited to 200 characters and a note body to 100,000 characters. A display name is limited to 100 characters.

Start PostgreSQL with Docker if it is not already running. Use the same user, password, database name, and port as `Backend/.env`. This creates `charcoalnotesapp`, so skip the `CREATE DATABASE` statement when you use this container. If a container named `charcoal-db` already exists, start it with `docker start charcoal-db` instead of `docker run`.

```bash
docker run --name charcoal-db -d \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=your_postgres_password \
  -e POSTGRES_DB=charcoalnotesapp \
  -p 5432:5432 \
  postgres
```

For a PostgreSQL install without that database:

```sql
CREATE DATABASE charcoalnotesapp;
```

Then create the tables:

```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  email_verified BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE notes (
  id SERIAL PRIMARY KEY,
  title TEXT,
  content TEXT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE password_reset_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

On startup the server creates `session` and `email_verification_tokens` if they are missing, and adds `email_verified` to an older `users` table. Accounts that already exist when that column is added are treated as verified. `Backend/schema.sql` is a reference dump of the account tables; it does not include `session`.

Start the server from `Backend/`:

```bash
npm start
```

This runs `node server.js`. Open [http://localhost:3000/](http://localhost:3000/). Static pages and the API are served from the same origin.

If port 3000 is already in use:

```bash
PORT=3010 node server.js
```

The HTML files should not be opened via `file://`. The notes page calls the API over HTTP and therefore depends on the running server. Thereby, running from files will result in failure to process API related operations.

## Tests

From `Backend/`, with PostgreSQL running and `Backend/.env` set up as above:

```bash
npm test
```

This runs `node --test` on `Backend/test/api.test.js`. Each test states the request it sends and the status and JSON body it expects, for registration, login, notes, and password reset. The tests use the same database as the app. They create accounts at `@example.com` addresses that start with `charcoal-test-` and delete those accounts when the run finishes. The run turns email delivery off, so a new account is signed in immediately. The password-reset test inserts the same kind of token an email link would carry, because no message is sent.

## Editor behaviour

GitHub Flavored Markdown is enabled. That includes tables, task lists, strikethrough, and code blocks.

**Note** shows the rendered note. **Markdown** shows and edits the source. Typing in either view updates the saved note. The title field is separate from headings inside the note: it is the name in the sidebar and the file name used on export.

The editor keeps markdown links and code blocks usable while typing, including leaving a code block with a new paragraph. It loads the Milkdown scripts from esm.sh when the notes page opens.

## API

Authenticated requests send the session cookie (`credentials: include`).

### Authentication

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/auth/register` | Create an account. Signs in immediately when email delivery is off; otherwise sends a confirmation link (24 hours) |
| `GET` | `/verify-email` | Confirm a new address, or apply a pending email change and sign out every existing session |
| `POST` | `/auth/login` | Sign in. Issues a new session id. Refuses an account whose email is not confirmed |
| `POST` | `/auth/logout` | Sign out |
| `GET` | `/auth/me` | Current user (`id`, `name`, `email`) |
| `PUT` | `/auth/me` | Update name and email. Changing email requires the current password. With email delivery, the new address stays pending until confirmed and the current address is notified |
| `DELETE` | `/auth/me` | Delete the account, its notes, and its sessions. Requires the current password |
| `POST` | `/auth/forgot-password` | Request a reset email. The response does not reveal whether the address exists |
| `GET` | `/auth/verify-reset-token` | Validate a reset token |
| `POST` | `/auth/reset-password` | Set a new password, mark the email verified, and sign out every existing session |

### Notes

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/notes/mode` | `"account"` or `"guest"` |
| `GET` | `/notes` | List notes |
| `POST` | `/notes` | Create a note |
| `PUT` | `/notes/:id` | Update a note |
| `DELETE` | `/notes/:id` | Delete a note |

Notes for signed-in users are stored in PostgreSQL. Guest notes are stored in the session row and use negative identifiers. Registration and login are limited to 20 requests per IP per 15 minutes. Password-reset requests are limited to 8 per IP per 15 minutes. Each address can be mailed at most 5 times per hour.

## Documents

The application publishes three legal pages, linked from the landing-page footer and from one another. The documents describe guest sessions stored in PostgreSQL, account storage, the Note and Markdown views, auto-save, export, Resend emails (including address confirmation and email-change notices), and links in notes. The English text applies if a translation differs. Last updated: 7 November 2026.

## Licence

Private university project.
