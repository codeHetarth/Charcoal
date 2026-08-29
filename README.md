# Charcoal

Charcoal is a browser-based markdown note application developed as part of a university web development project. Users can write notes in the editor, organise them from a sidebar, and export a note as a `.md` file.

## Functionality

Charcoal provides a guest mode to store notes temporarily, only for the current browser session; they are discarded when the browser is closed. Instead, to store notes permanently, users can register with an account(email and password) and keep their notes in the database, attached to their account.

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

`RESEND_API_KEY` is required for the welcome, password-reset and account-deletion emails. If the KEY configuration is omitted, the email service will fail; but the rest of the application will run as programmed.

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
| `POST` | `/auth/register` | Create an account and sign in |
| `POST` | `/auth/login` | Sign in |
| `POST` | `/auth/logout` | Sign out |
| `GET` | `/auth/me` | Current user |
| `PUT` | `/auth/me` | Update name and email |
| `DELETE` | `/auth/me` | Delete the account and its notes |
| `POST` | `/auth/forgot-password` | Request a reset email |
| `GET` | `/auth/verify-reset-token` | Validate a reset token |
| `POST` | `/auth/reset-password` | Set a new password |

### Notes

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/notes/mode` | `"account"` or `"guest"` |
| `GET` | `/notes` | List notes |
| `POST` | `/notes` | Create a note |
| `PUT` | `/notes/:id` | Update a note |
| `DELETE` | `/notes/:id` | Delete a note |

Notes for signed-in users are stored in PostgreSQL, whereas, the guest notes are stored on the session and use negative identifiers.

## Documents

The application publishes three legal pages, linked from the landing-page footer and from one another. The documents describe how Charcoal actually operates through guest sessions, account storage, auto-save, export, Resend emails, and links in notes. The English text applies if a translation differs. Last updated: 29 August 2026.

## Licence

Private university project.
