const MESSAGE = Object.freeze({
  GET_ACTIVE_CONTEXT: "GET_ACTIVE_CONTEXT",
  GET_AUTH_STATUS: "GET_AUTH_STATUS",
  OPEN_LOGIN: "OPEN_LOGIN",
  SYNC_TOKEN_FROM_APP: "SYNC_TOKEN_FROM_APP",
  FETCH_VAULT_FOR_ACTIVE_TAB: "FETCH_VAULT_FOR_ACTIVE_TAB",
  PERFORM_AUTOFILL: "PERFORM_AUTOFILL",
  CAPTURE_LOGIN_CREDENTIAL: "CAPTURE_LOGIN_CREDENTIAL",
  SET_NEVER_AUTOFILL: "SET_NEVER_AUTOFILL"
});

const CODE = Object.freeze({
  NO_TOKEN: "NO_TOKEN",
  UNAUTHORIZED: "UNAUTHORIZED",
  SITE_BLOCKED: "SITE_BLOCKED",
  UNSUPPORTED_PAGE: "UNSUPPORTED_PAGE",
  CREDENTIAL_NOT_FOUND: "CREDENTIAL_NOT_FOUND",
  NETWORK_ERROR: "NETWORK_ERROR",
  NO_PASSWORD_FIELD: "NO_PASSWORD_FIELD",
  DOMAIN_MISMATCH: "DOMAIN_MISMATCH",
  PHISHING_BLOCKED: "PHISHING_BLOCKED",
  PASSWORD_ONLY_FILLED: "PASSWORD_ONLY_FILLED",
  AUTOFILL_SUCCESS: "AUTOFILL_SUCCESS"
});

const CONFIG = Object.freeze({
  API_BASE_URL: "http://localhost:9000/api",
  TOKEN_KEY: "jwt_token",
  REQUEST_TIMEOUT_MS: 10000
});

const state = {
  domain: "",
  blocked: false,
  authorized: false,
  credentials: [],
  isLoading: false,
  autoLoginOpened: false
};

const el = {
  domainValue: document.getElementById("domainValue"),
  status: document.getElementById("status"),
  loading: document.getElementById("loading"),
  credentialsSection: document.getElementById("credentialsSection"),
  credentialSelect: document.getElementById("credentialSelect"),
  autofillBtn: document.getElementById("autofillBtn"),
  emptySection: document.getElementById("emptySection"),
  addSection: document.getElementById("addSection"),
  addUsername: document.getElementById("addUsername"),
  addPassword: document.getElementById("addPassword"),
  saveAddBtn: document.getElementById("saveAddBtn"),
  cancelAddBtn: document.getElementById("cancelAddBtn"),
  addOpenBtn: document.getElementById("addOpenBtn"),
  loginBtn: document.getElementById("loginBtn"),
  syncBtn: document.getElementById("syncBtn"),
  neverBtn: document.getElementById("neverBtn"),
  refreshBtn: document.getElementById("refreshBtn")
};

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(response || {});
    });
  });
}

function setStatus(message, type = "info") {
  el.status.textContent = message;
  el.status.className = `card status ${type}`;
}

function normalizeString(value, maxLen = 4096) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
}

function getBaseDomainFromHostname(hostnameInput) {
  let hostname = normalizeString(hostnameInput, 2048).toLowerCase();
  if (!hostname) return "";
  hostname = hostname.replace(/\.+$/, "");
  if (!hostname) return "";

  const isIPv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
  if (hostname === "localhost" || isIPv4 || hostname.includes(":")) {
    return hostname;
  }

  const parts = hostname.split(".").filter(Boolean);
  if (parts.length <= 2) return hostname;
  return parts.slice(-2).join(".");
}

function getBaseDomain(value) {
  const input = normalizeString(value, 2048);
  if (!input) return "";
  try {
    if (/^https?:\/\//i.test(input)) {
      return getBaseDomainFromHostname(new URL(input).hostname);
    }
    return getBaseDomainFromHostname(new URL(`https://${input}`).hostname);
  } catch {
    return "";
  }
}

function estimatePasswordStrength(password) {
  const value = normalizeString(password);
  if (!value) return "weak";

  let score = 0;
  if (value.length >= 8) score += 1;
  if (value.length >= 12) score += 1;
  if (value.length >= 16) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value)) score += 1;
  if (/[^A-Za-z0-9]/.test(value)) score += 1;
  if (score <= 2) return "weak";
  if (score <= 4) return "medium";
  return "strong";
}

function fetchWithTimeout(url, options = {}, timeoutMs = CONFIG.REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => {
    clearTimeout(timer);
  });
}

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

async function getStoredToken() {
  const data = await storageGet([CONFIG.TOKEN_KEY]);
  return normalizeString(data[CONFIG.TOKEN_KEY], 4096);
}

function isUnknownMessageType(result) {
  const message = normalizeString(result && result.message, 512).toLowerCase();
  return message.includes("unknown message type");
}

async function saveCredentialDirect(domain, username, password) {
  const token = await getStoredToken();
  if (!token) {
    return {
      ok: false,
      code: CODE.NO_TOKEN,
      message: "Please login to Cyber Hygiene."
    };
  }

  const siteDomain = getBaseDomain(domain);
  if (!siteDomain) {
    return {
      ok: false,
      code: "INVALID_DOMAIN",
      message: "Invalid domain."
    };
  }

  let existingId = null;
  try {
    const listRes = await fetchWithTimeout(`${CONFIG.API_BASE_URL}/credentials`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json"
      },
      cache: "no-store"
    });

    if (listRes.status === 401) {
      return {
        ok: false,
        code: CODE.UNAUTHORIZED,
        message: "Session expired. Please login again."
      };
    }

    if (!listRes.ok) {
      return {
        ok: false,
        code: CODE.NETWORK_ERROR,
        message: "Could not reach credentials API."
      };
    }

    const rows = await listRes.json();
    const usernameLower = normalizeString(username, 1024).toLowerCase();
    if (Array.isArray(rows)) {
      const match = rows.find((row) => {
        const rowDomain = getBaseDomain(row && row.site);
        const rowUser = normalizeString(row && row.username, 1024).toLowerCase();
        return rowDomain === siteDomain && rowUser === usernameLower;
      });
      if (match && (match.id || match.id === 0)) {
        existingId = String(match.id);
      }
    }
  } catch {
    return {
      ok: false,
      code: CODE.NETWORK_ERROR,
      message: "Network error while saving credential."
    };
  }

  const payload = {
    site: siteDomain,
    username: normalizeString(username, 1024),
    password: normalizeString(password, 4096),
    strength: estimatePasswordStrength(password)
  };

  try {
    const url = existingId
      ? `${CONFIG.API_BASE_URL}/credentials/${encodeURIComponent(existingId)}`
      : `${CONFIG.API_BASE_URL}/credentials`;
    const method = existingId ? "PUT" : "POST";

    const saveRes = await fetchWithTimeout(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(payload),
      cache: "no-store"
    });

    if (saveRes.status === 401) {
      return {
        ok: false,
        code: CODE.UNAUTHORIZED,
        message: "Session expired. Please login again."
      };
    }

    if (!saveRes.ok) {
      return {
        ok: false,
        code: CODE.NETWORK_ERROR,
        message: "Failed to save credential."
      };
    }

    return { ok: true };
  } catch {
    return {
      ok: false,
      code: CODE.NETWORK_ERROR,
      message: "Network error while saving credential."
    };
  }
}

function setLoading(isLoading) {
  state.isLoading = isLoading;
  el.loading.classList.toggle("hidden", !isLoading);
  el.autofillBtn.disabled = isLoading;
  el.refreshBtn.disabled = isLoading;
  el.loginBtn.disabled = isLoading;
  el.syncBtn.disabled = isLoading;
  el.neverBtn.disabled = isLoading;
  el.addOpenBtn.disabled = isLoading;
  el.saveAddBtn.disabled = isLoading;
  el.cancelAddBtn.disabled = isLoading;
}

function showSection(target) {
  el.credentialsSection.classList.add("hidden");
  el.emptySection.classList.add("hidden");

  if (target === "credentials") el.credentialsSection.classList.remove("hidden");
  if (target === "empty") el.emptySection.classList.remove("hidden");
}

function showLoginButton(show) {
  el.loginBtn.classList.toggle("hidden", !show);
}

function showSyncButton(show) {
  el.syncBtn.classList.toggle("hidden", !show);
}

function showNeverButton(show) {
  el.neverBtn.classList.toggle("hidden", !show);
}

function showAddButton(show) {
  el.addOpenBtn.classList.toggle("hidden", !show);
}

function showAddSection(show) {
  el.addSection.classList.toggle("hidden", !show);
}

function clearAddForm() {
  el.addUsername.value = "";
  el.addPassword.value = "";
}

function hideAddForm() {
  showAddSection(false);
  clearAddForm();
}

function updateNeverButton() {
  if (!state.domain) {
    showNeverButton(false);
    return;
  }
  showNeverButton(true);
  if (state.blocked) {
    el.neverBtn.textContent = "Allow autofill on this site";
    el.neverBtn.className = "btn-secondary";
  } else {
    el.neverBtn.textContent = "Never autofill on this site";
    el.neverBtn.className = "btn-danger";
  }
}

function populateCredentialSelect(credentials) {
  el.credentialSelect.innerHTML = "";
  credentials.forEach((cred, idx) => {
    const opt = document.createElement("option");
    opt.value = cred.id;
    opt.textContent = cred.label || `Account ${idx + 1}`;
    el.credentialSelect.appendChild(opt);
  });
}

async function openLogin() {
  await sendMessage({ type: MESSAGE.OPEN_LOGIN });
}

async function redirectToLogin(statusMessage) {
  showLoginButton(true);
  showSyncButton(true);
  showAddButton(false);
  hideAddForm();
  showSection(null);
  setStatus(statusMessage, "warn");

  if (!state.autoLoginOpened) {
    state.autoLoginOpened = true;
    try {
      await openLogin();
    } catch {
      // no-op
    }
  }
}

async function loadPopupData() {
  setLoading(true);
  hideAddForm();
  showSection(null);
  showLoginButton(false);
  showSyncButton(false);
  showAddButton(false);

  try {
    const context = await sendMessage({ type: MESSAGE.GET_ACTIVE_CONTEXT });

    if (!context.ok) {
      state.domain = "";
      state.blocked = false;
      el.domainValue.textContent = "-";
      showNeverButton(false);
      showAddButton(false);
      setStatus(context.message || "Unsupported page.", "warn");
      return;
    }

    state.domain = context.domain || "";
    state.blocked = Boolean(context.blocked);
    el.domainValue.textContent = state.domain || "-";
    updateNeverButton();

    const auth = await sendMessage({ type: MESSAGE.GET_AUTH_STATUS });
    state.authorized = Boolean(auth && auth.authorized);

    if (!state.authorized) {
      const msg =
        auth && auth.expired
          ? "Session expired. Please login to Cyber Hygiene."
          : "Please login to Cyber Hygiene.";
      showLoginButton(true);
      showSyncButton(true);
      showAddButton(false);
      showSection(null);
      setStatus(msg, "warn");
      return;
    }

    showAddButton(true);

    if (state.blocked) {
      showSection(null);
      setStatus("Autofill is disabled for this site.", "warn");
      return;
    }

    const vault = await sendMessage({
      type: MESSAGE.FETCH_VAULT_FOR_ACTIVE_TAB
    });

    if (!vault.ok) {
      if (vault.code === CODE.NO_TOKEN || vault.code === CODE.UNAUTHORIZED) {
        await redirectToLogin("Session expired. Please login to Cyber Hygiene.");
        return;
      }

      if (vault.code === CODE.SITE_BLOCKED) {
        state.blocked = true;
        updateNeverButton();
        showSection(null);
        setStatus("Autofill is disabled for this site.", "warn");
        return;
      }

      if (vault.code === CODE.UNSUPPORTED_PAGE) {
        showSection(null);
        setStatus(vault.message || "Unsupported page.", "warn");
        return;
      }

      if (vault.code === CODE.NETWORK_ERROR) {
        showSection(null);
        setStatus("Network error. Check backend connectivity.", "error");
        return;
      }

      showSection(null);
      setStatus(vault.message || "Failed to fetch vault credentials.", "error");
      return;
    }

    const credentials = Array.isArray(vault.credentials) ? vault.credentials : [];
    state.credentials = credentials;

    if (credentials.length === 0) {
      showSection("empty");
      setStatus("No credentials found for this domain.", "info");
      return;
    }

    populateCredentialSelect(credentials);
    showSection("credentials");
    setStatus("Credential found. Click Autofill to continue.", "success");
  } catch {
    showSection(null);
    setStatus("Unexpected extension error.", "error");
  } finally {
    setLoading(false);
  }
}

async function syncSessionFromApp() {
  setLoading(true);
  try {
    const result = await sendMessage({ type: MESSAGE.SYNC_TOKEN_FROM_APP });
    if (!result.ok) {
      setStatus(result.message || "Could not sync login session.", "warn");
      return;
    }
    setStatus("Login session synced. Loading vault...", "success");
    await loadPopupData();
  } catch {
    setStatus("Could not sync login session.", "error");
  } finally {
    setLoading(false);
  }
}

async function onAutofillClick() {
  if (!state.authorized) {
    await redirectToLogin("Please login to Cyber Hygiene.");
    return;
  }

  if (state.blocked) {
    setStatus("Autofill is disabled for this site.", "warn");
    return;
  }

  const credentialId = el.credentialSelect.value;
  if (!credentialId) {
    setStatus("No credential selected.", "warn");
    return;
  }

  setLoading(true);
  setStatus("Waiting for fingerprint verification...", "info");

  try {
    const result = await sendMessage({
      type: MESSAGE.PERFORM_AUTOFILL,
      credentialId
    });

    if (!result.ok) {
      if (result.code === CODE.NO_TOKEN || result.code === CODE.UNAUTHORIZED) {
        await redirectToLogin("Session expired. Please login to Cyber Hygiene.");
        return;
      }

      if (result.code === CODE.PHISHING_BLOCKED || result.code === CODE.DOMAIN_MISMATCH) {
        setStatus("Domain mismatch detected. Autofill blocked.", "error");
        return;
      }

      if (result.code === CODE.NO_PASSWORD_FIELD) {
        setStatus("Password field not found on this page.", "warn");
        return;
      }

      if (result.code === CODE.CREDENTIAL_NOT_FOUND) {
        setStatus("Credential is no longer available. Refresh and retry.", "warn");
        return;
      }

      setStatus(result.message || "Autofill failed.", "error");
      return;
    }

    if (result.code === CODE.PASSWORD_ONLY_FILLED) {
      setStatus("Password filled. Username/email field not found.", "warn");
      return;
    }

    if (result.code === CODE.AUTOFILL_SUCCESS) {
      setStatus("Credentials autofilled successfully.", "success");
      return;
    }

    setStatus("Autofill completed.", "success");
  } catch {
    setStatus("Autofill error.", "error");
  } finally {
    setLoading(false);
  }
}

async function onNeverToggleClick() {
  if (!state.domain) return;
  setLoading(true);

  try {
    const nextEnabled = !state.blocked;
    const result = await sendMessage({
      type: MESSAGE.SET_NEVER_AUTOFILL,
      domain: state.domain,
      enabled: nextEnabled
    });

    if (!result.ok) {
      setStatus(result.message || "Could not update site rule.", "error");
      return;
    }

    state.blocked = Boolean(result.blocked);
    updateNeverButton();

    if (state.blocked) {
      showSection(null);
      setStatus("This site has been blocked for autofill.", "warn");
    } else {
      setStatus("Site unblocked. Fetching credentials...", "info");
      await loadPopupData();
    }
  } catch {
    setStatus("Could not update site rule.", "error");
  } finally {
    setLoading(false);
  }
}

async function onAddOpenClick() {
  if (!state.domain) {
    setStatus("Open a website tab first.", "warn");
    return;
  }

  if (!state.authorized) {
    await redirectToLogin("Please login to Cyber Hygiene.");
    return;
  }

  showAddSection(true);
  setStatus(`Add credential for ${state.domain}.`, "info");
}

async function onSaveAddClick() {
  if (!state.domain) {
    setStatus("No active domain detected.", "warn");
    return;
  }

  if (!state.authorized) {
    await redirectToLogin("Please login to Cyber Hygiene.");
    return;
  }

  const username = (el.addUsername.value || "").trim();
  const password = (el.addPassword.value || "").trim();

  if (!username || !password) {
    setStatus("Enter username and password.", "warn");
    return;
  }

  setLoading(true);
  setStatus("Saving credential...", "info");

  try {
    let result;
    try {
      result = await sendMessage({
        type: MESSAGE.CAPTURE_LOGIN_CREDENTIAL,
        domain: state.domain,
        site: state.domain,
        username,
        password
      });
    } catch {
      result = await saveCredentialDirect(state.domain, username, password);
    }

    if (!result.ok && isUnknownMessageType(result)) {
      result = await saveCredentialDirect(state.domain, username, password);
    }

    if (!result.ok) {
      if (result.code === CODE.NO_TOKEN || result.code === CODE.UNAUTHORIZED) {
        await redirectToLogin("Session expired. Please login to Cyber Hygiene.");
        return;
      }

      if (result.code === CODE.NETWORK_ERROR) {
        setStatus("Network error. Check backend connectivity.", "error");
        return;
      }

      setStatus(result.message || "Could not save credential.", "error");
      return;
    }

    hideAddForm();
    setStatus("Credential saved successfully.", "success");
    await loadPopupData();
  } catch {
    setStatus("Could not save credential.", "error");
  } finally {
    setLoading(false);
  }
}

function bindEvents() {
  el.loginBtn.addEventListener("click", async () => {
    try {
      await openLogin();
    } catch {
      setStatus("Unable to open login page.", "error");
    }
  });

  el.syncBtn.addEventListener("click", async () => {
    await syncSessionFromApp();
  });

  el.refreshBtn.addEventListener("click", () => {
    state.autoLoginOpened = false;
    loadPopupData();
  });

  el.autofillBtn.addEventListener("click", onAutofillClick);
  el.neverBtn.addEventListener("click", onNeverToggleClick);
  el.addOpenBtn.addEventListener("click", onAddOpenClick);
  el.cancelAddBtn.addEventListener("click", () => {
    hideAddForm();
    setStatus("Add credential cancelled.", "info");
  });
  el.saveAddBtn.addEventListener("click", onSaveAddClick);
}

document.addEventListener("DOMContentLoaded", async () => {
  bindEvents();
  await loadPopupData();
});
