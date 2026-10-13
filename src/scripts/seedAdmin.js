require("dotenv").config();

const { connectDatabase } = require("../db/connect");
const { User } = require("../modules/auth/auth.models");
const { ROLES, ACCOUNT_STATUS } = require("../modules/auth/auth.constants");
const { hashPassword, normalizeEmail } = require("../modules/auth/auth.crypto");

async function seedAdmin() {
  const { ADMIN_NAME, ADMIN_EMAIL, ADMIN_INITIAL_PASSWORD } = process.env;
  if (!ADMIN_NAME || !ADMIN_EMAIL || !ADMIN_INITIAL_PASSWORD) {
    throw new Error("ADMIN_NAME, ADMIN_EMAIL and ADMIN_INITIAL_PASSWORD are required");
  }
  await connectDatabase();
  const email = normalizeEmail(ADMIN_EMAIL);
  const existing = await User.findOne({ email });
  if (existing) {
    console.log("Admin seed skipped: user already exists for ADMIN_EMAIL");
    return;
  }
  await User.create({
    name: ADMIN_NAME,
    email,
    passwordHash: await hashPassword(ADMIN_INITIAL_PASSWORD),
    role: ROLES.ADMIN,
    accountStatus: ACCOUNT_STATUS.ACTIVE,
    emailVerified: true,
    emailVerifiedAt: new Date(),
    forcePasswordChange: true,
  });
  console.log("Admin created. Remove ADMIN_INITIAL_PASSWORD from backend/.env after first login.");
}

seedAdmin()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
