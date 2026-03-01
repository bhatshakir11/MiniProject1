const MESSAGE = Object.freeze({
  GET_ACTIVE_CONTEXT: "GET_ACTIVE_CONTEXT",
  GET_AUTH_STATUS: "GET_AUTH_STATUS",
  OPEN_LOGIN: "OPEN_LOGIN",
  SYNC_TOKEN_FROM_APP: "SYNC_TOKEN_FROM_APP",
  FETCH_VAULT_FOR_ACTIVE_TAB: "FETCH_VAULT_FOR_ACTIVE_TAB",
  PERFORM_AUTOFILL: "PERFORM_AUTOFILL",
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
  el.status.className = `status ${type}`;
}

function setLoading(isLoading) {
  state.isLoading = isLoading;
  el.loading.classList.toggle("hidden", !isLoading);
  el.autofillBtn.disabled = isLoading;
  el.refreshBtn.disabled = isLoading;
  el.loginBtn.disabled = isLoading;
  el.syncBtn.disabled = isLoading;
  el.neverBtn.disabled = isLoading;
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
  showSection(null);
  setStatus(statusMessage, "warn");

  if (!state.autoLoginOpened) {
    state.autoLoginOpened = true;
    try {
      await openLogin();
    } catch {
      // No-op
    }
  }
}

async function loadPopupData() {
  setLoading(true);
  showSection(null);
  showLoginButton(false);
  showSyncButton(false);

  try {
    const context = await sendMessage({ type: MESSAGE.GET_ACTIVE_CONTEXT });

    if (!context.ok) {
      state.domain = "";
      state.blocked = false;
      el.domainValue.textContent = "-";
      showNeverButton(false);
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
      showSection(null);
      setStatus(msg, "warn");
      return;
    }

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
}

document.addEventListener("DOMContentLoaded", async () => {
  bindEvents();
  await loadPopupData();
});
