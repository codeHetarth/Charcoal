const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const express = require("express");
const cors = require("cors");
const session = require("express-session");
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const { Pool } = require("pg");
const { Resend } = require("resend");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const BCRYPT_ROUNDS = 12;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;
const NAME_MAX_LENGTH = 100;
const NOTE_TITLE_MAX = 200;
const NOTE_CONTENT_MAX = 100000;
const ACCOUNT_NOTES_MAX = 500;
const GUEST_MAX_NOTES = 50;
const GUEST_MAX_BYTES = 256 * 1024;
const GUEST_SESSION_MS = 24 * 60 * 60 * 1000;
const ACCOUNT_SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const isProduction = process.env.NODE_ENV === "production";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const COMMON_PASSWORDS = new Set([
  "password",
  "password1",
  "password12",
  "password123",
  "password1234",
  "123456789012",
  "1234567890123",
  "qwertyuiop",
  "qwertyuiopas",
  "letmein1234",
  "welcome1234",
  "iloveyou123",
  "admin123456",
  "charcoal1234",
]);

function passwordPolicyError(password, { email = "", name = "" } = {}) {
  if (typeof password !== "string" || password.length === 0) {
    return "Password is required";
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return "Password must be at least 8 characters";
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return "Password is too long";
  }

  const lower = password.toLowerCase();
  const emailLocal = email.trim().toLowerCase().split("@")[0];
  if (emailLocal && emailLocal.length >= 3 && lower.includes(emailLocal)) {
    return "Password must not contain your email";
  }

  const nameParts = name
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((part) => part.length >= 3);
  if (nameParts.some((part) => lower.includes(part))) {
    return "Password must not contain your name";
  }

  if (COMMON_PASSWORDS.has(lower)) {
    return "This password is too common. Choose a stronger one";
  }

  return null;
}

const resend = new Resend(process.env.RESEND_API_KEY);

function emailDeliveryEnabled() {
  return Boolean(process.env.RESEND_API_KEY);
}

function appBaseUrl() {
  const configured = (process.env.APP_BASE_URL || "").trim().replace(/\/$/, "");
  return configured || `http://localhost:${PORT}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isValidEmail(email) {
  return typeof email === "string" && email.length <= 254 && EMAIL_PATTERN.test(email);
}

function isHexToken(token) {
  return typeof token === "string" && /^[a-f0-9]{64}$/.test(token);
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

let dummyHashPromise;
function dummyPasswordHash() {
  if (!dummyHashPromise) {
    dummyHashPromise = bcrypt.hash(crypto.randomBytes(16).toString("hex"), BCRYPT_ROUNDS);
  }
  return dummyHashPromise;
}

// Per-address send cap so one inbox cannot be mailed in a loop.
const emailSends = new Map();
function claimEmailSend(address) {
  const key = String(address).toLowerCase();
  const now = Date.now();
  const recent = (emailSends.get(key) || []).filter((t) => now - t < 60 * 60 * 1000);
  if (recent.length >= 5) return false;
  recent.push(now);
  emailSends.set(key, recent);
  return true;
}

async function sendHtmlEmail({ to, subject, html }) {
  if (!claimEmailSend(to)) {
    const err = new Error("Too many emails to this address");
    err.code = "EMAIL_RATE_LIMIT";
    throw err;
  }
  return resend.emails.send({
    from: "onboarding@resend.dev",
    to,
    subject,
    html,
  });
}

function rateLimit(max, windowMs) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || "unknown";
    const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      return res.status(429).json({ error: "Too many requests. Please try again later." });
    }
    recent.push(now);
    hits.set(key, recent);
    next();
  };
}

const authWriteLimit = rateLimit(20, 15 * 60 * 1000);
const authResetLimit = rateLimit(8, 15 * 60 * 1000);

// -------------------- MIDDLEWARE --------------------

app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

app.use(
  cors({
    origin: [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`],
    credentials: true,
  })
);
app.use(express.json());
app.use((req, res, next) => {
  if (req.body == null || typeof req.body !== "object" || Array.isArray(req.body)) {
    req.body = {};
  }
  next();
});

if (isProduction && !process.env.SESSION_SECRET) {
  console.error("SESSION_SECRET must be set when NODE_ENV=production.");
  process.exit(1);
}
if (!process.env.SESSION_SECRET) {
  console.warn("SESSION_SECRET is not set. Using a development-only default. Set SESSION_SECRET before deploying.");
}

const sessionStore = new session.MemoryStore();
const cookieBase = {
  httpOnly: true,
  sameSite: "lax",
  secure: isProduction,
  path: "/",
};

app.use(
  session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || "charcoal-dev-secret-change-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: {
      ...cookieBase,
      maxAge: ACCOUNT_SESSION_MS,
    },
  })
);

// MemoryStore only drops a session when its cookie expiry has passed. Guest
// cookies stay browser-session cookies, so sweep them on our own deadline.
setInterval(() => {
  sessionStore.all((err, sessions) => {
    if (err || !sessions) return;
    const now = Date.now();
    for (const [sid, data] of Object.entries(sessions)) {
      if (data && data.guestExpiresAt && data.guestExpiresAt <= now) {
        sessionStore.destroy(sid, () => {});
      }
    }
  });
}, 15 * 60 * 1000).unref();

function destroySessionsForUser(userId, exceptSid) {
  return new Promise((resolve) => {
    sessionStore.all((err, sessions) => {
      if (err || !sessions) return resolve();
      const ids = Object.entries(sessions)
        .filter(([sid, data]) => data && data.userId === userId && sid !== exceptSid)
        .map(([sid]) => sid);
      if (ids.length === 0) return resolve();
      let left = ids.length;
      ids.forEach((sid) => {
        sessionStore.destroy(sid, () => {
          left -= 1;
          if (left === 0) resolve();
        });
      });
    });
  });
}

function isLoggedIn(req) {
  return !!req.session.userId;
}

function ensureGuestSession(req) {
  if (!req.session.guestNotes) {
    req.session.guestNotes = [];
  }
  if (req.session.guestNextId === undefined) {
    req.session.guestNextId = -1;
  }
  // The browser drops this cookie when it closes. guestExpiresAt lets the server
  // delete the copy even if the browser never comes back.
  req.session.cookie.maxAge = null;
  req.session.guestExpiresAt = Date.now() + GUEST_SESSION_MS;
}

function guestLimitError(notes) {
  if (notes.length > GUEST_MAX_NOTES) {
    return "Guest note limit reached. Create an account to save more notes.";
  }
  if (Buffer.byteLength(JSON.stringify(notes)) > GUEST_MAX_BYTES) {
    return "Guest note storage limit reached. Create an account to save more notes.";
  }
  return null;
}

function readNoteFields(body) {
  const title = body.title ?? "";
  const content = body.content ?? "";
  if (typeof title !== "string" || typeof content !== "string") {
    return { error: "Title and content must be text" };
  }
  if (title.length > NOTE_TITLE_MAX) return { error: "Title is too long" };
  if (content.length > NOTE_CONTENT_MAX) return { error: "Note is too long" };
  return { title, content };
}

function nextGuestId(req) {
  const id = req.session.guestNextId;
  req.session.guestNextId -= 1;
  return id;
}

function sortGuestNotesNewestFirst(notes) {
  return [...notes].sort((a, b) => a.id - b.id);
}

// -------------------- DATABASE --------------------
const pool = new Pool({
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD,
  port: Number(process.env.PGPORT) || 5432,
});

pool
  .query("SELECT 1")
  .then(() => console.log("✅ PostgreSQL connected"))
  .catch((err) => console.error("❌ PostgreSQL connection error:", err.message));

async function migrate() {
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN");
  await pool.query("UPDATE users SET email_verified = TRUE WHERE email_verified IS NULL");
  await pool.query("ALTER TABLE users ALTER COLUMN email_verified SET DEFAULT FALSE");
  await pool.query("ALTER TABLE users ALTER COLUMN email_verified SET NOT NULL");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_verification_tokens (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      pending_email TEXT,
      expires_at TIMESTAMPTZ NOT NULL
    )
  `);
}

async function issueEmailToken(userId, pendingEmail) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await pool.query("DELETE FROM email_verification_tokens WHERE user_id = $1", [userId]);
  await pool.query(
    `INSERT INTO email_verification_tokens (user_id, token_hash, pending_email, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [userId, hashToken(token), pendingEmail, expiresAt]
  );
  return token;
}

function verificationEmailHtml(name, link, intro) {
  return `
    <h2>${escapeHtml(intro)}</h2>
    <p>Hello ${escapeHtml(name)},</p>
    <p><a href="${link}">${escapeHtml(intro)}</a></p>
    <p>This link expires in 24 hours. If you did not ask for this, you can ignore this email.</p>
  `;
}

async function establishLogin(req, user) {
  await regenerateSession(req);
  req.session.userId = user.id;
  req.session.cookie.maxAge = ACCOUNT_SESSION_MS;
  await saveSession(req);
}

// -------------------- AUTH ROUTES --------------------

app.post("/auth/register", authWriteLimit, async (req, res) => {
  try {
    const name = String(req.body.name ?? "").trim();
    const email = String(req.body.email ?? "").trim().toLowerCase();
    const password = req.body.password ?? "";

    if (!name || !email || typeof password !== "string" || !password) {
      return res.status(400).json({ error: "Name, email, and password are required" });
    }
    if (name.length > NAME_MAX_LENGTH) {
      return res.status(400).json({ error: "Name is too long" });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "Please enter a valid email address" });
    }

    const policyError = passwordPolicyError(password, { email, name });
    if (policyError) {
      return res.status(400).json({ error: policyError });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const verify = emailDeliveryEnabled();
    const existing = await pool.query(
      "SELECT id, email_verified FROM users WHERE email = $1",
      [email]
    );

    // An unverified address can be claimed by whoever can read the confirmation mail.
    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      if (row.email_verified) {
        return res.status(409).json({ error: "Email already registered" });
      }
      await pool.query(
        "UPDATE users SET name = $1, password_hash = $2, email_verified = $3 WHERE id = $4",
        [name, passwordHash, !verify, row.id]
      );
      if (!verify) {
        await establishLogin(req, { id: row.id });
        return res.json({ id: row.id, name, email });
      }
      const token = await issueEmailToken(row.id, null);
      const link = `${appBaseUrl()}/verify-email?token=${token}`;
      await sendHtmlEmail({
        to: email,
        subject: "Confirm your Charcoal email",
        html: verificationEmailHtml(name, link, "Confirm your email"),
      });
      return res.json({ needsVerification: true });
    }

    const result = await pool.query(
      "INSERT INTO users (name, email, password_hash, email_verified) VALUES ($1, $2, $3, $4) RETURNING id, name, email",
      [name, email, passwordHash, !verify]
    );
    const user = result.rows[0];

    if (verify) {
      const token = await issueEmailToken(user.id, null);
      const link = `${appBaseUrl()}/verify-email?token=${token}`;
      await sendHtmlEmail({
        to: user.email,
        subject: "Confirm your Charcoal email",
        html: verificationEmailHtml(name, link, "Confirm your email"),
      });
      return res.json({ needsVerification: true });
    }

    await establishLogin(req, user);
    res.json(user);

    try {
      const emailResult = await sendHtmlEmail({
        to: user.email,
        subject: "Welcome to Charcoal — your account is ready",
        html: `
          <h2>Welcome, ${escapeHtml(user.name)}!</h2>
          <p>Your Charcoal account (<strong>${escapeHtml(user.email)}</strong>) has been created successfully.</p>
        `,
      });
      console.log("Registration email sent:", emailResult);
    } catch (err) {
      console.error("Registration email failed:", err.message);
    }
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Email already registered" });
    }
    if (err.code === "EMAIL_RATE_LIMIT") {
      return res.status(429).json({ error: "Too many emails to this address. Try again later." });
    }
    console.error("POST /auth/register error:", err.message);
    res.status(500).json({ error: "Failed to register" });
  }
});

app.post("/auth/login", authWriteLimit, async (req, res) => {
  try {
    const email = String(req.body.email ?? "").trim().toLowerCase();
    const password = typeof req.body.password === "string" ? req.body.password : "";

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const result = await pool.query(
      "SELECT id, name, email, password_hash, email_verified FROM users WHERE email = $1",
      [email]
    );
    const user = result.rows[0];
    const passwordOk = await bcrypt.compare(password, user ? user.password_hash : await dummyPasswordHash());
    if (!user || !passwordOk) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    if (!user.email_verified) {
      return res.status(403).json({
        error: "Confirm your email before signing in. Check your inbox for the confirmation link.",
      });
    }

    await establishLogin(req, user);
    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
    });
  } catch (err) {
    console.error("POST /auth/login error:", err.message);
    res.status(500).json({ error: "Failed to login" });
  }
});

app.post("/auth/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("POST /auth/logout error:", err.message);
      return res.status(500).json({ error: "Failed to logout" });
    }
    res.clearCookie("connect.sid", cookieBase);
    res.status(204).send();
  });
});

app.get("/auth/me", async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not logged in" });
  }

  try {
    const result = await pool.query(
      "SELECT id, name, email FROM users WHERE id = $1",
      [req.session.userId]
    );

    if (result.rows.length === 0) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: "Not logged in" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("GET /auth/me error:", err.message);
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

// -------------------- NOTES ROUTES --------------------

app.get("/", (req, res) => {
  res.redirect("/landingpage/home");
});

app.get(["/landingpage", "/landingpage.html"], (req, res) => {
  res.redirect("/landingpage/home");
});

app.get("/landingpage/:section", (req, res, next) => {
  const allowed = new Set(["home", "about", "account"]);
  if (!allowed.has(req.params.section)) return next();
  res.sendFile(path.resolve(__dirname, "..", "public", "landingpage.html"));
});

function sendPublicPage(res, filename) {
  res.sendFile(path.resolve(__dirname, "..", "public", filename));
}

app.get("/notespage.html", (req, res) => res.redirect("/notespage"));
app.get("/notespage", (req, res) => sendPublicPage(res, "notespage.html"));

app.get(["/auth", "/auth.html"], (req, res) => res.redirect("/auth/login"));
app.get(["/auth/login", "/auth/register"], (req, res) => sendPublicPage(res, "auth.html"));

app.get("/forgotpassword.html", (req, res) => res.redirect("/forgotpassword"));
app.get("/forgotpassword", (req, res) => sendPublicPage(res, "forgotpassword.html"));

app.get("/resetpassword.html", (req, res) => {
  const query = req.originalUrl.includes("?")
    ? req.originalUrl.slice(req.originalUrl.indexOf("?"))
    : "";
  res.redirect("/resetpassword" + query);
});
app.get("/resetpassword", (req, res) => sendPublicPage(res, "resetpassword.html"));

app.get("/privacy.html", (req, res) => res.redirect("/privacy"));
app.get("/privacy", (req, res) => sendPublicPage(res, "privacy.html"));

app.get("/terms.html", (req, res) => res.redirect("/terms"));
app.get("/terms", (req, res) => sendPublicPage(res, "terms.html"));

app.get("/legal.html", (req, res) => res.redirect("/legal"));
app.get("/legal", (req, res) => sendPublicPage(res, "legal.html"));

app.get("/notes/mode", (req, res) => {
  res.json({ mode: isLoggedIn(req) ? "account" : "guest" });
});

app.get("/notes", async (req, res) => {
  try {
    if (isLoggedIn(req)) {
      const result = await pool.query(
        "SELECT id, title, content, user_id FROM notes WHERE user_id = $1 ORDER BY id ASC",
        [req.session.userId]
      );
      return res.json(result.rows);
    }

    ensureGuestSession(req);
    res.json(sortGuestNotesNewestFirst(req.session.guestNotes));
  } catch (err) {
    console.error("GET /notes error:", err.message);
    res.status(500).json({ error: "Failed to fetch notes" });
  }
});

app.post("/notes", async (req, res) => {
  try {
    const fields = readNoteFields(req.body);
    if (fields.error) return res.status(400).json({ error: fields.error });
    const { title, content } = fields;

    if (isLoggedIn(req)) {
      const count = await pool.query(
        "SELECT COUNT(*)::int AS n FROM notes WHERE user_id = $1",
        [req.session.userId]
      );
      if (count.rows[0].n >= ACCOUNT_NOTES_MAX) {
        return res.status(413).json({ error: "Note limit reached" });
      }
      const result = await pool.query(
        "INSERT INTO notes (title, content, user_id) VALUES ($1, $2, $3) RETURNING *",
        [title, content, req.session.userId]
      );
      return res.json(result.rows[0]);
    }

    ensureGuestSession(req);
    const note = {
      id: nextGuestId(req),
      title,
      content,
      guest: true,
    };
    const limitError = guestLimitError([...req.session.guestNotes, note]);
    if (limitError) return res.status(413).json({ error: limitError });
    req.session.guestNotes.push(note);
    res.json(note);
  } catch (err) {
    console.error("POST /notes error:", err.message);
    res.status(500).json({ error: "Failed to create note" });
  }
});

app.put("/notes/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const fields = readNoteFields(req.body);
    if (fields.error) return res.status(400).json({ error: fields.error });
    const { title, content } = fields;

    if (isLoggedIn(req)) {
      if (!/^\d+$/.test(id)) return res.status(404).json({ error: "Note not found" });
      const result = await pool.query(
        "UPDATE notes SET title = $1, content = $2 WHERE id = $3 AND user_id = $4 RETURNING *",
        [title, content, Number(id), req.session.userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Note not found" });
      }

      return res.json(result.rows[0]);
    }

    ensureGuestSession(req);
    const noteId = Number(id);
    const note = req.session.guestNotes.find((n) => n.id === noteId);
    if (!note) {
      return res.status(404).json({ error: "Note not found" });
    }

    const updated = req.session.guestNotes.map((n) =>
      n.id === noteId ? { ...n, title, content } : n
    );
    const limitError = guestLimitError(updated);
    if (limitError) return res.status(413).json({ error: limitError });
    note.title = title;
    note.content = content;
    res.json(note);
  } catch (err) {
    console.error("PUT /notes error:", err.message);
    res.status(500).json({ error: "Failed to update note" });
  }
});

app.delete("/notes/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (isLoggedIn(req)) {
      if (!/^\d+$/.test(id)) return res.status(404).json({ error: "Note not found" });
      const result = await pool.query(
        "DELETE FROM notes WHERE id = $1 AND user_id = $2 RETURNING id",
        [Number(id), req.session.userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Note not found" });
      }

      return res.status(204).send();
    }

    ensureGuestSession(req);
    const noteId = Number(id);
    const before = req.session.guestNotes.length;
    req.session.guestNotes = req.session.guestNotes.filter((n) => n.id !== noteId);

    if (req.session.guestNotes.length === before) {
      return res.status(404).json({ error: "Note not found" });
    }

    res.status(204).send();
  } catch (err) {
    console.error("DELETE /notes error:", err.message);
    res.status(500).json({ error: "Failed to delete note" });
  }
});

// Serve frontend files from public/ only (never Backend/, .env, or node_modules)
const publicRoot = path.resolve(__dirname, "..", "public");
app.use(express.static(publicRoot));

// -------------------- Account Routes --------------------

app.put("/auth/me", async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not logged in" });
  }

  try {
    const name = String(req.body.name ?? "").trim();
    const email = String(req.body.email ?? "").trim().toLowerCase();

    if (!name || !email) {
      return res.status(400).json({ error: "Name and email are required" });
    }
    if (name.length > NAME_MAX_LENGTH) {
      return res.status(400).json({ error: "Name is too long" });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "Please enter a valid email address" });
    }

    const current = await pool.query(
      "SELECT id, name, email, password_hash FROM users WHERE id = $1",
      [req.session.userId]
    );
    if (current.rows.length === 0) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: "Not logged in" });
    }
    const user = current.rows[0];

    if (email === user.email) {
      const result = await pool.query(
        "UPDATE users SET name = $1 WHERE id = $2 RETURNING id, name, email",
        [name, user.id]
      );
      return res.json(result.rows[0]);
    }

    const currentPassword = req.body.currentPassword;
    if (typeof currentPassword !== "string" || !currentPassword) {
      return res.status(400).json({ error: "Current password is required to change your email" });
    }
    const passwordOk = await bcrypt.compare(currentPassword, user.password_hash);
    if (!passwordOk) {
      return res.status(403).json({ error: "Current password is incorrect" });
    }

    const taken = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (taken.rows.length > 0) {
      return res.status(409).json({ error: "Email already in use" });
    }

    await pool.query("UPDATE users SET name = $1 WHERE id = $2", [name, user.id]);

    if (emailDeliveryEnabled()) {
      const token = await issueEmailToken(user.id, email);
      const link = `${appBaseUrl()}/verify-email?token=${token}`;
      await sendHtmlEmail({
        to: email,
        subject: "Confirm your new Charcoal email",
        html: verificationEmailHtml(name, link, "Confirm your new email"),
      });
      try {
        await sendHtmlEmail({
          to: user.email,
          subject: "Your Charcoal email is changing",
          html: `<p>Hello ${escapeHtml(user.name)},</p><p>A request was made to change the email on your Charcoal account to <strong>${escapeHtml(email)}</strong>. If this was not you, reset your password.</p>`,
        });
      } catch (err) {
        console.error("Email-change notice failed:", err.message);
      }
      return res.json({ id: user.id, name, email: user.email, pendingEmail: email });
    }

    await pool.query("UPDATE users SET email = $1 WHERE id = $2", [email, user.id]);
    await pool.query("DELETE FROM password_reset_tokens WHERE user_id = $1", [user.id]);
    await destroySessionsForUser(user.id, req.sessionID);
    res.json({ id: user.id, name, email });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Email already in use" });
    }
    if (err.code === "EMAIL_RATE_LIMIT") {
      return res.status(429).json({ error: "Too many emails to this address. Try again later." });
    }
    console.error("PUT /auth/me error:", err.message);
    res.status(500).json({ error: "Failed to update account" });
  }
});

app.delete("/auth/me", async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not logged in" });
  }

  try {
    // Get the user's details before deleting the account
    const userResult = await pool.query(
      "SELECT id, name, email, password_hash, email_verified FROM users WHERE id = $1",
      [req.session.userId]
    );

    if (userResult.rows.length === 0) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: "Not logged in" });
    }

    const user = userResult.rows[0];
    const currentPassword = req.body.currentPassword;
    if (typeof currentPassword !== "string" || !currentPassword) {
      return res.status(400).json({ error: "Current password is required to delete your account" });
    }
    const passwordOk = await bcrypt.compare(currentPassword, user.password_hash);
    if (!passwordOk) {
      return res.status(403).json({ error: "Current password is incorrect" });
    }

    if (user.email_verified && emailDeliveryEnabled()) {
      try {
        await sendHtmlEmail({
          to: user.email,
          subject: "Your Charcoal account has been deleted",
          html: `
            <h2>Goodbye, ${escapeHtml(user.name)}!</h2>
            <p>Your Charcoal account (<strong>${escapeHtml(user.email)}</strong>) has been deleted successfully.</p>
            <p>We're sorry to see you go.</p>
          `,
        });
      } catch (err) {
        console.error("Failed to send confirmation email:", err.message);
      }
    }

    const userId = req.session.userId;
    await pool.query("DELETE FROM notes WHERE user_id = $1", [userId]);
    await pool.query("DELETE FROM users WHERE id = $1", [userId]);
    await destroySessionsForUser(userId);

    req.session.destroy((err) => {
      if (err) {
        console.error("Session destroy error:", err.message);
        return res.status(500).json({ error: "Failed to clear session" });
      }

      res.clearCookie("connect.sid", cookieBase);
      res.status(204).send();
    });

  } catch (err) {
    console.error("DELETE /auth/me error:", err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to delete account" });
    }
  }
});

app.post("/auth/forgot-password", authResetLimit, async (req, res) => {
  const generic = {
    message: "If an account exists, a password reset link has been sent.",
  };
  try {
    const email = String(req.body.email ?? "").trim().toLowerCase();

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }
    if (!isValidEmail(email) || !emailDeliveryEnabled()) {
      return res.json(generic);
    }

    const userResult = await pool.query(
      "SELECT id, name, email FROM users WHERE email = $1",
      [email]
    );

    if (userResult.rows.length === 0) {
      return res.json(generic);
    }

    const user = userResult.rows[0];
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await pool.query("DELETE FROM password_reset_tokens WHERE user_id = $1", [user.id]);
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, hashToken(token), expiresAt]
    );

    const resetLink = `${appBaseUrl()}/resetpassword?token=${token}`;
    try {
      await sendHtmlEmail({
        to: user.email,
        subject: "Reset your Charcoal password",
        html: `
          <h2>Password Reset</h2>
          <p>Hello ${escapeHtml(user.name)},</p>
          <p>We received a request to reset your password.</p>
          <p><a href="${resetLink}">Reset Password</a></p>
          <p>This link expires in 15 minutes.</p>
          <p>If you didn't request this, simply ignore this email.</p>
        `,
      });
    } catch (err) {
      if (err.code !== "EMAIL_RATE_LIMIT") throw err;
    }

    res.json(generic);
  } catch (err) {
    console.error("POST /auth/forgot-password error:", err.message);
    res.status(500).json({
      error: "Failed to process password reset request",
    });
  }
});

app.post("/auth/reset-password", async (req, res) => {
  try {
    const token = req.body.token ?? "";
    const password = req.body.password ?? "";

    if (!isHexToken(token) || typeof password !== "string" || !password) {
      return res.status(400).json({
        error: "Token and password are required"
      });
    }

    const tokenHash = hashToken(token);

    // Find matching token that hasn't expired
    const result = await pool.query(
      `SELECT user_id
       FROM password_reset_tokens
       WHERE token_hash = $1
       AND expires_at > NOW()`,
      [tokenHash]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({
        error: "Invalid or expired reset link"
      });
    }

    const userId = result.rows[0].user_id;

    const userResult = await pool.query(
      "SELECT name, email, password_hash FROM users WHERE id = $1",
      [userId]
    );
    if (userResult.rows.length === 0) {
      return res.status(400).json({ error: "Invalid or expired reset link" });
    }

    const user = userResult.rows[0];
    const policyError = passwordPolicyError(password, {
      email: user.email,
      name: user.name,
    });
    if (policyError) {
      return res.status(400).json({ error: policyError });
    }

    const reused = await bcrypt.compare(password, user.password_hash);
    if (reused) {
      return res.status(400).json({
        error: "New password must be different from your current password",
      });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    await pool.query(
      "UPDATE users SET password_hash = $1, email_verified = TRUE WHERE id = $2",
      [passwordHash, userId]
    );
    await pool.query("DELETE FROM password_reset_tokens WHERE user_id = $1", [userId]);
    await pool.query("DELETE FROM email_verification_tokens WHERE user_id = $1", [userId]);
    await destroySessionsForUser(userId);

    res.json({
      message: "Password reset successfully"
    });

  } catch (err) {
    console.error("POST /auth/reset-password error:", err.message);
    res.status(500).json({
      error: "Failed to reset password"
    });
  }
});

app.get("/auth/verify-reset-token", async (req, res) => {
  try {
    const token = req.query.token ?? "";
    if (!isHexToken(token)) return res.json({ valid: false });

    const tokenHash = hashToken(token);

    const result = await pool.query(
      "SELECT 1 FROM password_reset_tokens WHERE token_hash = $1 AND expires_at > NOW()",
      [tokenHash]
    );

    res.json({ valid: result.rows.length > 0 });
  } catch (err) {
    console.error("GET /auth/verify-reset-token error:", err.message);
    res.status(500).json({ valid: false });
  }
});

app.get("/verify-email", async (req, res) => {
  try {
    const token = req.query.token;
    if (!isHexToken(token)) return res.redirect("/auth/login?verified=invalid");

    const result = await pool.query(
      `SELECT user_id, pending_email
       FROM email_verification_tokens
       WHERE token_hash = $1 AND expires_at > NOW()`,
      [hashToken(token)]
    );
    if (result.rows.length === 0) return res.redirect("/auth/login?verified=invalid");

    const row = result.rows[0];
    if (row.pending_email) {
      await pool.query(
        "UPDATE users SET email = $1, email_verified = TRUE WHERE id = $2",
        [row.pending_email, row.user_id]
      );
      await destroySessionsForUser(row.user_id);
    } else {
      await pool.query("UPDATE users SET email_verified = TRUE WHERE id = $1", [row.user_id]);
    }
    await pool.query("DELETE FROM email_verification_tokens WHERE user_id = $1", [row.user_id]);
    await pool.query("DELETE FROM password_reset_tokens WHERE user_id = $1", [row.user_id]);
    res.redirect(row.pending_email ? "/auth/login?verified=email" : "/auth/login?verified=1");
  } catch (err) {
    if (err.code === "23505") return res.redirect("/auth/login?verified=taken");
    console.error("GET /verify-email error:", err.message);
    res.redirect("/auth/login?verified=invalid");
  }
});

// -------------------- START SERVER --------------------

migrate()
  .catch((err) => console.error("Database migration failed:", err.message))
  .finally(() => {
const server = app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`   Open http://localhost:${PORT}/ (serves pages from ${publicRoot})`);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `Port ${PORT} is already in use. Another app (or an old node process) is using it.\n` +
        `  Fix: quit that process, or start this server on another port:\n` +
        `  PORT=3010 node server.js`
    );
  } else {
    console.error("Server error:", err);
  }
  process.exit(1);
});
});