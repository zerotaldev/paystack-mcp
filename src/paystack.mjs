/**
 * Paystack API client.
 *
 * One base URL for both modes; the secret key decides which environment the
 * call lands in. Errors come back as {status:false, message, code}.
 */
import { API_BASE } from "./config.mjs";

export class PaystackError extends Error {
  constructor(message, { status, code, body } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

export class PaystackClient {
  #key;

  constructor(config) {
    this.#key = config.secretKey;
  }

  async #request(method, path, { body, query } = {}) {
    const url = new URL(API_BASE + path);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v != null) url.searchParams.set(k, String(v));
    }

    let res;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.#key}`,
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch (e) {
      throw new PaystackError(`Network error: ${e.message}`);
    }

    const text = await res.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { raw: text.slice(0, 500) };
    }

    if (!res.ok || parsed?.status === false) {
      throw new PaystackError(parsed?.message ?? `${method} ${path} failed (${res.status})`, {
        status: res.status,
        code: parsed?.code,
        body: parsed,
      });
    }
    return parsed;
  }

  initializeTransaction({ amountSubunit, email, currency, reference, callbackUrl, channels, metadata }) {
    return this.#request("POST", "/transaction/initialize", {
      body: {
        amount: String(amountSubunit),
        email,
        currency,
        ...(reference ? { reference } : {}),
        ...(callbackUrl ? { callback_url: callbackUrl } : {}),
        ...(channels?.length ? { channels } : {}),
        ...(metadata ? { metadata: JSON.stringify(metadata) } : {}),
      },
    });
  }

  verifyTransaction(reference) {
    return this.#request("GET", `/transaction/verify/${encodeURIComponent(reference)}`);
  }

  listTransactions({ perPage = 20, page = 1, status } = {}) {
    return this.#request("GET", "/transaction", {
      query: { perPage, page, status },
    });
  }

  balance() {
    return this.#request("GET", "/balance");
  }

  /** Public endpoint: works without a key, useful as a connectivity check. */
  listBanks(country = "south africa") {
    return this.#request("GET", "/bank", { query: { country } });
  }
}
