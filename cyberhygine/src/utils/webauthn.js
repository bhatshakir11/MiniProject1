import axios from "axios";
import apiClient from "../apiClient";
import API_BASE_URL from "../config";

function base64UrlToArrayBuffer(base64url) {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
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

function toCreationOptions(optionsJSON) {
  return {
    ...optionsJSON,
    challenge: base64UrlToArrayBuffer(optionsJSON.challenge),
    user: {
      ...optionsJSON.user,
      id: base64UrlToArrayBuffer(optionsJSON.user.id),
    },
    excludeCredentials: (optionsJSON.excludeCredentials || []).map((cred) => ({
      ...cred,
      id: base64UrlToArrayBuffer(cred.id),
    })),
  };
}

function toRequestOptions(optionsJSON) {
  const allowCredentials = optionsJSON.allowCredentials || [];
  return {
    ...optionsJSON,
    challenge: base64UrlToArrayBuffer(optionsJSON.challenge),
    allowCredentials: allowCredentials.map((cred) => ({
      ...cred,
      id: base64UrlToArrayBuffer(cred.id),
    })),
  };
}

function serializeRegistrationCredential(credential) {
  const response = credential.response;
  const publicKey = response.getPublicKey?.();
  const authenticatorData = response.getAuthenticatorData?.();

  if (!publicKey || !authenticatorData) {
    throw new Error("Your browser does not support fingerprint registration here. Please update browser.");
  }

  return {
    id: credential.id,
    rawId: arrayBufferToBase64Url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: arrayBufferToBase64Url(response.clientDataJSON),
      attestationObject: arrayBufferToBase64Url(response.attestationObject),
      authenticatorData: arrayBufferToBase64Url(authenticatorData),
      publicKey: arrayBufferToBase64Url(publicKey),
      transports: response.getTransports?.() || [],
    },
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
      userHandle: response.userHandle
        ? arrayBufferToBase64Url(response.userHandle)
        : null,
    },
  };
}

export function supportsWebAuthn() {
  return typeof window !== "undefined" && !!window.PublicKeyCredential && !!navigator.credentials;
}

export async function registerFingerprint() {
  const optionsRes = await apiClient.post("/fingerprints/register/options");
  const publicKey = toCreationOptions(optionsRes.data.options);
  const credential = await navigator.credentials.create({ publicKey });
  if (!credential) {
    throw new Error("Fingerprint registration was cancelled.");
  }
  const verifyRes = await apiClient.post("/fingerprints/register/verify", {
    credential: serializeRegistrationCredential(credential),
  });
  return verifyRes.data;
}

export async function loginWithFingerprint() {
  const optionsRes = await axios.post(`${API_BASE_URL}/fingerprints/login/options`);
  const publicKey = toRequestOptions(optionsRes.data.options);
  const credential = await navigator.credentials.get({ publicKey });
  if (!credential) {
    throw new Error("Fingerprint login was cancelled.");
  }
  const verifyRes = await axios.post(`${API_BASE_URL}/fingerprints/login/verify`, {
    attempt_id: optionsRes.data.attempt_id,
    credential: serializeAuthenticationCredential(credential),
  });
  return verifyRes.data;
}
