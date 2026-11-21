import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { sendAccountEmail } from "@/lib/auth-email";
import { authDbPool } from "@/lib/auth-db";

const buildOnlySecret = "build-only-secret-not-valid-at-runtime";
const secret = process.env.BETTER_AUTH_SECRET
  ?? (process.env.NODE_ENV === "production" ? buildOnlySecret : "local-development-secret-change-before-deploy");
const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const baseURL = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

export const auth = betterAuth({
  appName: "Traders Adda",
  baseURL,
  secret,
  database: authDbPool,
  trustedOrigins: [baseURL],
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      await sendAccountEmail(user.email, "Reset your Traders Adda password", "Use this link to reset your password.", url);
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendAccountEmail(user.email, "Verify your Traders Adda account", "Verify your email address to activate your account.", url);
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => ({
          data: {
            ...user,
            role: adminEmail && user.email.trim().toLowerCase() === adminEmail ? "admin" : "user",
          },
        }),
      },
    },
  },
  plugins: [
    admin({ defaultRole: "user", adminRoles: ["admin"] }),
    nextCookies(),
  ],
});

export function assertAuthEnvironment(): void {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for account login.");
  if (!process.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET.length < 32) {
    throw new Error("Set BETTER_AUTH_SECRET to a random value of at least 32 characters.");
  }
  if (!process.env.BETTER_AUTH_URL) throw new Error("Set BETTER_AUTH_URL to the public website URL.");
  if (!adminEmail) throw new Error("Set ADMIN_EMAIL before enabling account registration.");
}
