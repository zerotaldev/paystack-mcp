# paystack-mcp

An MCP server for [Paystack](https://paystack.com), the payments API covering
Nigeria, Ghana, South Africa, Kenya and Côte d'Ivoire. It lets an AI assistant
create checkout links, verify payments and read transaction history.

**Test mode is enforced by the key you give it**, not by configuration.

Node 20+. One runtime dependency (the MCP SDK) plus zod.

## The safety model

Wrapping a payments API means a language model can move money, so:

**1. The key *is* the mode.** Paystack encodes the environment in the secret key
(`sk_test_` / `sk_live_`). This server reads it from the prefix, so there is no
way to believe you are in test mode while holding a live key. A key whose
prefix is unrecognised is refused outright, never assumed to be test.

**2. A live key still needs a second opt-in.** `PAYSTACK_ALLOW_LIVE` must be set
to an explicit acknowledgement. Supply a live key without it and the server
**refuses to start** rather than quietly transacting for real.

**3. Amounts are major units, never subunits.** Paystack's API takes kobo and
cents; this server takes rands and naira and converts. Handing a model a field
where `500` might mean five rand or five hundred is how accounts get emptied.
The ceiling is expressed in the same units the caller passes, so the two agree.

**4. A ceiling.** `PAYSTACK_MAX_AMOUNT` (default 1000) caps any single
transaction. It also catches the 100× error where someone passes subunits
anyway — there is a test for exactly that.

**5. Per-call confirmation, only where it means something.** On a live key,
`paystack_initialize_transaction` requires `confirm="CONFIRM LIVE PAYMENT"`
exactly. In test mode it does not: friction on imaginary money only teaches
people to click through.

**6. The API's own answer is cross-checked.** Paystack echoes `domain: "test"`
or `"live"` on a verified transaction. If that ever disagrees with the key
prefix, the tool says so loudly instead of hiding it.

**7. Secrets stay out of output.** The environment tool shows `sk_test_...1234`
— enough to tell two keys apart, never the key. A test fails if it leaks.

## Setup

```
npm install
cp .env.example .env     # paste your sk_test_ key
npm run check            # validates the key and reads your balance
```

Get the key from the Paystack dashboard under **Settings → API Keys & Webhooks**.
Signup needs no registered company: pick **Starter Business** and you get test
keys immediately.

## Tools

| Tool | Reads/writes | Notes |
|---|---|---|
| `paystack_environment` | read | Mode, currency, ceiling. No network call. |
| `paystack_verify_credentials` | read | Confirms the key and returns balances. |
| `paystack_list_banks` | read | Supported banks and codes, by country. |
| `paystack_initialize_transaction` | **write** | Returns a checkout URL. Confirmation required on a live key. |
| `paystack_verify_transaction` | read | Whether a payment succeeded. |
| `paystack_list_transactions` | read | Recent transactions. |

## Connecting a client

```json
{
  "mcpServers": {
    "paystack": {
      "command": "npx",
      "args": ["-y", "paystack-mcp"],
      "env": {
        "PAYSTACK_SECRET_KEY": "sk_test_...",
        "PAYSTACK_CURRENCY": "ZAR"
      }
    }
  }
}
```

## Tests

```
npm test
```

24 tests. Fourteen cover the guards as pure functions. Ten spawn the real
binary and speak MCP to it over stdio, checking that a live key refuses to
start unacknowledged, that live payments demand the confirmation phrase, that
over-ceiling and malformed requests are rejected before any network call, and
that the key never reaches the output.

One test is a genuine live call: `/bank` is a public Paystack endpoint, so the
suite verifies the whole path end to end against the real API and asserts it
gets recognisable South African banks back — without any credential at risk.

## Status

Early, but the read path is proven against the live API. The write path
(`initialize_transaction`) is built from Paystack's documented request shape
and exercised only through the guards; it has not yet created a real test
transaction. Do that first with an `sk_test_` key before trusting it.

Not covered yet: refunds, transfers and payouts, subscriptions and plans,
split payments and subaccounts, customer management, and webhook signature
verification.

## Licence

MIT
