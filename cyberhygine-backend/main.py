


from datetime import datetime, timedelta, timezone
import base64
import hashlib
import json
import os
import secrets
import sqlite3
import time
from urllib.parse import urlparse

import bcrypt
import jwt
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec, ed25519, padding, rsa
from cryptography.hazmat.primitives.serialization import load_der_public_key
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel
from jwt import InvalidTokenError

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

JWT_SECRET = os.getenv("JWT_SECRET")
if not JWT_SECRET:
    JWT_SECRET = os.urandom(32).hex()
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60
auth_scheme = HTTPBearer(auto_error=False)
WEBAUTHN_RP_ID = os.getenv("WEBAUTHN_RP_ID", "localhost")
WEBAUTHN_RP_NAME = os.getenv("WEBAUTHN_RP_NAME", "Cyber Hygiene Vault")
WEBAUTHN_ORIGIN = os.getenv("WEBAUTHN_ORIGIN", "http://localhost:3000")
WEBAUTHN_CHALLENGE_TTL_SECONDS = 300
webauthn_challenges = {}
DB_PATH = os.path.join(os.path.dirname(__file__), "users.db")

SECOND_LEVEL_SUFFIXES = {
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
    "com.sg",
}


def b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def open_db() -> sqlite3.Connection:
    return sqlite3.connect(DB_PATH)


def b64url_decode(data: str) -> bytes:
    padding_size = (4 - len(data) % 4) % 4
    return base64.urlsafe_b64decode(data + ("=" * padding_size))


def normalize_domain_input(value: str) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip().lower().rstrip(".")


def extract_hostname(value: str) -> str:
    raw = normalize_domain_input(value)
    if not raw:
        return ""

    try:
        if "://" not in raw:
            parsed = urlparse(f"https://{raw}")
        else:
            parsed = urlparse(raw)
        return normalize_domain_input(parsed.hostname or "")
    except Exception:
        return ""


def get_base_domain_from_hostname(hostname: str) -> str:
    host = normalize_domain_input(hostname)
    if not host:
        return ""

    if host == "localhost":
        return host

    ipv4_parts = host.split(".")
    if len(ipv4_parts) == 4 and all(p.isdigit() and 0 <= int(p) <= 255 for p in ipv4_parts):
        return host

    parts = host.split(".")
    if len(parts) <= 2:
        return host

    last2 = ".".join(parts[-2:])
    if last2 in SECOND_LEVEL_SUFFIXES and len(parts) >= 3:
        return ".".join(parts[-3:])

    return last2


def get_base_domain(value: str) -> str:
    hostname = extract_hostname(value)
    return get_base_domain_from_hostname(hostname)


def new_webauthn_challenge() -> str:
    return b64url_encode(secrets.token_bytes(32))


def store_webauthn_challenge(key: str, challenge: str) -> None:
    cleanup_webauthn_challenges()
    webauthn_challenges[key] = {
        "challenge": challenge,
        "expires_at": time.time() + WEBAUTHN_CHALLENGE_TTL_SECONDS,
    }


def pop_webauthn_challenge(key: str) -> str | None:
    cleanup_webauthn_challenges()
    value = webauthn_challenges.pop(key, None)
    if not value:
        return None
    return value["challenge"]


def cleanup_webauthn_challenges() -> None:
    now = time.time()
    expired_keys = [
        key for key, value in webauthn_challenges.items() if value["expires_at"] < now
    ]
    for key in expired_keys:
        webauthn_challenges.pop(key, None)


def parse_authenticator_data(authenticator_data: bytes) -> dict:
    if len(authenticator_data) < 37:
        raise HTTPException(status_code=400, detail="Invalid authenticator data")
    return {
        "rp_id_hash": authenticator_data[:32],
        "flags": authenticator_data[32],
        "sign_count": int.from_bytes(authenticator_data[33:37], "big"),
    }


def require_webauthn_flags(flags: int, require_uv: bool = True) -> None:
    user_present = bool(flags & 0x01)
    user_verified = bool(flags & 0x04)
    if not user_present:
        raise HTTPException(status_code=400, detail="Authenticator did not confirm user presence")
    if require_uv and not user_verified:
        raise HTTPException(status_code=400, detail="Biometric/user verification is required")


def verify_client_data(
    client_data_json_b64: str,
    expected_type: str,
    expected_challenge: str,
) -> bytes:
    try:
        client_data_json = b64url_decode(client_data_json_b64)
        client_data = json.loads(client_data_json.decode("utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid clientDataJSON") from exc

    if client_data.get("type") != expected_type:
        raise HTTPException(status_code=400, detail="Invalid WebAuthn operation type")
    if client_data.get("challenge") != expected_challenge:
        raise HTTPException(status_code=400, detail="Invalid or expired challenge")
    origin = str(client_data.get("origin", "")).rstrip("/")
    if origin != WEBAUTHN_ORIGIN.rstrip("/"):
        raise HTTPException(status_code=400, detail="Invalid origin")
    return client_data_json


def verify_rp_id_hash(parsed_authenticator_data: dict) -> None:
    expected_rp_hash = hashlib.sha256(WEBAUTHN_RP_ID.encode("utf-8")).digest()
    if parsed_authenticator_data["rp_id_hash"] != expected_rp_hash:
        raise HTTPException(status_code=400, detail="Invalid RP ID hash")


def verify_assertion_signature(
    public_key_spki_b64: str,
    authenticator_data: bytes,
    client_data_json: bytes,
    signature: bytes,
) -> None:
    signed_data = authenticator_data + hashlib.sha256(client_data_json).digest()
    public_key = load_der_public_key(b64url_decode(public_key_spki_b64))

    try:
        if isinstance(public_key, ec.EllipticCurvePublicKey):
            public_key.verify(signature, signed_data, ec.ECDSA(hashes.SHA256()))
        elif isinstance(public_key, rsa.RSAPublicKey):
            public_key.verify(signature, signed_data, padding.PKCS1v15(), hashes.SHA256())
        elif isinstance(public_key, ed25519.Ed25519PublicKey):
            public_key.verify(signature, signed_data)
        else:
            raise HTTPException(status_code=400, detail="Unsupported fingerprint authenticator type")
    except InvalidSignature as exc:
        raise HTTPException(status_code=401, detail="Invalid fingerprint signature") from exc


def ensure_webauthn_table() -> None:
    conn = open_db()
    conn.execute(
        """CREATE TABLE IF NOT EXISTS webauthn_credentials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        credential_id TEXT UNIQUE NOT NULL,
        public_key_spki TEXT NOT NULL,
        sign_count INTEGER NOT NULL DEFAULT 0,
        transports TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )"""
    )
    conn.close()


def create_access_token(user_id: int) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)).timestamp()),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def get_current_user_id(
    credentials: HTTPAuthorizationCredentials = Depends(auth_scheme),
) -> int:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    subject = payload.get("sub")
    if subject is None:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    try:
        return int(subject)
    except (TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid token payload")

# --- Notes Support ---
class Note(BaseModel):
    title: str
    content: str

def ensure_notes_table():
    conn = open_db()
    conn.execute("""CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )""")
    conn.close()

@app.post("/api/notes")
def add_note(note: Note, user_id: int = Depends(get_current_user_id)):
    ensure_notes_table()
    conn = open_db()
    cursor = conn.cursor()
    cursor.execute("INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)", (user_id, note.title, note.content))
    conn.commit()
    conn.close()
    return {"success": True}

@app.get("/api/notes")
def get_notes(user_id: int = Depends(get_current_user_id)):
    ensure_notes_table()
    conn = open_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id, title, content FROM notes WHERE user_id = ?", (user_id,))
    rows = cursor.fetchall()
    conn.close()
    return [{"id": r[0], "title": r[1], "content": r[2]} for r in rows]


class Credential(BaseModel):
    site: str
    username: str
    password: str
    strength: str

# Update credential
@app.put("/api/credentials/{cred_id}")
def update_credential(
    cred_id: int, cred: Credential, user_id: int = Depends(get_current_user_id)
):
    conn = get_cred_db()
    cursor = conn.cursor()
    cursor.execute("""
        UPDATE credentials
        SET site = ?, username = ?, password = ?, strength = ?
        WHERE id = ? AND user_id = ?
    """, (cred.site, cred.username, cred.password, cred.strength, cred_id, user_id))
    conn.commit()
    affected = cursor.rowcount
    conn.close()
    if affected == 0:
        raise HTTPException(status_code=404, detail="Credential not found")
    return {"success": True}

def get_cred_db():
    conn = open_db()
    conn.execute("""CREATE TABLE IF NOT EXISTS credentials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        site TEXT NOT NULL,
        username TEXT NOT NULL,
        password TEXT NOT NULL,
        strength TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )""")
    return conn

# Add credential
@app.post("/api/credentials")
def add_credential(cred: Credential, user_id: int = Depends(get_current_user_id)):
    conn = get_cred_db()
    cursor = conn.cursor()
    cursor.execute("INSERT INTO credentials (user_id, site, username, password, strength) VALUES (?, ?, ?, ?, ?)",
                   (user_id, cred.site, cred.username, cred.password, cred.strength))
    conn.commit()
    conn.close()
    return {"success": True}

# Get all credentials
@app.get("/api/credentials")
def get_credentials(user_id: int = Depends(get_current_user_id)):
    conn = get_cred_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id, site, username, password, strength FROM credentials WHERE user_id = ?", (user_id,))
    rows = cursor.fetchall()
    conn.close()
    return [{"id": r[0], "site": r[1], "username": r[2], "password": r[3], "strength": r[4]} for r in rows]

# Delete credential
@app.get("/api/vault")
def get_vault_by_domain(domain: str, user_id: int = Depends(get_current_user_id)):
    requested_domain = get_base_domain(domain)
    if not requested_domain:
        raise HTTPException(status_code=400, detail="Invalid domain")

    conn = get_cred_db()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT id, site, username, password FROM credentials WHERE user_id = ?",
        (user_id,),
    )
    rows = cursor.fetchall()
    conn.close()

    credentials = []
    for cred_id, site, username, password in rows:
        site_domain = get_base_domain(site)
        if site_domain != requested_domain:
            continue

        credentials.append(
            {
                "id": str(cred_id),
                "domain": requested_domain,
                "site": site,
                "username": username,
                "password": password,
            }
        )

    return {
        "domain": requested_domain,
        "credentials": credentials,
    }


@app.delete("/api/credentials/{cred_id}")
def delete_credential(cred_id: int, user_id: int = Depends(get_current_user_id)):
    conn = get_cred_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM credentials WHERE id = ? AND user_id = ?", (cred_id, user_id))
    conn.commit()
    affected = cursor.rowcount
    conn.close()
    if affected == 0:
        raise HTTPException(status_code=404, detail="Credential not found")
    return {"success": True}

# Dashboard stats
@app.get("/api/dashboard")
def dashboard_stats(user_id: int = Depends(get_current_user_id)):
    conn = get_cred_db()
    cursor = conn.cursor()
    # Password strength stats
    cursor.execute("SELECT strength, COUNT(*) FROM credentials WHERE user_id = ? GROUP BY strength", (user_id,))
    strength_counts = {row[0]: row[1] for row in cursor.fetchall()}
    strong = strength_counts.get("strong", 0)
    weak = strength_counts.get("weak", 0)
    medium = strength_counts.get("medium", 0)
    total = strong + weak + medium
    score = int((strong / total) * 100) if total > 0 else 0

    # Reused vs Unique passwords
    cursor.execute("SELECT password, COUNT(*) as cnt FROM credentials WHERE user_id = ? GROUP BY password", (user_id,))
    reused = 0
    unique = 0
    for row in cursor.fetchall():
        if row[1] > 1:
            reused += row[1]
        else:
            unique += 1
    conn.close()
    return {
        "strong": strong,
        "weak": weak,
        "medium": medium,
        "score": score,
        "reused": reused,
        "unique": unique
    }

def get_db():
    conn = open_db()
    conn.execute("""CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL
    )""")
    return conn

class UserRegister(BaseModel):
    username: str
    password: str

class UserLogin(BaseModel):
    username: str
    password: str


class FingerprintVerifyRequest(BaseModel):
    credential: dict


class FingerprintLoginVerifyRequest(BaseModel):
    attempt_id: str
    credential: dict


@app.get("/api/passkeys/status")
def passkey_status(user_id: int = Depends(get_current_user_id)):
    ensure_webauthn_table()
    conn = open_db()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT COUNT(*) FROM webauthn_credentials WHERE user_id = ?",
        (user_id,),
    )
    count = cursor.fetchone()[0]
    conn.close()
    has_fingerprint = count > 0
    return {
        "has_fingerprint": has_fingerprint,
        "fingerprint_count": count,
        "has_passkey": has_fingerprint,
        "passkey_count": count,
    }


@app.get("/api/passkeys")
def list_passkeys(user_id: int = Depends(get_current_user_id)):
    ensure_webauthn_table()
    conn = open_db()
    cursor = conn.cursor()
    cursor.execute(
        """SELECT credential_id, sign_count, transports, created_at
        FROM webauthn_credentials
        WHERE user_id = ?
        ORDER BY created_at DESC, id DESC""",
        (user_id,),
    )
    rows = cursor.fetchall()
    conn.close()

    passkeys = []
    for credential_id, sign_count, transports, created_at in rows:
        try:
            parsed_transports = json.loads(transports) if transports else []
        except json.JSONDecodeError:
            parsed_transports = []
        passkeys.append(
            {
                "credential_id": credential_id,
                "display_id": f"{credential_id[:10]}...{credential_id[-6:]}"
                if len(credential_id) > 18
                else credential_id,
                "sign_count": sign_count,
                "transports": parsed_transports if isinstance(parsed_transports, list) else [],
                "created_at": created_at,
            }
        )
    return {"fingerprints": passkeys, "passkeys": passkeys}


@app.delete("/api/passkeys/{credential_id}")
def delete_passkey(
    credential_id: str, user_id: int = Depends(get_current_user_id)
):
    ensure_webauthn_table()
    conn = open_db()
    cursor = conn.cursor()
    cursor.execute(
        "DELETE FROM webauthn_credentials WHERE credential_id = ? AND user_id = ?",
        (credential_id, user_id),
    )
    conn.commit()
    affected = cursor.rowcount
    conn.close()
    if affected == 0:
        raise HTTPException(status_code=404, detail="Fingerprint not found")
    return {"success": True}


@app.post("/api/passkeys/register/options")
def passkey_register_options(user_id: int = Depends(get_current_user_id)):
    ensure_webauthn_table()
    conn = open_db()
    cursor = conn.cursor()
    cursor.execute("SELECT username FROM users WHERE id = ?", (user_id,))
    user_row = cursor.fetchone()
    if not user_row:
        conn.close()
        raise HTTPException(status_code=404, detail="User not found")

    cursor.execute(
        "SELECT credential_id, transports FROM webauthn_credentials WHERE user_id = ?",
        (user_id,),
    )
    existing = cursor.fetchall()
    conn.close()

    challenge = new_webauthn_challenge()
    store_webauthn_challenge(f"register:{user_id}", challenge)

    exclude_credentials = []
    for credential_id, transports in existing:
        descriptor = {"type": "public-key", "id": credential_id}
        if transports:
            try:
                parsed_transports = json.loads(transports)
                if isinstance(parsed_transports, list):
                    descriptor["transports"] = parsed_transports
            except json.JSONDecodeError:
                pass
        exclude_credentials.append(descriptor)

    options = {
        "challenge": challenge,
        "rp": {"name": WEBAUTHN_RP_NAME, "id": WEBAUTHN_RP_ID},
        "user": {
            "id": b64url_encode(str(user_id).encode("utf-8")),
            "name": user_row[0],
            "displayName": user_row[0],
        },
        "pubKeyCredParams": [
            {"type": "public-key", "alg": -7},
            {"type": "public-key", "alg": -257},
        ],
        "timeout": 60000,
        "attestation": "none",
        "excludeCredentials": exclude_credentials,
        "authenticatorSelection": {
            "authenticatorAttachment": "platform",
            "residentKey": "required",
            "userVerification": "required",
        },
    }
    return {"options": options}


@app.post("/api/passkeys/register/verify")
def passkey_register_verify(
    request: FingerprintVerifyRequest, user_id: int = Depends(get_current_user_id)
):
    ensure_webauthn_table()
    expected_challenge = pop_webauthn_challenge(f"register:{user_id}")
    if not expected_challenge:
        raise HTTPException(status_code=400, detail="Registration challenge expired")

    credential = request.credential or {}
    response = credential.get("response") or {}
    credential_id = credential.get("id")
    client_data_json_b64 = response.get("clientDataJSON")
    authenticator_data_b64 = response.get("authenticatorData")
    public_key_b64 = response.get("publicKey")

    if not credential_id or not client_data_json_b64 or not authenticator_data_b64 or not public_key_b64:
        raise HTTPException(status_code=400, detail="Incomplete WebAuthn registration payload")

    client_data_json = verify_client_data(
        client_data_json_b64, expected_type="webauthn.create", expected_challenge=expected_challenge
    )
    _ = client_data_json

    authenticator_data = b64url_decode(authenticator_data_b64)
    parsed_auth_data = parse_authenticator_data(authenticator_data)
    verify_rp_id_hash(parsed_auth_data)
    require_webauthn_flags(parsed_auth_data["flags"], require_uv=True)

    transports = response.get("transports") or []
    transports_json = json.dumps(transports if isinstance(transports, list) else [])

    conn = open_db()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT user_id FROM webauthn_credentials WHERE credential_id = ?",
        (credential_id,),
    )
    existing = cursor.fetchone()
    if existing and existing[0] != user_id:
        conn.close()
        raise HTTPException(status_code=409, detail="This fingerprint is already linked to another user")

    if existing:
        cursor.execute(
            """UPDATE webauthn_credentials
            SET public_key_spki = ?, sign_count = ?, transports = ?
            WHERE credential_id = ?""",
            (public_key_b64, parsed_auth_data["sign_count"], transports_json, credential_id),
        )
    else:
        cursor.execute(
            """INSERT INTO webauthn_credentials
            (user_id, credential_id, public_key_spki, sign_count, transports)
            VALUES (?, ?, ?, ?, ?)""",
            (user_id, credential_id, public_key_b64, parsed_auth_data["sign_count"], transports_json),
        )
    conn.commit()
    conn.close()

    return {"success": True, "message": "Fingerprint registered successfully"}


@app.post("/api/passkeys/login/options")
def passkey_login_options():
    ensure_webauthn_table()
    challenge = new_webauthn_challenge()
    attempt_id = secrets.token_urlsafe(18)
    store_webauthn_challenge(f"login:{attempt_id}", challenge)
    options = {
        "challenge": challenge,
        "rpId": WEBAUTHN_RP_ID,
        "timeout": 60000,
        "userVerification": "required",
    }
    return {"options": options, "attempt_id": attempt_id}


@app.post("/api/passkeys/login/verify")
def passkey_login_verify(request: FingerprintLoginVerifyRequest):
    ensure_webauthn_table()
    expected_challenge = pop_webauthn_challenge(f"login:{request.attempt_id}")
    if not expected_challenge:
        raise HTTPException(status_code=400, detail="Login challenge expired")

    credential = request.credential or {}
    response = credential.get("response") or {}
    credential_id = credential.get("id")
    client_data_json_b64 = response.get("clientDataJSON")
    authenticator_data_b64 = response.get("authenticatorData")
    signature_b64 = response.get("signature")

    if not credential_id or not client_data_json_b64 or not authenticator_data_b64 or not signature_b64:
        raise HTTPException(status_code=400, detail="Incomplete WebAuthn authentication payload")

    client_data_json = verify_client_data(
        client_data_json_b64, expected_type="webauthn.get", expected_challenge=expected_challenge
    )

    authenticator_data = b64url_decode(authenticator_data_b64)
    signature = b64url_decode(signature_b64)
    parsed_auth_data = parse_authenticator_data(authenticator_data)
    verify_rp_id_hash(parsed_auth_data)
    require_webauthn_flags(parsed_auth_data["flags"], require_uv=True)

    conn = open_db()
    cursor = conn.cursor()
    cursor.execute(
        """SELECT user_id, public_key_spki, sign_count
        FROM webauthn_credentials
        WHERE credential_id = ?""",
        (credential_id,),
    )
    row = cursor.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=401, detail="Fingerprint not recognized")

    user_id, public_key_spki, current_sign_count = row
    verify_assertion_signature(public_key_spki, authenticator_data, client_data_json, signature)

    new_sign_count = parsed_auth_data["sign_count"]
    if new_sign_count and current_sign_count and new_sign_count <= current_sign_count:
        conn.close()
        raise HTTPException(status_code=401, detail="Fingerprint sign counter validation failed")

    cursor.execute(
        "UPDATE webauthn_credentials SET sign_count = ? WHERE credential_id = ?",
        (new_sign_count, credential_id),
    )
    conn.commit()
    conn.close()

    return {"success": True, "token": create_access_token(user_id)}


@app.get("/api/fingerprints/status")
def fingerprint_status(user_id: int = Depends(get_current_user_id)):
    result = passkey_status(user_id)
    return {
        "has_fingerprint": result.get("has_fingerprint", False),
        "fingerprint_count": result.get("fingerprint_count", 0),
    }


@app.get("/api/fingerprints")
def list_fingerprints(user_id: int = Depends(get_current_user_id)):
    result = list_passkeys(user_id)
    return {"fingerprints": result.get("fingerprints", result.get("passkeys", []))}


@app.delete("/api/fingerprints/{credential_id}")
def delete_fingerprint(
    credential_id: str, user_id: int = Depends(get_current_user_id)
):
    return delete_passkey(credential_id, user_id)


@app.post("/api/fingerprints/register/options")
def fingerprint_register_options(user_id: int = Depends(get_current_user_id)):
    return passkey_register_options(user_id)


@app.post("/api/fingerprints/register/verify")
def fingerprint_register_verify(
    request: FingerprintVerifyRequest, user_id: int = Depends(get_current_user_id)
):
    return passkey_register_verify(request, user_id)


@app.post("/api/fingerprints/login/options")
def fingerprint_login_options():
    return passkey_login_options()


@app.post("/api/fingerprints/login/verify")
def fingerprint_login_verify(request: FingerprintLoginVerifyRequest):
    return passkey_login_verify(request)


@app.post("/api/register")
def register(user: UserRegister):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE username=?", (user.username,))
    if cursor.fetchone():
        conn.close()
        return {"success": False, "message": "Username already exists"}
    hashed = bcrypt.hashpw(user.password.encode(), bcrypt.gensalt())
    cursor.execute("INSERT INTO users (username, password_hash) VALUES (?, ?)", (user.username, hashed))
    conn.commit()
    conn.close()
    return {"success": True, "message": "User registered"}

@app.post("/api/login")
def login(user: UserLogin):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id, password_hash FROM users WHERE username=?", (user.username,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        return {"success": False, "message": "Invalid username or password"}
    stored_hash = row[1] if isinstance(row[1], (bytes, bytearray)) else row[1].encode()
    if bcrypt.checkpw(user.password.encode(), stored_hash):
        return {"success": True, "token": create_access_token(row[0])}
    return {"success": False, "message": "Invalid username or password"}

from fastapi.responses import StreamingResponse
import io
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib import colors
from reportlab.graphics import renderPDF
from reportlab.graphics.shapes import Drawing
from reportlab.graphics.charts.piecharts import Pie

def generate_pdf_report(user_id):
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter)
    styles = getSampleStyleSheet()
    story = []

    # Title
    story.append(Paragraph("Cyber Hygiene Report", styles['h1']))
    story.append(Spacer(1, 12))

    # Password Strength Stats
    stats = dashboard_stats(user_id)
    story.append(Paragraph("Password Strength", styles['h2']))
    story.append(Paragraph(f"Strong: {stats['strong']}", styles['Normal']))
    story.append(Paragraph(f"Medium: {stats['medium']}", styles['Normal']))
    story.append(Paragraph(f"Weak: {stats['weak']}", styles['Normal']))
    story.append(Paragraph(f"Cyber Hygiene Score: {stats['score']}%", styles['Normal']))
    story.append(Spacer(1, 12))
    
    # Pie Chart
    drawing = Drawing(300, 200)
    data = [stats['strong'], stats['medium'], stats['weak']]
    labels = ['Strong', 'Medium', 'Weak']
    pie = Pie()
    pie.x = 65
    pie.y = 15
    pie.width = 150
    pie.height = 150
    pie.data = data
    pie.labels = labels
    pie.slices.strokeWidth=0.5
    pie.slices[0].fillColor = colors.green
    pie.slices[1].fillColor = colors.orange
    pie.slices[2].fillColor = colors.red
    drawing.add(pie)
    story.append(drawing)
    story.append(Spacer(1,12))


    # Credentials Table
    story.append(Paragraph("Stored Credentials", styles['h2']))
    credentials = get_credentials(user_id)
    if credentials:
        table_data = [['Site', 'Username', 'Password', 'Strength']]
        for cred in credentials:
            table_data.append([cred['site'], cred['username'], cred['password'], cred['strength']])
        
        table = Table(table_data)
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.grey),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
            ('BACKGROUND', (0, 1), (-1, -1), colors.beige),
            ('GRID', (0, 0), (-1, -1), 1, colors.black)
        ]))
        story.append(table)
    else:
        story.append(Paragraph("No credentials stored.", styles['Normal']))

    doc.build(story)
    buffer.seek(0)
    return buffer

@app.get("/api/report")
def get_report(user_id: int = Depends(get_current_user_id)):
    pdf_buffer = generate_pdf_report(user_id)
    return StreamingResponse(pdf_buffer, media_type='application/pdf', headers={'Content-Disposition': 'attachment; filename=report.pdf'})

