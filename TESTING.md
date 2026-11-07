# Testing

The automated tests cover registration, login, notes, and password reset. They live in `Backend/test/api.test.js`. Each case below is the request the test sends and the status and JSON body it expects.

PostgreSQL must be running, and `Backend/.env` must be set up the same way as for `npm start`. From `Backend/`:

```bash
npm test
```

That runs `node --test --test-concurrency=1 test/api.test.js`. The tests call the Express app on a local port. They do not start the server you use in the browser.

The run sets `RESEND_API_KEY` to empty before the server loads, so email delivery is off. A new account is signed in immediately, and no message is sent. Accounts are created at `charcoal-test-<random>@example.com` and deleted at the end, including their notes, reset tokens, and sessions.

Later cases use the account created by the successful registration:

| Field | Value |
| --- | --- |
| Name | Casey Quinn |
| Email | `charcoal-test-<random>@example.com` |
| Password | `Notebook-9k` |

## Registration

| Input | Expected result |
| --- | --- |
| `POST /auth/register` with `{ "name": "Casey Quinn", "email": "casey@example.com" }` | **400** `{ "error": "Name, email, and password are required" }` |
| `POST /auth/register` with `{ "name": "Casey Quinn", "email": "casey@example.com", "password": "short" }` | **400** `{ "error": "Password must be at least 8 characters" }` |
| `POST /auth/register` with `{ "name": "Casey Quinn", "email": "casey@example.com", "password": "password123" }` | **400** `{ "error": "This password is too common. Choose a stronger one" }` |
| `POST /auth/register` with `{ "name": "Casey Quinn", "email": "<new test email>", "password": "Notebook-9k" }` | **200** `{ "id": <number>, "name": "Casey Quinn", "email": "<that email>" }`. `GET /auth/me` with the session cookie returns **200** and the same account. |
| `POST /auth/register` again with that same name, email, and password | **409** `{ "error": "Email already registered" }` |

## Login

| Input | Expected result |
| --- | --- |
| `GET /auth/me` with no session cookie | **401** `{ "error": "Not logged in" }` |
| `POST /auth/login` with `{}` | **400** `{ "error": "Email and password are required" }` |
| `POST /auth/login` with `{ "email": "<registered email>", "password": "wrong-password" }` | **401** `{ "error": "Invalid email or password" }` |
| The registered account has `email_verified` set to false. `POST /auth/login` with `{ "email": "<registered email>", "password": "Notebook-9k" }` | **403** `{ "error": "Confirm your email before signing in. Check your inbox for the confirmation link." }`. The test then sets `email_verified` back to true. |
| `POST /auth/login` with `{ "email": "<registered email>", "password": "Notebook-9k" }` | **200** `{ "id": <account id>, "name": "Casey Quinn", "email": "<registered email>" }` |

## Notes

The signed-in requests use the session from the successful login.

| Input | Expected result |
| --- | --- |
| `GET /notes/mode` with the account session | **200** `{ "mode": "account" }` |
| `POST /notes` with `{ "title": "Lab notes", "content": "Heat the sample." }` | **200** with that title and content, `user_id` equal to the account id, and a numeric `id` |
| `GET /notes` with the account session | **200** and a list of that one note |
| `POST /auth/register` with `{ "name": "Rae Kim", "email": "<second test email>", "password": "Other-Note-8" }` | **200** and a new account |
| `GET /notes` with Rae Kim's session | **200** `[]` |
| `PUT /notes/<Casey Quinn's note id>` with Rae Kim's session and `{ "title": "Stolen", "content": "no" }` | **404** `{ "error": "Note not found" }` |
| `DELETE /notes/<Casey Quinn's note id>` with Rae Kim's session | **404** `{ "error": "Note not found" }` |
| `PUT /notes/<note id>` with Casey Quinn's session and `{ "title": "Lab notes revised", "content": "Cool the sample." }` | **200** with that title, content, the same id, and the account's `user_id` |
| `DELETE /notes/<note id>` with Casey Quinn's session | **204** and an empty body |
| `GET /notes` with Casey Quinn's session | **200** `[]` |
| `DELETE /notes/<note id>` again with Casey Quinn's session | **404** `{ "error": "Note not found" }` |

Guest notes use no account. The first guest request has no cookie. Later guest requests send the cookie from the create response.

| Input | Expected result |
| --- | --- |
| `GET /notes/mode` with no cookie | **200** `{ "mode": "guest" }` |
| `POST /notes` with `{ "title": "Scratch", "content": "Temporary" }` | **200** with that title and content, `guest: true`, and an `id` less than 0 |
| `GET /notes` with the guest cookie | **200** and a list of that one note |
| `GET /notes` with Casey Quinn's session | **200** `[]` |
| `DELETE /notes/<guest note id>` with the guest cookie | **204** and an empty body |
| `GET /notes` with the guest cookie | **200** `[]` |

## Password reset

Email delivery is off, so `POST /auth/forgot-password` does not store a token. The reset case inserts one in the same form the email link would carry: 32 random bytes as hex, saved as a SHA-256 hash, expiring in 15 minutes.

| Input | Expected result |
| --- | --- |
| `POST /auth/forgot-password` with `{}` | **400** `{ "error": "Email is required" }` |
| `POST /auth/forgot-password` with `{ "email": "nobody@example.com" }` | **200** `{ "message": "If an account exists, a password reset link has been sent." }` |
| `POST /auth/forgot-password` with `{ "email": "<registered email>" }` | **200** and the same message. `password_reset_tokens` has no row for that account. |
| `GET /auth/verify-reset-token?token=nope` | **200** `{ "valid": false }` |
| `POST /auth/reset-password` with `{ "token": "not-a-token", "password": "Fresh-Page-4" }` | **400** `{ "error": "Token and password are required" }` |
| `POST /auth/reset-password` with a 64-character hex token that was never stored, and password `"Fresh-Page-4"` | **400** `{ "error": "Invalid or expired reset link" }` |
| `GET /auth/verify-reset-token?token=<stored token>` | **200** `{ "valid": true }` |
| `POST /auth/reset-password` with that token and password `"Notebook-9k"` | **400** `{ "error": "New password must be different from your current password" }` |
| `POST /auth/reset-password` with that token and password `"Fresh-Page-4"` | **200** `{ "message": "Password reset successfully" }` |
| `GET /auth/verify-reset-token?token=<that token>` after the reset | **200** `{ "valid": false }` |
| `GET /auth/me` with the session from before the reset | **401** `{ "error": "Not logged in" }` |
| `POST /auth/login` with `{ "email": "<registered email>", "password": "Notebook-9k" }` | **401** `{ "error": "Invalid email or password" }` |
| `POST /auth/login` with `{ "email": "<registered email>", "password": "Fresh-Page-4" }` | **200** `{ "id": <account id>, "name": "Casey Quinn", "email": "<registered email>" }` |
