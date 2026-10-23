/**
 * Configuration, with the environment read off the key itself.
 *
 * Paystack encodes the mode in the secret key: sk_test_... or sk_live_...
 * That is strictly better than a separate setting, because there is no way to
 * believe you are in test mode while holding a live key. The key IS the mode.
 */

export const MODES = {
  test: { name: "test", real: false },
  live: { name: "live", real: true },
};

export const API_BASE = "https://api.paystack.co";

/** Exact string required to unlock live mode. Deliberately awkward to type. */
export const LIVE_ACK = "i-understand-this-moves-real-money";

/** Phrase required per call before a live transaction is initialised. */
export const CONFIRM_PHRASE = "CONFIRM LIVE PAYMENT";

/** Default ceiling on a single transaction, in MAJOR units (rands, naira). */
export const DEFAULT_MAX_AMOUNT = 1000;

/**
 * Currencies Paystack supports, with their subunit multiplier. Paystack takes
 * amounts in the subunit (kobo, cents, pesewas); this server takes major units
 * from callers and converts, because "500" meaning five rand is the kind of
 * ambiguity that empties accounts.
 */
export const CURRENCIES = {
  NGN: { subunit: 100, name: "Nigerian naira" },
  ZAR: { subunit: 100, name: "South African rand" },
  GHS: { subunit: 100, name: "Ghanaian cedi" },
  KES: { subunit: 100, name: "Kenyan shilling" },
  USD: { subunit: 100, name: "US dollar" },
  XOF: { subunit: 100, name: "West African CFA franc" },
};

export class ConfigError extends Error {}

/** Work out the mode from the key prefix. Anything unrecognised is refused. */
export function modeFromKey(secretKey) {
  if (typeof secretKey !== "string" || !secretKey.trim()) {
    throw new ConfigError("PAYSTACK_SECRET_KEY is not set.");
  }
  const key = secretKey.trim();
  if (key.startsWith("sk_test_")) return MODES.test;
  if (key.startsWith("sk_live_")) return MODES.live;
  if (key.startsWith("pk_")) {
    throw new ConfigError(
      "That is a PUBLIC key (pk_...). This server needs the SECRET key (sk_test_... " +
        "or sk_live_...) from Settings > API Keys & Webhooks.",
    );
  }
  throw new ConfigError(
    "PAYSTACK_SECRET_KEY must start with sk_test_ or sk_live_. " +
      "Refusing to run against a key whose mode cannot be determined.",
  );
}

export function loadConfig(env = process.env) {
  const secretKey = env.PAYSTACK_SECRET_KEY;
  const mode = modeFromKey(secretKey);

  // A live key alone is not enough. The operator must also say so out loud.
  if (mode.real && env.PAYSTACK_ALLOW_LIVE !== LIVE_ACK) {
    throw new ConfigError(
      `This is a LIVE key (sk_live_...). Running it also requires ` +
        `PAYSTACK_ALLOW_LIVE="${LIVE_ACK}". Refusing to start: a live key was ` +
        `supplied but live mode was not acknowledged.`,
    );
  }

  const currency = (env.PAYSTACK_CURRENCY ?? "ZAR").toUpperCase();
  if (!CURRENCIES[currency]) {
    throw new ConfigError(
      `PAYSTACK_CURRENCY must be one of ${Object.keys(CURRENCIES).join(", ")}.`,
    );
  }

  const maxAmount = Number(env.PAYSTACK_MAX_AMOUNT ?? DEFAULT_MAX_AMOUNT);
  if (!Number.isFinite(maxAmount) || maxAmount <= 0) {
    throw new ConfigError("PAYSTACK_MAX_AMOUNT must be a positive number.");
  }

  return { secretKey: secretKey.trim(), mode, currency, maxAmount };
}

/** Never print a secret. Show the prefix, which is the useful part anyway. */
export const mask = (s) => {
  if (!s) return "unset";
  const m = s.match(/^(sk_(?:test|live)_)(.*)$/);
  return m ? `${m[1]}...${m[2].slice(-4)}` : "*".repeat(Math.min(s.length, 12));
};
