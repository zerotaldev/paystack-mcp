#!/usr/bin/env node
/** `npm run check` - validate the key and confirm it works. Charges nothing. */
import { loadConfig, ConfigError, mask } from "./config.mjs";
import { PaystackClient } from "./paystack.mjs";

let config;
try {
  config = loadConfig();
} catch (e) {
  if (e instanceof ConfigError) {
    console.error(`\n  FAIL  ${e.message}\n`);
    process.exitCode = 1;
  } else {
    throw e;
  }
}

if (config) {
  const line = (l, v) => console.log(`  ${l.padEnd(14)} ${v}`);
  console.log("\nPaystack MCP preflight\n");
  line("mode", config.mode.name + (config.mode.real ? "   *** LIVE - REAL MONEY ***" : ""));
  line("secret key", mask(config.secretKey));
  line("currency", config.currency);
  line("max amount", `${config.maxAmount} ${config.currency} (major units)`);
  line("confirmation", config.mode.real ? "required per payment" : "not required in test mode");

  // Resolve fully before printing, and never process.exit() after a fetch:
  // tearing the process down mid-flight trips a libuv assertion on Windows.
  let failure = null;
  let balances = null;
  try {
    balances = (await new PaystackClient(config).balance())?.data;
  } catch (e) {
    failure = e.message;
  }

  if (failure) {
    line("credentials", "FAILED");
    console.log(`\n  ${failure}\n`);
    process.exitCode = 1;
  } else {
    line("credentials", "ok");
    for (const b of balances ?? []) {
      line("balance", `${(b.balance ?? 0) / 100} ${b.currency}`);
    }
    console.log();
  }
}
