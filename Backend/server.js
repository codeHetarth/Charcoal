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
const BCRYPT_ROUNDS = 10;
const resend = new Resend(process.env.RESEND_API_KEY);

// -------------------- MIDDLEWARE --------------------

app.use(
  cors({
    origin: [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`],
    credentials: true,
  })
);
app.use(express.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET || "charcoal-dev-secret-change-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: "lax",
    },
  })
);

function isLoggedIn(req) {
  return !!req.session.userId;
}

function clearGuestNotes(req) {
  delete req.session.guestNotes;
  delete req.session.guestNextId;
}

function ensureGuestSession(req) {
  if (!req.session.guestNotes) {
    req.session.guestNotes = [];
  }
  if (req.session.guestNextId === undefined) {
    req.session.guestNextId = -1;
  }
  // Guest notes live only for this browser session (cookie expires when browser closes).
  req.session.cookie.maxAge = null;
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

// -------------------- AUTH ROUTES --------------------

app.post("/auth/register", async (req, res) => {
  try {
    const name = (req.body.name ?? "").trim();
    const email = (req.body.email ?? "").trim().toLowerCase();
    const password = req.body.password ?? "";

    if (!name || !email || !password) {
      return res.status(400).json({ error: "Name, email, and password are required" });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const result = await pool.query(
      "INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email",
      [name, email, passwordHash]
    );

    const user = result.rows[0];
    clearGuestNotes(req);
    req.session.userId = user.id;
    req.session.cookie.maxAge = 7 * 24 * 60 * 60 * 1000;
    res.json(user);

    try {
      const emailResult = await resend.emails.send({
        from: "onboarding@resend.dev",
        to: user.email,
        subject: "Welcome to Charcoal — your account is ready",
        html: `
          <h2>Welcome, ${user.name}!</h2>
          <p>Your Charcoal account (<strong>${user.email}</strong>) has been created successfully.</p>
        `,
      });
    
      console.log("Registration email sent:", emailResult);
      } catch (err) {
        console.error("Registration email failed:");
        console.error(err);
      }

    } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Email already registered" });
    }
    console.error("POST /auth/register error:", err.message);
    res.status(500).json({ error: "Failed to register" });
  }
});

app.post("/auth/login", async (req, res) => {
  try {
    const email = (req.body.email ?? "").trim().toLowerCase();
    const password = req.body.password ?? "";

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const result = await pool.query(
      "SELECT id, name, email, password_hash FROM users WHERE email = $1",
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const user = result.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    clearGuestNotes(req);
    req.session.userId = user.id;
    req.session.cookie.maxAge = 7 * 24 * 60 * 60 * 1000;
    // Save the session before responding
    req.session.save((err) => {
      if (err) {
        console.error("Session save error:", err);

        return res.status(500).json({
          error: "Failed to save login session"
        });
      }

      res.json({
        id: user.id,
        name: user.name,
        email: user.email
      });
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
    res.clearCookie("connect.sid");
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
  res.redirect("/landingpage.html");
});

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
    const title = req.body.title ?? "";
    const content = req.body.content ?? "";

    if (isLoggedIn(req)) {
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
    const title = req.body.title ?? "";
    const content = req.body.content ?? "";

    if (isLoggedIn(req)) {
      const result = await pool.query(
        "UPDATE notes SET title = $1, content = $2 WHERE id = $3 AND user_id = $4 RETURNING *",
        [title, content, id, req.session.userId]
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
      const result = await pool.query(
        "DELETE FROM notes WHERE id = $1 AND user_id = $2 RETURNING id",
        [id, req.session.userId]
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
    const name = (req.body.name ?? "").trim();
    const email = (req.body.email ?? "").trim().toLowerCase();
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

    if (!name || !email) {
      return res.status(400).json({ error: "Name and email are required" });
    }

    if (!emailPattern.test(email)) {
      return res.status(400).json({ error: "Please enter a valid email address" });
    }

    const result = await pool.query(
      "UPDATE users SET name = $1, email = $2 WHERE id = $3 RETURNING id, name, email",
      [name, email, req.session.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Email already in use" });
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
      "SELECT id, name, email FROM users WHERE id = $1",
      [req.session.userId]
    );

    if (userResult.rows.length === 0) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: "Not logged in" });
    }

    const user = userResult.rows[0];

    // Send deletion confirmation email
    void resend.emails
      .send({
        from: "onboarding@resend.dev",
        to: user.email,
        subject: "Your Charcoal account has been deleted",
        html: `
          <h2>Goodbye, ${user.name}!</h2>
          <p>Your Charcoal account (<strong>${user.email}</strong>) has been deleted successfully.</p>
          <p>We're sorry to see you go.</p>
        `,
      })
      .catch((err) =>
        console.error("Failed to send confirmation email:", err.message)
      );

    // Delete notes first
    await pool.query("DELETE FROM notes WHERE user_id = $1", [req.session.userId]);

    // Delete account
    await pool.query("DELETE FROM users WHERE id = $1", [req.session.userId]);

    // Destroy session
    req.session.destroy((err) => {
      if (err) {
        console.error("Session destroy error:", err.message);
        return res.status(500).json({ error: "Failed to clear session" });
      }

      res.clearCookie("connect.sid");
      res.status(204).send();
    });

  } catch (err) {
    console.error("DELETE /auth/me error:", err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to delete account" });
    }
  }
});

app.post("/auth/forgot-password", async (req, res) => {
  try {
    const email = (req.body.email ?? "").trim().toLowerCase();

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    // Find user
    const userResult = await pool.query(
      "SELECT id, name, email FROM users WHERE email = $1",
      [email]
    );

    // Always return the same message
    if (userResult.rows.length === 0) {
      return res.json({
        message:
          "If an account exists, a password reset link has been sent."
      });
    }

    const user = userResult.rows[0];

    // Generate token
    const token = crypto.randomBytes(32).toString("hex");

    // Hash token before storing
    const tokenHash = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    // Expiry (15 minutes)
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    // Remove previous reset tokens
    await pool.query(
      "DELETE FROM password_reset_tokens WHERE user_id = $1",
      [user.id]
    );

    // Save new token
    await pool.query(
      `INSERT INTO password_reset_tokens
      (user_id, token_hash, expires_at)
      VALUES ($1, $2, $3)`,
      [user.id, tokenHash, expiresAt]
    );

    // Reset link
    const resetLink =
      `http://localhost:${PORT}/resetpassword.html?token=${token}`;

    // Send email
    await resend.emails.send({
      from: "onboarding@resend.dev",
      to: user.email,
      subject: "Reset your Charcoal password",
      html: `
        <h2>Password Reset</h2>

        <p>Hello ${user.name},</p>

        <p>We received a request to reset your password.</p>

        <p>
          <a href="${resetLink}">
            Reset Password
          </a>
        </p>

        <p>This link expires in 15 minutes.</p>

        <p>If you didn't request this, simply ignore this email.</p>
      `
    });

    res.json({
      message:
        "If an account exists, a password reset link has been sent."
    });

  } catch (err) {
    console.error("POST /auth/forgot-password error:", err.message);
    res.status(500).json({
      error: "Failed to process password reset request"
    });
  }
});

app.post("/auth/reset-password", async (req, res) => {
  try {
    const token = req.body.token ?? "";
    const password = req.body.password ?? "";

    if (!token || !password) {
      return res.status(400).json({
        error: "Token and password are required"
      });
    }

    // Hash the received token
    const tokenHash = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

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

    // Hash the new password
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // Update user's password
    await pool.query(
      "UPDATE users SET password_hash = $1 WHERE id = $2",
      [passwordHash, userId]
    );

    // Delete all reset tokens for this user
    await pool.query(
      "DELETE FROM password_reset_tokens WHERE user_id = $1",
      [userId]
    );

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
    if (!token) return res.json({ valid: false });

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

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

// -------------------- START SERVER --------------------

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