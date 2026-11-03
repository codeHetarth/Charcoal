# Charcoal

Charcoal is a browser-based markdown note application developed as part of a university web development project. Users can write notes in the editor, organise them from a sidebar, and export a note as a `.md` file.

## Functionality

Charcoal provides a guest mode to store notes temporarily. The browser drops them when it closes, and the server deletes its copy within 24 hours. To store notes permanently, users can register with an account (email and password) and keep their notes in the database, attached to their account.

The navbar on the home page provides direction to the About section of the web application and Account section to show and change user details. In addition, the footer provides contact details and documents, namely- Privacy policy, Terms of service, and Legal notice for Charcoal related information.

The notes editor is built with [Milkdown](https://milkdown.dev/) editor and supports GitHub Flavored Markdown plugins. The plugins includes headings, lists, tables, task lists, strikethrough, url links, and fenced code blocks, with syntax highlighting inside code blocks. Moreover, changes to the title and the note body are saved automatically.

The notes sidebar is used to create and select note. Whereas, on narrow viewports a drawer is provided to perform the operations. The navbar on the notepage enables user to delete and export notes, with redirection button to user Accounts page. On exporting notes the browser generates markdown file and downloads it locally. Thus, the file is not uploaded to the server.

Account features include registration, login, profile updates (name and email), logout and account deletion operations. An account deletion also removes the associated notes. 

If a [Resend](https://resend.com/) API key is configured, the application can send emails for event such as welcome, password reset, and deletion confirmation. Further, Password reset is followed by a link via an email; the link expires after 15 minutes. 

## Implementation

The frontend is written in HTML, CSS and JavaScript.
The server is Node.js with Express. 
PostgreSQL database stores users and notes. 
Sessions are handled with express-session. 
Passwords are stored as bcrypt hashes.
Milkdown 7 is loaded from [esm.sh](https://esm.sh/) when the notes page is opened.

## Project structure

```
Charcoal/
├── Backend/
│   ├── server.js          # HTTP API and static file server
│   ├── package.json
│   └── .env.example       # copy to .env
├── public/                # pages, styles, scripts, images
└── README.md
```

Routes:

- `/` -> `landingpage.html` — landing page
- `/notespage.html` — notes editor
- `/auth.html` — login / registration
- `/forgotpassword.html`, `/resetpassword.html` — password reset
- `/privacy.html`, `/terms.html`, `/legal.html` — legal documents

## Requirements

- Node.js 18 or later
- PostgreSQL running locally

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

`RESEND_API_KEY` is required for confirmation, welcome, password-reset, and account-deletion emails. When it is set, a new account cannot sign in until the address is confirmed from the email. If the key is omitted, accounts are created and signed in immediately, and email features are skipped.

`SESSION_SECRET` must be set when `NODE_ENV=production`. Optional `APP_BASE_URL` (for example `https://notes.example.com`) is used in email links. When it is omitted, links use `http://localhost:<PORT>`.

Guest notes are browser-session cookies. The server deletes them within 24 hours, and each guest session is limited to 50 notes and 256 KB. Signed-in notes are limited to 500 per account.

In PostgreSQL:

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
  email_verified BOOLEAN NOT NULL DEFAULT FALSE
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

CREATE TABLE email_verification_tokens (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  pending_email TEXT,
  expires_at TIMESTAMPTZ NOT NULL
);
```

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

## Editor behaviour

GitHub Flavored Markdown is enabled, this includes tables, task lists, strikethrough, and code blocks.

The users can use Markdown related syntax to write their notes in the web application.

In the notes, the Title area is used for presenting Title on the sidebar and the same Title will be used to name the notes when exported. Therefore, a user can write Heading(#) seperately in the notes editor.  

Note:- Currently, the development supports essential plugins to create, write, and manage notes. However, more plugins will be installed later upon further testing and feedbacks.

## API

Authenticated requests send the session cookie (`credentials: include`).

### Authentication

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/auth/register` | Create an account. Signs in immediately when email delivery is off; otherwise sends a confirmation link |
| `GET` | `/verify-email` | Confirm an address from the emailed link |
| `POST` | `/auth/login` | Sign in. Issues a new session id |
| `POST` | `/auth/logout` | Sign out |
| `GET` | `/auth/me` | Current user |
| `PUT` | `/auth/me` | Update name and email. Changing email requires the current password |
| `DELETE` | `/auth/me` | Delete the account and its notes. Requires the current password |
| `POST` | `/auth/forgot-password` | Request a reset email |
| `GET` | `/auth/verify-reset-token` | Validate a reset token |
| `POST` | `/auth/reset-password` | Set a new password and sign out every existing session |

### Notes

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/notes/mode` | `"account"` or `"guest"` |
| `GET` | `/notes` | List notes |
| `POST` | `/notes` | Create a note |
| `PUT` | `/notes/:id` | Update a note |
| `DELETE` | `/notes/:id` | Delete a note |

Notes for signed-in users are stored in PostgreSQL, whereas guest notes are stored on the session and use negative identifiers. A password reset ends every existing session for that account. An existing database picks up `email_verified` and `email_verification_tokens` the next time the server starts; accounts already in the database are treated as verified.

## Documents

The application publishes three legal pages, linked from the landing-page footer and from one another. The documents describe how Charcoal actually operates through guest sessions, account storage, auto-save, export, Resend emails, and links in notes. The English text applies if a translation differs. Last updated: 29 August 2026.

## Licence

Private university project.
