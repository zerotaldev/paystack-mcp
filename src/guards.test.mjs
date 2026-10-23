import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toSubunit, checkLiveConfirmation, checkReference, checkEmail, checkUrl,
  crossCheckDomain, GuardError,
} from "./guards.mjs";
import {
  loadConfig, modeFromKey, ConfigError, MODES, LIVE_ACK, CONFIRM_PHRASE, mask,
} from "./config.mjs";

const TEST_KEY = "sk_test_" + "a".repeat(32);
const LIVE_KEY = "sk_live_" + "b".repeat(32);

test("the mode comes from the key prefix", () => {
  assert.equal(modeFromKey(TEST_KEY).name, "test");
  assert.equal(modeFromKey(TEST_KEY).real, false);
  assert.equal(modeFromKey(LIVE_KEY).name, "live");
  assert.equal(modeFromKey(LIVE_KEY).real, true);
});

test("a public key is rejected with a useful message", () => {
  assert.throws(() => modeFromKey("pk_test_abc"), (e) =>
    e instanceof ConfigError && /PUBLIC key/.test(e.message));
});

test("a key of unknown shape is refused, never assumed to be test", () => {
  for (const bad of ["", "   ", "abc123", "token_test_x", undefined]) {
    assert.throws(() => modeFromKey(bad), ConfigError);
  }
});

test("a live key without the acknowledgement refuses to start", () => {
  assert.throws(
    () => loadConfig({ PAYSTACK_SECRET_KEY: LIVE_KEY }),
    (e) => e instanceof ConfigError && /PAYSTACK_ALLOW_LIVE/.test(e.message),
  );
  assert.throws(
    () => loadConfig({ PAYSTACK_SECRET_KEY: LIVE_KEY, PAYSTACK_ALLOW_LIVE: "yes" }),
    ConfigError,
  );
  const c = loadConfig({ PAYSTACK_SECRET_KEY: LIVE_KEY, PAYSTACK_ALLOW_LIVE: LIVE_ACK });
  assert.equal(c.mode.real, true);
});

test("a test key needs no acknowledgement", () => {
  const c = loadConfig({ PAYSTACK_SECRET_KEY: TEST_KEY });
  assert.equal(c.mode.name, "test");
  assert.equal(c.currency, "ZAR");
  assert.equal(c.maxAmount, 1000);
});

test("amounts are major units and convert to subunits", () => {
  assert.equal(toSubunit(149.99, "ZAR", 1000), 14999);
  assert.equal(toSubunit(1, "NGN", 1000), 100);
  assert.equal(toSubunit(0.01, "ZAR", 1000), 1);
});

test("the ceiling is expressed in the same units the caller passes", () => {
  // 1500 rand must be refused against a 1000 rand ceiling, even though the
  // subunit value (150000) is a much larger number.
  assert.throws(() => toSubunit(1500, "ZAR", 1000), /exceeds the ceiling of 1000/);
  assert.doesNotThrow(() => toSubunit(999.99, "ZAR", 1000));
});

test("a caller who wrongly passes subunits is caught by the ceiling", () => {
  // Someone means R149.99 and passes 14999. That is a 100x error; the ceiling
  // is the backstop that turns it into a refusal rather than a charge.
  assert.throws(() => toSubunit(14999, "ZAR", 1000), GuardError);
});

test("malformed amounts are rejected", () => {
  for (const bad of [0, -5, "100", NaN, Infinity, null]) {
    assert.throws(() => toSubunit(bad, "ZAR", 1000), GuardError);
  }
  assert.throws(() => toSubunit(1.005, "ZAR", 1000), /finer than/);
  assert.throws(() => toSubunit(10, "GBP", 1000), /Unsupported currency/);
});

test("test mode needs no confirmation, live mode needs the exact phrase", () => {
  assert.doesNotThrow(() => checkLiveConfirmation(MODES.test, undefined));
  assert.throws(() => checkLiveConfirmation(MODES.live, undefined), GuardError);
  assert.throws(() => checkLiveConfirmation(MODES.live, "yes"), GuardError);
  assert.throws(() => checkLiveConfirmation(MODES.live, CONFIRM_PHRASE.toLowerCase()), GuardError);
  assert.doesNotThrow(() => checkLiveConfirmation(MODES.live, CONFIRM_PHRASE));
});

test("references allow only Paystack's character set", () => {
  assert.equal(checkReference("order-123.a=b"), "order-123.a=b");
  assert.equal(checkReference(undefined), undefined);
  assert.throws(() => checkReference("order 123"), GuardError);
  assert.throws(() => checkReference("order/123"), GuardError);
});

test("emails and https URLs are validated", () => {
  assert.equal(checkEmail("a@b.co"), "a@b.co");
  assert.throws(() => checkEmail("not-an-email"), GuardError);
  assert.equal(checkUrl("https://x.co/done", "callbackUrl"), "https://x.co/done");
  assert.equal(checkUrl(undefined, "callbackUrl"), undefined);
  assert.throws(() => checkUrl("http://x.co", "callbackUrl"), /https/);
});

test("a domain mismatch between key and API is surfaced, not swallowed", () => {
  assert.equal(crossCheckDomain(MODES.test, "test"), null);
  assert.equal(crossCheckDomain(MODES.live, "live"), null);
  assert.match(crossCheckDomain(MODES.test, "live"), /WARNING/);
  assert.match(crossCheckDomain(MODES.live, "test"), /WARNING/);
  assert.equal(crossCheckDomain(MODES.test, undefined), null);
});

test("mask shows the mode prefix but not the secret", () => {
  const m = mask(TEST_KEY);
  assert.match(m, /^sk_test_\.\.\./);
  assert.ok(!m.includes("a".repeat(10)));
  assert.equal(mask(""), "unset");
});
