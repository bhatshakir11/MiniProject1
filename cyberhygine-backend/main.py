


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

# Update credential
@app.put("/api/credentials/{cred_id}")
def update_credential(cred_id: int, cred: Credential):
    conn = get_cred_db()
    cursor = conn.cursor()
    cursor.execute("""
        UPDATE credentials
        SET site = ?, username = ?, password = ?, strength = ?
        WHERE id = ?
    """, (cred.site, cred.username, cred.password, cred.strength, cred_id))
    conn.commit()
    affected = cursor.rowcount
    conn.close()
    if affected == 0:
        raise HTTPException(status_code=404, detail="Credential not found")
    return {"success": True}
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

from fastapi import HTTPException

# Delete credential
@app.delete("/api/credentials/{cred_id}")
def delete_credential(cred_id: int):
    conn = get_cred_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM credentials WHERE id = ?", (cred_id,))
    conn.commit()
    affected = cursor.rowcount
    conn.close()
    if affected == 0:
        raise HTTPException(status_code=404, detail="Credential not found")
    return {"success": True}

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

from fastapi.responses import StreamingResponse
import io
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib import colors
from reportlab.graphics import renderPDF
from reportlab.graphics.shapes import Drawing
from reportlab.graphics.charts.piecharts import Pie

def generate_pdf_report():
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter)
    styles = getSampleStyleSheet()
    story = []

    # Title
    story.append(Paragraph("Cyber Hygiene Report", styles['h1']))
    story.append(Spacer(1, 12))

    # Password Strength Stats
    stats = dashboard_stats()
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
    credentials = get_credentials()
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
def get_report():
    pdf_buffer = generate_pdf_report()
    return StreamingResponse(pdf_buffer, media_type='application/pdf', headers={'Content-Disposition': 'attachment; filename=report.pdf'})

