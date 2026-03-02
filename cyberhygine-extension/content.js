(() => {
  if (window.__CYBERHYGIENE_CONTENT_READY__) return;
  window.__CYBERHYGIENE_CONTENT_READY__ = true;

  const TRUSTED_APP_ORIGINS = new Set(["http://localhost:3000", "https://localhost:3000"]);
  const CAPTURE_DEBOUNCE_MS = 8000;
  let lastCaptureKey = "";
  let lastCaptureAt = 0;

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

  function normalizeString(value, maxLen = 4096) {
    if (typeof value !== "string") return "";
    const trimmed = value.trim();
    return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
  }

  function getBaseDomainFromHostname(hostnameInput) {
    let hostname = normalizeString(hostnameInput).toLowerCase();
    if (!hostname) return "";
    hostname = hostname.replace(/\.+$/, "");
    if (!hostname) return "";

    const isIPv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
    if (hostname === "localhost" || isIPv4 || hostname.includes(":")) {
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

  function getCurrentBaseDomain() {
    try {
      return getBaseDomainFromHostname(window.location.hostname);
    } catch {
      return "";
    }
  }

  function isVisibleInput(el) {
    if (!(el instanceof HTMLInputElement)) return false;
    if (el.disabled || el.readOnly) return false;

    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (style.opacity === "0") return false;
    if (el.offsetWidth === 0 && el.offsetHeight === 0) return false;
    return true;
  }

  function setInputValue(input, value) {
    const prototype = Object.getPrototypeOf(input);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");

    if (descriptor && typeof descriptor.set === "function") {
      descriptor.set.call(input, value);
    } else {
      input.value = value;
    }

    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function findPasswordInput(root) {
    const candidates = Array.from(
      root.querySelectorAll('input[type="password"]')
    ).filter(isVisibleInput);

    if (candidates.length === 0) return null;

    const scored = candidates.map((el) => {
      const autocomplete = normalizeString(el.autocomplete).toLowerCase();
      let score = 0;
      if (autocomplete.includes("current-password")) score += 120;
      if (autocomplete.includes("password")) score += 80;
      if (autocomplete.includes("new-password")) score -= 80;
      if (el.form) score += 10;
      return { el, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored[0].el;
  }

  function scoreUsernameInput(input, allInputs, passwordInput) {
    const type = normalizeString(input.type).toLowerCase();
    const name = normalizeString(input.name).toLowerCase();
    const id = normalizeString(input.id).toLowerCase();
    const auto = normalizeString(input.autocomplete).toLowerCase();
    const placeholder = normalizeString(input.placeholder).toLowerCase();

    let score = 0;
    if (type === "email") score += 140;
    if (type === "text" || type === "" || type === "search") score += 50;
    if (type === "tel" || type === "url") score += 20;

    if (auto.includes("username")) score += 130;
    if (auto.includes("email")) score += 120;

    if (/user|login|email|identifier|account/.test(name)) score += 100;
    if (/user|login|email|identifier|account/.test(id)) score += 90;
    if (/user|login|email/.test(placeholder)) score += 70;

    if (
      type === "password" ||
      type === "hidden" ||
      type === "checkbox" ||
      type === "radio" ||
      type === "submit" ||
      type === "button"
    ) {
      score -= 300;
    }

    const pIndex = allInputs.indexOf(passwordInput);
    const iIndex = allInputs.indexOf(input);
    if (pIndex >= 0 && iIndex >= 0) {
      const distance = Math.abs(pIndex - iIndex);
      score += Math.max(0, 60 - distance);
    }

    return score;
  }

  function findUsernameInput(passwordInput) {
    const scope = passwordInput.form || document;
    const allInputs = Array.from(scope.querySelectorAll("input")).filter(
      isVisibleInput
    );

    const candidates = allInputs
      .filter((el) => el !== passwordInput)
      .map((el) => ({
        el,
        score: scoreUsernameInput(el, allInputs, passwordInput)
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);

    return candidates.length > 0 ? candidates[0].el : null;
  }

  function isHttpPage() {
    return window.location.protocol === "http:" || window.location.protocol === "https:";
  }

  function isLikelyNewPasswordField(input) {
    const auto = normalizeString(input.autocomplete).toLowerCase();
    const name = normalizeString(input.name).toLowerCase();
    const id = normalizeString(input.id).toLowerCase();
    const placeholder = normalizeString(input.placeholder).toLowerCase();
    const hint = `${auto} ${name} ${id} ${placeholder}`;
    return /new-password|confirm|repeat|otp|one.?time|verification|reset|create|signup|register/.test(
      hint
    );
  }

  function extractSubmittedLoginCredential(form) {
    const scope = form instanceof HTMLFormElement ? form : document;
    const passwordInput = findPasswordInput(scope);
    if (!passwordInput) return null;

    if (isLikelyNewPasswordField(passwordInput)) return null;

    const allPasswordInputs = Array.from(
      scope.querySelectorAll('input[type="password"]')
    ).filter(isVisibleInput);
    if (allPasswordInputs.length > 1 && allPasswordInputs.some(isLikelyNewPasswordField)) {
      return null;
    }

    const usernameInput = findUsernameInput(passwordInput);
    const username = normalizeString(usernameInput && usernameInput.value, 1024);
    const password = normalizeString(passwordInput.value, 4096);

    if (!username || !password) return null;

    return {
      username,
      password
    };
  }

  function shouldSkipRecentCapture(domain, username, password) {
    const key = `${domain}|${username}|${password}`;
    const now = Date.now();
    if (lastCaptureKey === key && now - lastCaptureAt < CAPTURE_DEBOUNCE_MS) {
      return true;
    }
    lastCaptureKey = key;
    lastCaptureAt = now;
    return false;
  }

  function sendCapturedCredential(payload) {
    try {
      chrome.runtime.sendMessage(
        {
          type: "CAPTURE_LOGIN_CREDENTIAL",
          domain: payload.domain,
          site: payload.site,
          username: payload.username,
          password: payload.password
        },
        () => {
          void chrome.runtime.lastError;
        }
      );
    } catch {
      // no-op
    }
  }

  function onFormSubmit(event) {
    if (!isHttpPage()) return;
    if (isTrustedAppOrigin()) return;

    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form) return;

    const credential = extractSubmittedLoginCredential(form);
    if (!credential) return;

    const domain = getCurrentBaseDomain();
    if (!domain) return;

    if (shouldSkipRecentCapture(domain, credential.username, credential.password)) {
      return;
    }

    sendCapturedCredential({
      domain,
      site: window.location.hostname || domain,
      username: credential.username,
      password: credential.password
    });
  }

  function isTrustedAppOrigin() {
    try {
      return TRUSTED_APP_ORIGINS.has(window.location.origin.toLowerCase());
    } catch {
      return false;
    }
  }

  function readAppTokenFromLocalStorage() {
    if (!isTrustedAppOrigin()) {
      return { ok: false, code: "FORBIDDEN_ORIGIN", message: "Not a trusted app origin." };
    }

    try {
      const token = normalizeString(window.localStorage.getItem("token") || "", 4096);
      if (!token) {
        return { ok: false, code: "TOKEN_NOT_FOUND", message: "No login token found in app." };
      }
      return { ok: true, code: "OK", token };
    } catch {
      return { ok: false, code: "TOKEN_READ_ERROR", message: "Could not read app token." };
    }
  }

  function base64UrlToArrayBuffer(base64url) {
    const value = normalizeString(base64url, 8192).replace(/-/g, "+").replace(/_/g, "/");
    const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  function arrayBufferToBase64Url(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function toRequestOptions(optionsJSON) {
    return {
      ...optionsJSON,
      challenge: base64UrlToArrayBuffer(optionsJSON.challenge),
      allowCredentials: (optionsJSON.allowCredentials || []).map((cred) => ({
        ...cred,
        id: base64UrlToArrayBuffer(cred.id)
      }))
    };
  }

  function serializeAuthenticationCredential(credential) {
    const response = credential.response;
    return {
      id: credential.id,
      rawId: arrayBufferToBase64Url(credential.rawId),
      type: credential.type,
      response: {
        clientDataJSON: arrayBufferToBase64Url(response.clientDataJSON),
        authenticatorData: arrayBufferToBase64Url(response.authenticatorData),
        signature: arrayBufferToBase64Url(response.signature),
        userHandle: response.userHandle ? arrayBufferToBase64Url(response.userHandle) : null
      }
    };
  }

  async function performBiometricGate() {
    if (!isTrustedAppOrigin()) {
      return { ok: false, code: "FORBIDDEN_ORIGIN", message: "Biometric check is allowed only on Cyber Hygiene app." };
    }

    if (!window.PublicKeyCredential || !navigator.credentials) {
      return { ok: false, code: "WEBAUTHN_UNSUPPORTED", message: "This browser does not support biometric verification." };
    }

    const authEndpoints = [
      {
        options: "http://localhost:9000/api/fingerprints/login/options",
        verify: "http://localhost:9000/api/fingerprints/login/verify"
      },
      {
        options: "http://localhost:9000/api/passkeys/login/options",
        verify: "http://localhost:9000/api/passkeys/login/verify"
      }
    ];

    let lastError = "Biometric verification failed.";

    for (const endpoint of authEndpoints) {
      try {
        const optionsRes = await fetch(endpoint.options, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store"
        });

        if (!optionsRes.ok) {
          if (optionsRes.status === 404) {
            continue;
          }
          lastError = "Could not start biometric verification.";
          continue;
        }

        const optionsData = await optionsRes.json();
        const requestOptions = toRequestOptions(optionsData.options || {});

        if (navigator.credentials && typeof navigator.credentials.preventSilentAccess === "function") {
          try {
            await navigator.credentials.preventSilentAccess();
          } catch {
            // no-op
          }
        }

        const credential = await navigator.credentials.get({
          publicKey: requestOptions,
          mediation: "required"
        });

        if (!credential) {
          return { ok: false, code: "BIOMETRIC_CANCELLED", message: "Biometric verification cancelled." };
        }

        const verifyRes = await fetch(endpoint.verify, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            attempt_id: optionsData.attempt_id,
            credential: serializeAuthenticationCredential(credential)
          })
        });

        if (!verifyRes.ok) {
          if (verifyRes.status === 404) {
            continue;
          }

          let detail = "Biometric verification failed.";
          try {
            const err = await verifyRes.json();
            if (err && typeof err.detail === "string" && err.detail.trim()) {
              detail = err.detail.trim();
            }
          } catch {
            // no-op
          }
          return { ok: false, code: "VERIFY_FAILED", message: detail };
        }

        const verifyData = await verifyRes.json();
        if (!verifyData || !verifyData.success) {
          lastError = "Biometric verification failed.";
          continue;
        }

        const token = normalizeString(verifyData.token || "", 4096);
        return { ok: true, code: "OK", token };
      } catch {
        lastError = "Biometric verification failed.";
      }
    }

    return { ok: false, code: "BIOMETRIC_ERROR", message: lastError };
  }

  function autofill(payload) {
    const domain = normalizeString(payload && payload.domain, 512);
    const username = normalizeString(payload && payload.username, 2048);
    const password = normalizeString(payload && payload.password, 2048);

    if (!domain || !username || !password) {
      return {
        ok: false,
        code: "INVALID_PAYLOAD",
        message: "Invalid autofill payload."
      };
    }

    const currentDomain = getCurrentBaseDomain();
    if (!currentDomain || currentDomain !== domain) {
      return {
        ok: false,
        code: "DOMAIN_MISMATCH",
        message: "Domain mismatch. Autofill blocked."
      };
    }

    const passwordInput = findPasswordInput(document);
    if (!passwordInput) {
      return {
        ok: false,
        code: "NO_PASSWORD_FIELD",
        message: "Password field not found."
      };
    }

    const usernameInput = findUsernameInput(passwordInput);

    if (usernameInput) {
      setInputValue(usernameInput, username);
    }

    setInputValue(passwordInput, password);
    passwordInput.focus();

    if (!usernameInput) {
      return {
        ok: true,
        code: "PASSWORD_ONLY_FILLED",
        message: "Password filled. Username/email field not found."
      };
    }

    return {
      ok: true,
      code: "AUTOFILL_SUCCESS",
      message: "Credentials autofilled successfully."
    };
  }

  document.addEventListener("submit", onFormSubmit, true);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) return;

    if (message.type === "CYBERHYGIENE_READ_APP_TOKEN") {
      sendResponse(readAppTokenFromLocalStorage());
      return true;
    }

    if (message.type === "CYBERHYGIENE_BIOMETRIC_GATE") {
      performBiometricGate().then(sendResponse).catch(() => {
        sendResponse({ ok: false, code: "BIOMETRIC_ERROR", message: "Biometric verification failed." });
      });
      return true;
    }

    if (message.type !== "CYBERHYGIENE_AUTOFILL") return;

    try {
      const result = autofill(message.payload);
      sendResponse(result);
    } catch {
      sendResponse({
        ok: false,
        code: "AUTOFILL_ERROR",
        message: "Failed to autofill this page."
      });
    }

    return true;
  });
})();
