
from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import sqlite3
import bcrypt

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Notes Support ---
class Note(BaseModel):
    title: str
    content: str

def ensure_notes_table():
    conn = sqlite3.connect("users.db")
    conn.execute("""CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT NOT NULL
    )""")
    conn.close()

@app.post("/api/notes")
def add_note(note: Note):
    ensure_notes_table()
    conn = sqlite3.connect("users.db")
    cursor = conn.cursor()
    cursor.execute("INSERT INTO notes (title, content) VALUES (?, ?)", (note.title, note.content))
    conn.commit()
    conn.close()
    return {"success": True}

@app.get("/api/notes")
def get_notes():
    ensure_notes_table()
    conn = sqlite3.connect("users.db")
    cursor = conn.cursor()
    cursor.execute("SELECT id, title, content FROM notes")
    rows = cursor.fetchall()
    conn.close()
    return [{"id": r[0], "title": r[1], "content": r[2]} for r in rows]


class Credential(BaseModel):
    site: str
    username: str
    password: str
    strength: str

def get_cred_db():
    conn = sqlite3.connect("users.db")
    conn.execute("""CREATE TABLE IF NOT EXISTS credentials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        site TEXT NOT NULL,
        username TEXT NOT NULL,
        password TEXT NOT NULL,
        strength TEXT NOT NULL
    )""")
    return conn

# Add credential
@app.post("/api/credentials")
def add_credential(cred: Credential):
    conn = get_cred_db()
    cursor = conn.cursor()
    cursor.execute("INSERT INTO credentials (site, username, password, strength) VALUES (?, ?, ?, ?)",
                   (cred.site, cred.username, cred.password, cred.strength))
    conn.commit()
    conn.close()
    return {"success": True}

# Get all credentials
@app.get("/api/credentials")
def get_credentials():
    conn = get_cred_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id, site, username, password, strength FROM credentials")
    rows = cursor.fetchall()
    conn.close()
    return [{"id": r[0], "site": r[1], "username": r[2], "password": r[3], "strength": r[4]} for r in rows]

# Dashboard stats
@app.get("/api/dashboard")
def dashboard_stats():
    conn = get_cred_db()
    cursor = conn.cursor()
    # Password strength stats
    cursor.execute("SELECT strength, COUNT(*) FROM credentials GROUP BY strength")
    strength_counts = {row[0]: row[1] for row in cursor.fetchall()}
    strong = strength_counts.get("strong", 0)
    weak = strength_counts.get("weak", 0)
    medium = strength_counts.get("medium", 0)
    total = strong + weak + medium
    score = int((strong / total) * 100) if total > 0 else 0

    # Reused vs Unique passwords
    cursor.execute("SELECT password, COUNT(*) as cnt FROM credentials GROUP BY password")
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
    conn = sqlite3.connect("users.db")
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
    cursor.execute("SELECT password_hash FROM users WHERE username=?", (user.username,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        return {"success": False, "message": "Invalid username or password"}
    if bcrypt.checkpw(user.password.encode(), row[0]):
        # In production, return a JWT token here
        return {"success": True, "token": "dummy-token"}
    return {"success": False, "message": "Invalid username or password"}
