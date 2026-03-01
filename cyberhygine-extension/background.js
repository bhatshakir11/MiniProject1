const CONFIG = Object.freeze({
  API_BASE_URL: "http://localhost:9000/api",
  LOGIN_URL: "http://localhost:3000/login",
  APP_ORIGINS: ["http://localhost:3000", "https://localhost:3000"],
  TOKEN_KEY: "jwt_token",
  NEVER_AUTOFILL_KEY: "never_autofill_domains",
  REQUEST_TIMEOUT_MS: 10000
});

const MESSAGE = Object.freeze({
  GET_ACTIVE_CONTEXT: "GET_ACTIVE_CONTEXT",
  GET_AUTH_STATUS: "GET_AUTH_STATUS",
  OPEN_LOGIN: "OPEN_LOGIN",
  SYNC_TOKEN_FROM_APP: "SYNC_TOKEN_FROM_APP",
  REQUEST_BIOMETRIC_GATE: "REQUEST_BIOMETRIC_GATE",
  FETCH_VAULT_FOR_ACTIVE_TAB: "FETCH_VAULT_FOR_ACTIVE_TAB",
  PERFORM_AUTOFILL: "PERFORM_AUTOFILL",
  SET_NEVER_AUTOFILL: "SET_NEVER_AUTOFILL",
  GET_NEVER_AUTOFILL_STATUS: "GET_NEVER_AUTOFILL_STATUS",
  SET_TOKEN: "SET_TOKEN",
  CLEAR_TOKEN: "CLEAR_TOKEN"
});

const CODE = Object.freeze({
  OK: "OK",
  NO_TOKEN: "NO_TOKEN",
  UNAUTHORIZED: "UNAUTHORIZED",
  UNSUPPORTED_PAGE: "UNSUPPORTED_PAGE",
  SITE_BLOCKED: "SITE_BLOCKED",
  NETWORK_ERROR: "NETWORK_ERROR",
  API_ERROR: "API_ERROR",
  INVALID_RESPONSE: "INVALID_RESPONSE",
  CREDENTIAL_NOT_FOUND: "CREDENTIAL_NOT_FOUND",
  DOMAIN_MISMATCH: "DOMAIN_MISMATCH",
  PHISHING_BLOCKED: "PHISHING_BLOCKED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  BIOMETRIC_FAILED: "BIOMETRIC_FAILED"
});

const SECOND_LEVEL_SUFFIXES = new Set([
  "co.uk",
  "org.uk",
  "gov.uk",
  "ac.uk",
  "co.in",
  "com.au",
  "com.br",
  "com.mx",
  "co.jp",
  "co.nz",
  "com.sg"
]);

const storageGet = (keys) =>
  new Promise((resolve) => chrome.storage.local.get(keys, resolve));

const storageSet = (items) =>
  new Promise((resolve) => chrome.storage.local.set(items, resolve));

const storageRemove = (keys) =>
  new Promise((resolve) => chrome.storage.local.remove(keys, resolve));

function normalizeString(value, maxLen = 1024) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
}

function isIPv4(hostname) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
}

function extractHostname(value) {
  const input = normalizeString(value, 2048);
  if (!input) return "";
  try {
    if (/^https?:\/\//i.test(input)) {
      return new URL(input).hostname.toLowerCase();
    }
    return new URL(`https://${input}`).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function getBaseDomainFromHostname(hostnameInput) {
  let hostname = normalizeString(hostnameInput).toLowerCase();
  if (!hostname) return "";
  hostname = hostname.replace(/\.+$/, "");
  if (!hostname) return "";

  if (hostname === "localhost" || isIPv4(hostname) || hostname.includes(":")) {
    return hostname;
  }

  const parts = hostname.split(".").filter(Boolean);
  if (parts.length <= 2) return hostname;

  const last2 = parts.slice(-2).join(".");
  const last3 = parts.slice(-3).join(".");

  if (SECOND_LEVEL_SUFFIXES.has(last2) && parts.length >= 3) {
    return last3;
  }

  return last2;
}

function getBaseDomain(value) {
  const hostname = extractHostname(value);
  return getBaseDomainFromHostname(hostname);
}

function decodeJwtPayload(token) {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const json = atob(padded);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function isJwtExpired(token) {
  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload.exp !== "number") return true;
  return Date.now() >= payload.exp * 1000;
}

function looksLikeJwt(token) {
  const value = normalizeString(token, 4096);
  return /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(value);
}

async function getToken() {
  const data = await storageGet([CONFIG.TOKEN_KEY]);
  const token = normalizeString(data[CONFIG.TOKEN_KEY], 4096);
  return token || "";
}

async function setToken(token) {
  await storageSet({ [CONFIG.TOKEN_KEY]: token });
}

async function clearToken() {
  await storageRemove([CONFIG.TOKEN_KEY]);
}

async function getNeverAutofillDomains() {
  const data = await storageGet([CONFIG.NEVER_AUTOFILL_KEY]);
  const raw = Array.isArray(data[CONFIG.NEVER_AUTOFILL_KEY])
    ? data[CONFIG.NEVER_AUTOFILL_KEY]
    : [];
  const normalized = raw.map((d) => getBaseDomain(d)).filter(Boolean);
  return [...new Set(normalized)];
}

async function isNeverAutofill(domain) {
  const baseDomain = getBaseDomain(domain);
  if (!baseDomain) return false;
  const list = await getNeverAutofillDomains();
  return list.includes(baseDomain);
}

async function setNeverAutofill(domain, enabled) {
  const baseDomain = getBaseDomain(domain);
  if (!baseDomain) return false;

  const list = await getNeverAutofillDomains();
  const next = new Set(list);

  if (enabled) next.add(baseDomain);
  else next.delete(baseDomain);

  await storageSet({ [CONFIG.NEVER_AUTOFILL_KEY]: [...next] });
  return enabled;
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs && tabs.length > 0 ? tabs[0] : null;
}

function isTrustedAppUrl(urlValue) {
  try {
    const url = new URL(urlValue);
    const origin = `${url.protocol}//${url.host}`.toLowerCase();
    return CONFIG.APP_ORIGINS.includes(origin);
  } catch {
    return false;
  }
}

async function findTrustedAppTab() {
  const tabs = await chrome.tabs.query({});
  return tabs.find((tab) => tab && tab.id && tab.url && isTrustedAppUrl(tab.url)) || null;
}

async function trySyncTokenFromAppTabs() {
  const appTab = await findTrustedAppTab();
  if (!appTab || !appTab.id) {
    return { ok: false, code: CODE.NO_TOKEN, message: "Open Cyber Hygiene app and login first." };
  }

  try {
    const response = await sendMessageToTab(appTab.id, { type: "CYBERHYGIENE_READ_APP_TOKEN" });
    const token = normalizeString(response && response.token, 4096);
    if (!looksLikeJwt(token) || isJwtExpired(token)) {
      return { ok: false, code: CODE.UNAUTHORIZED, message: "Login session not found or expired." };
    }
    await setToken(token);
    return { ok: true, code: CODE.OK };
  } catch {
    try {
      await ensureContentScript(appTab.id);
      const response = await sendMessageToTab(appTab.id, { type: "CYBERHYGIENE_READ_APP_TOKEN" });
      const token = normalizeString(response && response.token, 4096);
      if (!looksLikeJwt(token) || isJwtExpired(token)) {
        return { ok: false, code: CODE.UNAUTHORIZED, message: "Login session not found or expired." };
      }
      await setToken(token);
      return { ok: true, code: CODE.OK };
    } catch {
      return { ok: false, code: CODE.INTERNAL_ERROR, message: "Could not sync token from app tab." };
    }
  }
}

async function requestBiometricGateViaAppTab() {
  const appTab = await findTrustedAppTab();
  if (!appTab || !appTab.id) {
    return {
      ok: false,
      code: CODE.BIOMETRIC_FAILED,
      message: "Open Cyber Hygiene app tab and login before autofill."
    };
  }

  const originalTab = await getActiveTab();

  try {
    if (appTab.windowId) {
      await chrome.windows.update(appTab.windowId, { focused: true });
    }
    await chrome.tabs.update(appTab.id, { active: true });
  } catch {
    // non-fatal; continue
  }

  const biometricMessage = { type: "CYBERHYGIENE_BIOMETRIC_GATE" };

  const parseResult = async (response) => {
    if (!response || !response.ok) {
      return {
        ok: false,
        code: CODE.BIOMETRIC_FAILED,
        message: (response && response.message) || "Biometric verification failed."
      };
    }

    const newToken = normalizeString(response.token, 4096);
    if (looksLikeJwt(newToken) && !isJwtExpired(newToken)) {
      await setToken(newToken);
    }

    return { ok: true, code: CODE.OK };
  };

  let result;
  try {
    const response = await sendMessageToTab(appTab.id, biometricMessage);
    result = await parseResult(response);
  } catch {
    try {
      await ensureContentScript(appTab.id);
      const response = await sendMessageToTab(appTab.id, biometricMessage);
      result = await parseResult(response);
    } catch {
      result = {
        ok: false,
        code: CODE.BIOMETRIC_FAILED,
        message: "Unable to start biometric verification."
      };
    }
  }

  try {
    if (originalTab && originalTab.id) {
      if (originalTab.windowId) {
        await chrome.windows.update(originalTab.windowId, { focused: true });
      }
      await chrome.tabs.update(originalTab.id, { active: true });
    }
  } catch {
    // non-fatal
  }

  return result;
}


async function getActiveContext() {
  const tab = await getActiveTab();
  if (!tab || !tab.id || !tab.url) {
    return {
      ok: false,
      code: CODE.UNSUPPORTED_PAGE,
      message: "No active tab."
    };
  }

  let url;
  try {
    url = new URL(tab.url);
  } catch {
    return {
      ok: false,
      code: CODE.UNSUPPORTED_PAGE,
      message: "Unsupported tab URL."
    };
  }

  if (!/^https?:$/.test(url.protocol)) {
    return {
      ok: false,
      code: CODE.UNSUPPORTED_PAGE,
      message: "Autofill works only on http/https pages."
    };
  }

  const domain = getBaseDomainFromHostname(url.hostname);
  if (!domain) {
    return {
      ok: false,
      code: CODE.UNSUPPORTED_PAGE,
      message: "Unable to detect domain."
    };
  }

  const blocked = await isNeverAutofill(domain);

  return {
    ok: true,
    code: CODE.OK,
    tabId: tab.id,
    url: tab.url,
    domain,
    blocked
  };
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    const v = normalizeString(value, 4096);
    if (v) return v;
  }
  return "";
}

function hashString(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash +=
      (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16);
}

function normalizeCredentialRecord(record, requestedDomain) {
  if (!record || typeof record !== "object") return null;

  const domainCandidate = firstNonEmptyString(
    record.domain,
    record.site,
    record.hostname,
    record.url
  );

  const credentialDomain = getBaseDomain(domainCandidate || requestedDomain);
  if (!credentialDomain || credentialDomain !== requestedDomain) return null;

  const username = firstNonEmptyString(
    record.username,
    record.email,
    record.login,
    record.decrypted_username,
    record.decryptedUsername,
    record.autofill && record.autofill.username
  );

  const password = firstNonEmptyString(
    record.password,
    record.decrypted_password,
    record.decryptedPassword,
    record.autofill && record.autofill.password
  );

  if (!username || !password) return null;

  const rawId = firstNonEmptyString(record.id, record.credential_id, record.uuid);
  const id =
    rawId || `cred_${hashString(`${credentialDomain}|${username}|${password}`)}`;

  return {
    id,
    domain: credentialDomain,
    username,
    password
  };
}

function extractCredentialArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    if (Array.isArray(payload.credentials)) return payload.credentials;
    if (Array.isArray(payload.items)) return payload.items;
    if (payload.data && Array.isArray(payload.data.credentials)) {
      return payload.data.credentials;
    }
    if ("username" in payload || "password" in payload) return [payload];
  }
  return [];
}

function maskUsername(username) {
  const value = normalizeString(username, 256);
  if (!value) return "Account";

  if (value.includes("@")) {
    const [name, host] = value.split("@");
    const left =
      name.length <= 2 ? `${name[0] || "*"}*` : `${name.slice(0, 2)}***`;
    return `${left}@${host}`;
  }

  if (value.length <= 2) return `${value[0] || "*"}*`;
  return `${value.slice(0, 2)}***`;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchVaultCredentials(domain, token) {
  try {
    const endpoint = `${CONFIG.API_BASE_URL}/vault?domain=${encodeURIComponent(
      domain
    )}`;
    const response = await fetchWithTimeout(
      endpoint,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json"
        },
        cache: "no-store"
      },
      CONFIG.REQUEST_TIMEOUT_MS
    );

    if (response.status === 401) {
      return {
        ok: false,
        code: CODE.UNAUTHORIZED,
        message: "Session expired."
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        code: CODE.API_ERROR,
        message: `Vault API error (${response.status}).`
      };
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      return {
        ok: false,
        code: CODE.INVALID_RESPONSE,
        message: "Invalid JSON response from vault API."
      };
    }

    const records = extractCredentialArray(payload);
    const credentials = records
      .map((record) => normalizeCredentialRecord(record, domain))
      .filter(Boolean);

    return {
      ok: true,
      code: CODE.OK,
      credentials
    };
  } catch {
    return {
      ok: false,
      code: CODE.NETWORK_ERROR,
      message: "Network error while contacting backend."
    };
  }
}

function sendMessageToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(response);
    });
  });
}

async function ensureContentScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"]
  });
}

async function autofillInTab(tabId, domain, credential) {
  const message = {
    type: "CYBERHYGIENE_AUTOFILL",
    payload: {
      domain,
      username: credential.username,
      password: credential.password
    }
  };

  try {
    const result = await sendMessageToTab(tabId, message);
    if (result && typeof result === "object") return result;
    return { ok: true, code: CODE.OK };
  } catch {
    try {
      await ensureContentScript(tabId);
      const result = await sendMessageToTab(tabId, message);
      if (result && typeof result === "object") return result;
      return { ok: true, code: CODE.OK };
    } catch {
      return {
        ok: false,
        code: CODE.INTERNAL_ERROR,
        message: "Unable to inject autofill content script."
      };
    }
  }
}

async function handleGetAuthStatus() {
  let token = await getToken();
  if (!token) {
    const synced = await trySyncTokenFromAppTabs();
    if (synced.ok) {
      token = await getToken();
    } else {
      return {
        ok: true,
        code: CODE.OK,
        authorized: false
      };
    }
  }

  if (isJwtExpired(token)) {
    await clearToken();
    return {
      ok: true,
      code: CODE.UNAUTHORIZED,
      authorized: false,
      expired: true
    };
  }

  return {
    ok: true,
    code: CODE.OK,
    authorized: true
  };
}

async function handleFetchVaultForActiveTab() {
  const token = await getToken();
  if (!token) {
    return {
      ok: false,
      code: CODE.NO_TOKEN,
      message: "Please login to Cyber Hygiene."
    };
  }

  if (isJwtExpired(token)) {
    await clearToken();
    return {
      ok: false,
      code: CODE.UNAUTHORIZED,
      message: "Session expired. Please login again."
    };
  }

  const context = await getActiveContext();
  if (!context.ok) return context;

  if (context.blocked) {
    return {
      ok: false,
      code: CODE.SITE_BLOCKED,
      domain: context.domain,
      message: "Autofill is disabled for this site."
    };
  }

  const activeToken = await getToken();
  const vault = await fetchVaultCredentials(context.domain, activeToken || token);
  if (!vault.ok) {
    if (vault.code === CODE.UNAUTHORIZED) {
      await clearToken();
    }
    return vault;
  }

  const metadata = vault.credentials.map((item) => ({
    id: item.id,
    label: maskUsername(item.username)
  }));

  return {
    ok: true,
    code: CODE.OK,
    domain: context.domain,
    credentials: metadata
  };
}

async function handlePerformAutofill(message) {
  const credentialId = normalizeString(message && message.credentialId, 512);
  if (!credentialId) {
    return {
      ok: false,
      code: CODE.CREDENTIAL_NOT_FOUND,
      message: "Credential not selected."
    };
  }

  const token = await getToken();
  if (!token) {
    return {
      ok: false,
      code: CODE.NO_TOKEN,
      message: "Please login to Cyber Hygiene."
    };
  }

  if (isJwtExpired(token)) {
    await clearToken();
    return {
      ok: false,
      code: CODE.UNAUTHORIZED,
      message: "Session expired. Please login again."
    };
  }

  const biometric = await requestBiometricGateViaAppTab();
  if (!biometric.ok) {
    return biometric;
  }

  const context = await getActiveContext();
  if (!context.ok) return context;

  if (context.blocked) {
    return {
      ok: false,
      code: CODE.SITE_BLOCKED,
      message: "Autofill is disabled for this site."
    };
  }

  const vault = await fetchVaultCredentials(context.domain, token);
  if (!vault.ok) {
    if (vault.code === CODE.UNAUTHORIZED) {
      await clearToken();
    }
    return vault;
  }

  const selected = vault.credentials.find((c) => c.id === credentialId);
  if (!selected) {
    return {
      ok: false,
      code: CODE.CREDENTIAL_NOT_FOUND,
      message: "Selected credential is no longer available."
    };
  }

  if (selected.domain !== context.domain) {
    return {
      ok: false,
      code: CODE.PHISHING_BLOCKED,
      message: "Domain mismatch detected. Autofill blocked."
    };
  }

  const fillResult = await autofillInTab(context.tabId, context.domain, selected);
  return fillResult;
}

async function handleMessage(message) {
  const type = message && message.type;

  switch (type) {
    case MESSAGE.GET_ACTIVE_CONTEXT: {
      return getActiveContext();
    }

    case MESSAGE.GET_AUTH_STATUS: {
      return handleGetAuthStatus();
    }

    case MESSAGE.OPEN_LOGIN: {
      await chrome.tabs.create({ url: CONFIG.LOGIN_URL });
      return { ok: true, code: CODE.OK };
    }

    case MESSAGE.SYNC_TOKEN_FROM_APP: {
      const synced = await trySyncTokenFromAppTabs();
      if (!synced.ok) {
        return synced;
      }
      return { ok: true, code: CODE.OK, authorized: true };
    }

    case MESSAGE.REQUEST_BIOMETRIC_GATE: {
      return requestBiometricGateViaAppTab();
    }

    case MESSAGE.FETCH_VAULT_FOR_ACTIVE_TAB: {
      return handleFetchVaultForActiveTab();
    }

    case MESSAGE.PERFORM_AUTOFILL: {
      return handlePerformAutofill(message);
    }

    case MESSAGE.SET_NEVER_AUTOFILL: {
      const enabled = Boolean(message && message.enabled);
      let domain = getBaseDomain(message && message.domain);

      if (!domain) {
        const context = await getActiveContext();
        if (!context.ok) return context;
        domain = context.domain;
      }

      const blocked = await setNeverAutofill(domain, enabled);
      return {
        ok: true,
        code: CODE.OK,
        domain,
        blocked
      };
    }

    case MESSAGE.GET_NEVER_AUTOFILL_STATUS: {
      let domain = getBaseDomain(message && message.domain);

      if (!domain) {
        const context = await getActiveContext();
        if (!context.ok) return context;
        domain = context.domain;
      }

      const blocked = await isNeverAutofill(domain);
      return {
        ok: true,
        code: CODE.OK,
        domain,
        blocked
      };
    }

    case MESSAGE.SET_TOKEN: {
      const token = normalizeString(message && message.token, 4096);
      if (!token) {
        return {
          ok: false,
          code: CODE.INVALID_RESPONSE,
          message: "Invalid token."
        };
      }
      await setToken(token);
      return { ok: true, code: CODE.OK };
    }

    case MESSAGE.CLEAR_TOKEN: {
      await clearToken();
      return { ok: true, code: CODE.OK };
    }

    default:
      return {
        ok: false,
        code: CODE.INVALID_RESPONSE,
        message: "Unknown message type."
      };
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const data = await storageGet([CONFIG.NEVER_AUTOFILL_KEY]);
  if (!Array.isArray(data[CONFIG.NEVER_AUTOFILL_KEY])) {
    await storageSet({ [CONFIG.NEVER_AUTOFILL_KEY]: [] });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch(() => {
      sendResponse({
        ok: false,
        code: CODE.INTERNAL_ERROR,
        message: "Internal extension error."
      });
    });
  return true;
});
