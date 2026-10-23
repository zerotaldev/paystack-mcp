/**
 * Policy guards. Pure functions, no network, so they can be tested without
 * credentials. Every path that creates a charge goes through these.
 */
import { CONFIRM_PHRASE, CURRENCIES } from "./config.mjs";

export class GuardError extends Error {}

/**
 * Validate a MAJOR-unit amount and convert it to the subunit Paystack wants.
 *
 * Callers pass rands or naira, never cents or kobo. Taking subunits from a
 * language model invites a hundredfold error in whichever direction is worse,
 * and the ceiling below is expressed in major units so the two agree.
 */
export function toSubunit(amount, currency, maxAmount) {
  const meta = CURRENCIES[currency];
  if (!meta) throw new GuardError(`Unsupported currency "${currency}".`);

  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    throw new GuardError(
      `Amount must be a number in ${currency} major units, for example 149.99 ` +
        `for one hundred and forty-nine ${meta.name}. Do not pass subunits.`,
    );
  }
  if (amount <= 0) throw new GuardError("Amount must be greater than zero.");

  const sub = Math.round(amount * meta.subunit);
  if (Math.abs(sub - amount * meta.subunit) > 1e-9) {
    throw new GuardError(`Amount cannot be finer than 1/${meta.subunit} of a ${currency}.`);
  }
  if (amount > maxAmount) {
    throw new GuardError(
      `Amount ${amount} ${currency} exceeds the ceiling of ${maxAmount}. ` +
        `Raise PAYSTACK_MAX_AMOUNT deliberately if this is intended.`,
    );
  }
  return sub;
}

/**
 * Test mode spends nothing, so confirmation there is theatre that teaches
 * people to click through. Live mode requires the exact phrase.
 */
export function checkLiveConfirmation(mode, confirm) {
  if (!mode.real) return;
  if (confirm !== CONFIRM_PHRASE) {
    throw new GuardError(
      `This server is running on a LIVE key and this call charges real money. ` +
        `Pass confirm="${CONFIRM_PHRASE}" to proceed. Do not supply it on your ` +
        `own initiative - ask the human first.`,
    );
  }
}

/** Paystack references allow alphanumerics plus - . = only. */
export function checkReference(ref) {
  if (ref == null) return undefined;
  if (!/^[A-Za-z0-9\-.=]{1,100}$/.test(ref)) {
    throw new GuardError(
      "reference may contain only letters, numbers, and the characters - . =",
    );
  }
  return ref;
}

export function checkEmail(email) {
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new GuardError("A valid customer email address is required.");
  }
  return email;
}

/** Callback URLs must be absolute https. */
export function checkUrl(url, field) {
  if (url == null) return undefined;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new GuardError(`${field} must be a valid absolute URL.`);
  }
  if (parsed.protocol !== "https:") {
    throw new GuardError(`${field} must use https, got "${parsed.protocol}".`);
  }
  return parsed.toString();
}

/**
 * Paystack echoes the environment back on a verified transaction as
 * domain: "test" | "live". If that ever disagrees with the key prefix,
 * something is badly wrong and we say so rather than papering over it.
 */
export function crossCheckDomain(mode, domain) {
  if (!domain) return null;
  const expected = mode.real ? "live" : "test";
  if (domain !== expected) {
    return `WARNING: key prefix says ${expected} mode but Paystack reported domain "${domain}".`;
  }
  return null;
}
