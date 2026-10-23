/**
 * End-to-end: spawn the real server over stdio and speak MCP to it.
 *
 * Most tests need no valid key, because the guards reject before any network
 * call. One test does reach Paystack: /bank is a public endpoint, so it proves
 * the whole path works against the live API with no credentials at risk.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { LIVE_ACK, CONFIRM_PHRASE } from "./config.mjs";

const ENTRY = join(dirname(fileURLToPath(import.meta.url)), "index.mjs");
const TEST_KEY = "sk_test_" + "a".repeat(32);
const LIVE_KEY = "sk_live_" + "b".repeat(32);

async function connect(env = {}) {
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [ENTRY],
      env: { PAYSTACK_SECRET_KEY: TEST_KEY, ...env, PATH: process.env.PATH ?? "" },
      stderr: "ignore",
    }),
  );
  return client;
}

const textOf = (r) => r.content.map((c) => c.text).join("\n");

test("server starts and advertises its tools", async () => {
  const client = await connect();
  const names = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    "paystack_environment",
    "paystack_initialize_transaction",
    "paystack_list_banks",
    "paystack_list_transactions",
    "paystack_verify_credentials",
    "paystack_verify_transaction",
  ]);
  await client.close();
});

test("only the payment tool is marked destructive", async () => {
  const client = await connect();
  const byName = Object.fromEntries((await client.listTools()).tools.map((t) => [t.name, t]));

  for (const n of ["paystack_environment", "paystack_list_banks",
                   "paystack_verify_transaction", "paystack_list_transactions"]) {
    assert.equal(byName[n].annotations.readOnlyHint, true, `${n} should be read-only`);
  }
  assert.equal(byName.paystack_initialize_transaction.annotations.readOnlyHint, false);
  assert.equal(byName.paystack_initialize_transaction.annotations.destructiveHint, true);
  await client.close();
});

test("a test key puts the server in test mode", async () => {
  const client = await connect();
  const env = JSON.parse(textOf(await client.callTool({ name: "paystack_environment", arguments: {} })));
  assert.equal(env.mode, "test");
  assert.equal(env.movesRealMoney, false);
  assert.equal(env.confirmationRequired, false);
  assert.match(env.amountUnits, /major units/);
  await client.close();
});

test("the secret key never appears in output", async () => {
  const client = await connect();
  const body = textOf(await client.callTool({ name: "paystack_environment", arguments: {} }));
  assert.ok(!body.includes("a".repeat(16)), "key body must not be echoed");
  assert.ok(body.includes("sk_test_..."), "prefix should still be shown");
  await client.close();
});

test("a live key without acknowledgement kills the server", async () => {
  await assert.rejects(
    () => connect({ PAYSTACK_SECRET_KEY: LIVE_KEY }),
    "a live key must not start unacknowledged",
  );
});

test("a live key with acknowledgement requires per-payment confirmation", async () => {
  const client = await connect({ PAYSTACK_SECRET_KEY: LIVE_KEY, PAYSTACK_ALLOW_LIVE: LIVE_ACK });

  const env = JSON.parse(textOf(await client.callTool({ name: "paystack_environment", arguments: {} })));
  assert.equal(env.mode, "live");
  assert.equal(env.confirmationRequired, true);

  const res = await client.callTool({
    name: "paystack_initialize_transaction",
    arguments: { amount: 10, email: "a@b.co" },
  });
  assert.equal(res.isError, true);
  assert.match(textOf(res), /LIVE key/);
  assert.match(textOf(res), /ask the human first/);
  await client.close();
});

test("an over-ceiling amount is refused before any network call", async () => {
  const client = await connect({ PAYSTACK_MAX_AMOUNT: "100" });
  const res = await client.callTool({
    name: "paystack_initialize_transaction",
    arguments: { amount: 5000, email: "a@b.co" },
  });
  assert.equal(res.isError, true);
  assert.match(textOf(res), /exceeds the ceiling of 100/);
  await client.close();
});

test("a bad email and a non-https callback are refused", async () => {
  const client = await connect();

  const bad = await client.callTool({
    name: "paystack_initialize_transaction",
    arguments: { amount: 10, email: "nope" },
  });
  assert.equal(bad.isError, true);
  assert.match(textOf(bad), /email/);

  const http = await client.callTool({
    name: "paystack_initialize_transaction",
    arguments: { amount: 10, email: "a@b.co", callbackUrl: "http://x.co" },
  });
  assert.equal(http.isError, true);
  assert.match(textOf(http), /https/);
  await client.close();
});

test("an invalid key produces a readable Paystack error, not a crash", async () => {
  const client = await connect();
  const res = await client.callTool({ name: "paystack_verify_credentials", arguments: {} });
  assert.equal(res.isError, true);
  assert.match(textOf(res), /Paystack error/);
  await client.close();
});

test("live: list_banks reaches the real API and returns South African banks", async () => {
  const client = await connect();
  const res = await client.callTool({
    name: "paystack_list_banks",
    arguments: { country: "south africa" },
  });

  assert.notEqual(res.isError, true, textOf(res));
  const banks = JSON.parse(textOf(res));
  assert.ok(Array.isArray(banks) && banks.length > 0, "expected banks");
  assert.ok(banks.every((b) => b.currency === "ZAR"), "all should be ZAR");
  assert.ok(
    banks.some((b) => /absa|standard bank|capitec|nedbank|first national/i.test(b.name)),
    "expected a recognisable South African bank",
  );
  await client.close();
});
