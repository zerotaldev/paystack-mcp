#!/usr/bin/env node
/**
 * Paystack MCP server.
 *
 * Exposes the Paystack payments API (Nigeria, Ghana, South Africa, Kenya,
 * Cote d'Ivoire) as MCP tools. The mode is read from the secret key prefix,
 * so the server cannot be in live mode without holding a live key.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { loadConfig, ConfigError, mask, CONFIRM_PHRASE, CURRENCIES } from "./config.mjs";
import { PaystackClient, PaystackError } from "./paystack.mjs";
import {
  GuardError, toSubunit, checkLiveConfirmation, checkReference,
  checkEmail, checkUrl, crossCheckDomain,
} from "./guards.mjs";

// stdout carries the MCP protocol. Diagnostics go to stderr only.
const log = (...a) => console.error("[paystack-mcp]", ...a);

let config;
try {
  config = loadConfig();
} catch (e) {
  if (e instanceof ConfigError) {
    log(`Configuration error: ${e.message}`);
    process.exit(1);
  }
  throw e;
}

const client = new PaystackClient(config);
log(`starting in ${config.mode.name} mode` + (config.mode.real ? "  *** LIVE - REAL MONEY ***" : ""));

const server = new McpServer({ name: "paystack", version: "0.1.0" });

const ok = (d) => ({ content: [{ type: "text", text: JSON.stringify(d, null, 2) }] });
const fail = (m) => ({ isError: true, content: [{ type: "text", text: m }] });

const handle = (fn) => async (args) => {
  try {
    return await fn(args);
  } catch (e) {
    if (e instanceof GuardError) return fail(`Refused: ${e.message}`);
    if (e instanceof PaystackError) {
      return fail(`Paystack error${e.code ? ` (${e.code})` : ""}: ${e.message}`);
    }
    return fail(`Unexpected error: ${e.message}`);
  }
};

server.registerTool(
  "paystack_environment",
  {
    title: "Show Paystack environment",
    description:
      "Report whether this server is in test or live mode, read from the secret key " +
      "prefix, plus the configured currency and amount ceiling. Call this first, and " +
      "always before initialising a transaction.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  handle(async () => ok({
    mode: config.mode.name,
    movesRealMoney: config.mode.real,
    secretKey: mask(config.secretKey),
    defaultCurrency: config.currency,
    maxAmount: config.maxAmount,
    amountUnits: `major units (e.g. 149.99 means 149.99 ${config.currency}), never subunits`,
    confirmationRequired: config.mode.real,
  })),
);

server.registerTool(
  "paystack_verify_credentials",
  {
    title: "Verify Paystack credentials",
    description: "Check the secret key works by fetching the account balance. Read-only.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  handle(async () => {
    const r = await client.balance();
    return ok({ valid: true, mode: config.mode.name, balances: r?.data });
  }),
);

server.registerTool(
  "paystack_list_banks",
  {
    title: "List supported banks",
    description:
      "List the banks Paystack supports in a country, with the codes needed for " +
      "transfers and direct debit. Read-only.",
    inputSchema: {
      country: z.string().optional()
        .describe('Country name, e.g. "south africa", "nigeria", "ghana", "kenya"'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  handle(async (a) => {
    const r = await client.listBanks(a.country ?? "south africa");
    return ok((r?.data ?? []).map((b) => ({
      name: b.name, code: b.code, currency: b.currency, type: b.type,
    })));
  }),
);

server.registerTool(
  "paystack_initialize_transaction",
  {
    title: "Start a Paystack payment",
    description:
      "Create a payment and return a checkout URL for the customer. AMOUNTS ARE IN " +
      "MAJOR UNITS: pass 149.99 for one hundred and forty-nine rand ninety-nine, not " +
      "14999. On a live key this charges REAL money and needs explicit confirmation " +
      "from the human you are working for; never supply that phrase yourself.",
    inputSchema: {
      amount: z.number().positive()
        .describe("Amount in MAJOR units (rands, naira, cedis), e.g. 149.99"),
      email: z.string().describe("Customer's email address"),
      currency: z.enum(Object.keys(CURRENCIES)).optional()
        .describe(`Defaults to ${config.currency}`),
      reference: z.string().optional()
        .describe("Your own unique reference. Letters, numbers and - . = only."),
      callbackUrl: z.string().optional()
        .describe("https URL the customer returns to after paying"),
      channels: z.array(z.string()).optional()
        .describe('Restrict payment methods, e.g. ["card","eft","mobile_money"]'),
      confirm: z.string().optional()
        .describe(`Required on a live key only. Must be exactly "${CONFIRM_PHRASE}".`),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  handle(async (a) => {
    checkLiveConfirmation(config.mode, a.confirm);
    const currency = a.currency ?? config.currency;
    const amountSubunit = toSubunit(a.amount, currency, config.maxAmount);

    const r = await client.initializeTransaction({
      amountSubunit,
      email: checkEmail(a.email),
      currency,
      reference: checkReference(a.reference),
      callbackUrl: checkUrl(a.callbackUrl, "callbackUrl"),
      channels: a.channels,
    });

    return ok({
      mode: config.mode.name,
      movesRealMoney: config.mode.real,
      amount: `${a.amount} ${currency}`,
      sentAsSubunit: amountSubunit,
      checkoutUrl: r?.data?.authorization_url,
      reference: r?.data?.reference,
      accessCode: r?.data?.access_code,
    });
  }),
);

server.registerTool(
  "paystack_verify_transaction",
  {
    title: "Verify a Paystack transaction",
    description:
      "Check whether a transaction succeeded, by reference. Read-only. Also " +
      "cross-checks the environment Paystack reports against this server's key.",
    inputSchema: {
      reference: z.string().min(1).describe("The transaction reference"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  handle(async (a) => {
    const r = await client.verifyTransaction(checkReference(a.reference));
    const d = r?.data ?? {};
    const warning = crossCheckDomain(config.mode, d.domain);
    const meta = CURRENCIES[d.currency] ?? { subunit: 100 };
    return ok({
      ...(warning ? { warning } : {}),
      reference: d.reference,
      status: d.status,
      amount: d.amount != null ? `${d.amount / meta.subunit} ${d.currency}` : null,
      paidAt: d.paid_at,
      channel: d.channel,
      gatewayResponse: d.gateway_response,
      domain: d.domain,
      customer: d.customer?.email,
    });
  }),
);

server.registerTool(
  "paystack_list_transactions",
  {
    title: "List Paystack transactions",
    description: "List recent transactions on the integration. Read-only.",
    inputSchema: {
      perPage: z.number().int().min(1).max(100).optional().describe("Default 20"),
      page: z.number().int().min(1).optional().describe("Default 1"),
      status: z.enum(["success", "failed", "abandoned"]).optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  handle(async (a) => {
    const r = await client.listTransactions(a);
    return ok((r?.data ?? []).map((t) => {
      const meta = CURRENCIES[t.currency] ?? { subunit: 100 };
      return {
        reference: t.reference,
        status: t.status,
        amount: `${t.amount / meta.subunit} ${t.currency}`,
        paidAt: t.paid_at,
        channel: t.channel,
        customer: t.customer?.email,
      };
    }));
  }),
);

await server.connect(new StdioServerTransport());
log("ready");
