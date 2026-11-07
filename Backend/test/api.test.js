/**
 * Registration, login, notes, and password reset.
 *
 * Each test names the HTTP input and the status and JSON body it expects.
 * The suite uses the same PostgreSQL database as the app (Backend/.env),
 * creates accounts at charcoal-test-*@example.com, and deletes them at the end.
 *
 * Email delivery is turned off before the server loads, so registration signs
 * in immediately. The reset test stores the token an email link would carry.
 *
 * Run from Backend/: npm test
 */

process.env.RESEND_API_KEY = "";
process.env.NODE_ENV = "test";

const http = require("node:http");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { describe, test, before, after } = require("node:test");
const { app, migrate, pool } = require("../server");

const account = {
  name: "Casey Quinn",
  email: "",
  password: "Notebook-9k",
  id: 0,
  cookie: "",
};

const createdEmails = [];

function testEmail() {
  const email = `charcoal-test-${crypto.randomBytes(4).toString("hex")}@example.com`;
  createdEmails.push(email);
  return email;
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

let server;
let baseUrl;

function sessionCookie(res, previous = "") {
  const parts = new Map();
  if (previous) {
    for (const pair of previous.split("; ")) {
      const separator = pair.indexOf("=");
      if (separator > 0) parts.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
  }
  for (const header of res.headers.getSetCookie()) {
    const pair = header.split(";")[0];
    const separator = pair.indexOf("=");
    parts.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
  return [...parts].map(([key, value]) => `${key}=${value}`).join("; ");
}

async function request(method, path, { body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  return {
    status: res.status,
    body: parsed,
    cookie: sessionCookie(res, cookie),
  };
}

function expectResult(actual, expected) {
  assert.deepEqual({ status: actual.status, body: actual.body }, expected);
}

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      email_verified BOOLEAN NOT NULL DEFAULT FALSE
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notes (
      id SERIAL PRIMARY KEY,
      title TEXT,
      content TEXT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await migrate();
}

describe("Charcoal accounts and notes", { concurrency: false }, () => {
  before(async () => {
    await ensureSchema();
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    try {
      if (createdEmails.length > 0) {
        await pool.query(
          `DELETE FROM "session"
           WHERE sess->>'userId' IN (
             SELECT id::text FROM users WHERE email = ANY($1::text[])
           )`,
          [createdEmails]
        );
        await pool.query("DELETE FROM users WHERE email = ANY($1::text[])", [createdEmails]);
      }
    } catch (err) {
      console.error("test cleanup failed:", err.message);
    }
    if (server) await new Promise((resolve) => server.close(resolve));
    await pool.end();
  });

  test("registration rejects missing, short, and common passwords", async () => {
    const cases = [
      {
        input: { name: "Casey Quinn", email: "casey@example.com" },
        expected: {
          status: 400,
          body: { error: "Name, email, and password are required" },
        },
      },
      {
        input: { name: "Casey Quinn", email: "casey@example.com", password: "short" },
        expected: {
          status: 400,
          body: { error: "Password must be at least 8 characters" },
        },
      },
      {
        input: { name: "Casey Quinn", email: "casey@example.com", password: "password123" },
        expected: {
          status: 400,
          body: { error: "This password is too common. Choose a stronger one" },
        },
      },
    ];

    for (const { input, expected } of cases) {
      const actual = await request("POST", "/auth/register", { body: input });
      expectResult(actual, expected);
    }
  });

  test("registration with a valid name, email, and password returns the account and signs in", async () => {
    account.email = testEmail();
    const input = {
      name: account.name,
      email: account.email,
      password: account.password,
    };
    const expected = {
      status: 200,
      name: account.name,
      email: account.email,
    };

    const actual = await request("POST", "/auth/register", { body: input });

    assert.equal(actual.status, expected.status);
    assert.equal(actual.body.name, expected.name);
    assert.equal(actual.body.email, expected.email);
    assert.equal(typeof actual.body.id, "number");
    account.id = actual.body.id;
    account.cookie = actual.cookie;

    const me = await request("GET", "/auth/me", { cookie: account.cookie });
    expectResult(me, {
      status: 200,
      body: { id: account.id, name: account.name, email: account.email },
    });
  });

  test("registration with an email that already exists returns 409", async () => {
    const input = {
      name: account.name,
      email: account.email,
      password: account.password,
    };
    const expected = {
      status: 409,
      body: { error: "Email already registered" },
    };

    const actual = await request("POST", "/auth/register", { body: input });
    expectResult(actual, expected);
  });

  test("GET /auth/me without a session returns 401", async () => {
    const expected = { status: 401, body: { error: "Not logged in" } };
    const actual = await request("GET", "/auth/me");
    expectResult(actual, expected);
  });

  test("login rejects missing credentials and a wrong password", async () => {
    const cases = [
      {
        input: {},
        expected: {
          status: 400,
          body: { error: "Email and password are required" },
        },
      },
      {
        input: { email: account.email, password: "wrong-password" },
        expected: {
          status: 401,
          body: { error: "Invalid email or password" },
        },
      },
    ];

    for (const { input, expected } of cases) {
      const actual = await request("POST", "/auth/login", { body: input });
      expectResult(actual, expected);
    }
  });

  test("login refuses an account whose email is not confirmed", async () => {
    const input = { email: account.email, password: account.password };
    const expected = {
      status: 403,
      body: {
        error: "Confirm your email before signing in. Check your inbox for the confirmation link.",
      },
    };

    await pool.query("UPDATE users SET email_verified = FALSE WHERE id = $1", [account.id]);
    try {
      const actual = await request("POST", "/auth/login", { body: input });
      expectResult(actual, expected);
    } finally {
      await pool.query("UPDATE users SET email_verified = TRUE WHERE id = $1", [account.id]);
    }
  });

  test("login with the registered email and password returns the account", async () => {
    const input = { email: account.email, password: account.password };
    const expected = {
      status: 200,
      body: { id: account.id, name: account.name, email: account.email },
    };

    const actual = await request("POST", "/auth/login", { body: input });
    expectResult(actual, expected);
    account.cookie = actual.cookie;
  });

  test("a signed-in user can create, update, and delete their own notes, and another account cannot", async () => {
    const mode = await request("GET", "/notes/mode", { cookie: account.cookie });
    expectResult(mode, { status: 200, body: { mode: "account" } });

    const input = { title: "Lab notes", content: "Heat the sample." };
    const created = await request("POST", "/notes", { cookie: account.cookie, body: input });
    assert.equal(created.status, 200);
    assert.equal(created.body.title, input.title);
    assert.equal(created.body.content, input.content);
    assert.equal(created.body.user_id, account.id);
    assert.equal(typeof created.body.id, "number");
    const noteId = created.body.id;

    const list = await request("GET", "/notes", { cookie: account.cookie });
    assert.equal(list.status, 200);
    assert.deepEqual(list.body, [
      { id: noteId, title: input.title, content: input.content, user_id: account.id },
    ]);

    const otherEmail = testEmail();
    const otherInput = { name: "Rae Kim", email: otherEmail, password: "Other-Note-8" };
    const other = await request("POST", "/auth/register", { body: otherInput });
    assert.equal(other.status, 200);

    const otherList = await request("GET", "/notes", { cookie: other.cookie });
    expectResult(otherList, { status: 200, body: [] });

    const otherUpdate = await request("PUT", `/notes/${noteId}`, {
      cookie: other.cookie,
      body: { title: "Stolen", content: "no" },
    });
    expectResult(otherUpdate, { status: 404, body: { error: "Note not found" } });

    const otherDelete = await request("DELETE", `/notes/${noteId}`, { cookie: other.cookie });
    expectResult(otherDelete, { status: 404, body: { error: "Note not found" } });

    const updateInput = { title: "Lab notes revised", content: "Cool the sample." };
    const updated = await request("PUT", `/notes/${noteId}`, {
      cookie: account.cookie,
      body: updateInput,
    });
    expectResult(updated, {
      status: 200,
      body: {
        id: noteId,
        title: updateInput.title,
        content: updateInput.content,
        user_id: account.id,
      },
    });

    const deleted = await request("DELETE", `/notes/${noteId}`, { cookie: account.cookie });
    assert.equal(deleted.status, 204);
    assert.equal(deleted.body, null);

    const afterDelete = await request("GET", "/notes", { cookie: account.cookie });
    expectResult(afterDelete, { status: 200, body: [] });

    const missing = await request("DELETE", `/notes/${noteId}`, { cookie: account.cookie });
    expectResult(missing, { status: 404, body: { error: "Note not found" } });
  });

  test("a guest can create and delete a note stored only in that session", async () => {
    const guestMode = await request("GET", "/notes/mode");
    expectResult(guestMode, { status: 200, body: { mode: "guest" } });

    const input = { title: "Scratch", content: "Temporary" };
    const created = await request("POST", "/notes", { body: input });
    assert.equal(created.status, 200);
    assert.equal(created.body.guest, true);
    assert.ok(created.body.id < 0);
    assert.equal(created.body.title, input.title);
    assert.equal(created.body.content, input.content);

    const list = await request("GET", "/notes", { cookie: created.cookie });
    expectResult(list, {
      status: 200,
      body: [
        {
          id: created.body.id,
          title: input.title,
          content: input.content,
          guest: true,
        },
      ],
    });

    const accountList = await request("GET", "/notes", { cookie: account.cookie });
    expectResult(accountList, { status: 200, body: [] });

    const deleted = await request("DELETE", `/notes/${created.body.id}`, {
      cookie: created.cookie,
    });
    assert.equal(deleted.status, 204);
    assert.equal(deleted.body, null);

    const afterDelete = await request("GET", "/notes", { cookie: created.cookie });
    expectResult(afterDelete, { status: 200, body: [] });
  });

  test("forgot-password returns one message whether or not the email exists", async () => {
    const generic = {
      status: 200,
      body: { message: "If an account exists, a password reset link has been sent." },
    };
    const cases = [
      {
        input: {},
        expected: { status: 400, body: { error: "Email is required" } },
      },
      {
        input: { email: "nobody@example.com" },
        expected: generic,
      },
      {
        input: { email: account.email },
        expected: generic,
      },
    ];

    for (const { input, expected } of cases) {
      const actual = await request("POST", "/auth/forgot-password", { body: input });
      expectResult(actual, expected);
    }

    const stored = await pool.query(
      "SELECT 1 FROM password_reset_tokens WHERE user_id = $1",
      [account.id]
    );
    assert.equal(stored.rows.length, 0);
  });

  test("reset-password accepts a valid token and a new password, then the old password and session stop working", async () => {
    const malformed = await request("GET", "/auth/verify-reset-token?token=nope");
    expectResult(malformed, { status: 200, body: { valid: false } });

    const missing = await request("POST", "/auth/reset-password", {
      body: { token: "not-a-token", password: "Fresh-Page-4" },
    });
    expectResult(missing, {
      status: 400,
      body: { error: "Token and password are required" },
    });

    const unknownToken = "ab".repeat(32);
    const unknown = await request("POST", "/auth/reset-password", {
      body: { token: unknownToken, password: "Fresh-Page-4" },
    });
    expectResult(unknown, {
      status: 400,
      body: { error: "Invalid or expired reset link" },
    });

    // Same shape as the link /auth/forgot-password would email: 32 random bytes,
    // stored as a SHA-256 hash that expires in 15 minutes.
    const token = crypto.randomBytes(32).toString("hex");
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + interval '15 minutes')`,
      [account.id, hashToken(token)]
    );

    const valid = await request("GET", `/auth/verify-reset-token?token=${token}`);
    expectResult(valid, { status: 200, body: { valid: true } });

    const reused = await request("POST", "/auth/reset-password", {
      body: { token, password: account.password },
    });
    expectResult(reused, {
      status: 400,
      body: { error: "New password must be different from your current password" },
    });

    const nextPassword = "Fresh-Page-4";
    const reset = await request("POST", "/auth/reset-password", {
      body: { token, password: nextPassword },
    });
    expectResult(reset, {
      status: 200,
      body: { message: "Password reset successfully" },
    });

    const used = await request("GET", `/auth/verify-reset-token?token=${token}`);
    expectResult(used, { status: 200, body: { valid: false } });

    const oldSession = await request("GET", "/auth/me", { cookie: account.cookie });
    expectResult(oldSession, { status: 401, body: { error: "Not logged in" } });

    const oldLogin = await request("POST", "/auth/login", {
      body: { email: account.email, password: account.password },
    });
    expectResult(oldLogin, {
      status: 401,
      body: { error: "Invalid email or password" },
    });

    const newLogin = await request("POST", "/auth/login", {
      body: { email: account.email, password: nextPassword },
    });
    expectResult(newLogin, {
      status: 200,
      body: { id: account.id, name: account.name, email: account.email },
    });
  });
});
