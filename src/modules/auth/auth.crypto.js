const crypto = require("crypto");
const { hash, verify, Algorithm } = require("@node-rs/argon2");

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

async function hashPassword(password) {
  return hash(password, {
    algorithm: Algorithm.Argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
}

async function verifyPassword(passwordHash, password) {
  return verify(passwordHash, password);
}

function generateOpaqueToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function addMinutes(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000);
}

function addDays(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

module.exports = { normalizeEmail, hashPassword, verifyPassword, generateOpaqueToken, hashToken, addMinutes, addDays };
