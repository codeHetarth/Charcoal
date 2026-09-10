const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;
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
