from datetime import datetime
from pathlib import Path
import sqlite3

from flask import Flask, jsonify, request, send_from_directory

BASE_DIR = Path(__file__).resolve().parent
DATABASE_PATH = BASE_DIR / "mtaa_fix.sqlite"
app = Flask(__name__, static_folder=str(BASE_DIR))

CATEGORY_DATA = {
    "Streetlight": ("light", "yellow"),
    "Roads": ("road", "coral"),
    "Drainage": ("water", "blue"),
    "Waste": ("waste", "mint"),
    "Water": ("water", "blue"),
    "Safety": ("safety", "coral"),
}
ALLOWED_STATUSES = {"Unresolved", "In progress", "Fixed"}


def get_connection():
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def row_to_dict(row):
    return dict(row) if row else None


def initialize_database():
    connection = get_connection()
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            category TEXT NOT NULL,
            location TEXT NOT NULL,
            severity TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'Unresolved',
            confirmations INTEGER NOT NULL DEFAULT 1,
            icon TEXT NOT NULL,
            color TEXT NOT NULL,
            photo TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS fixers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            specialty TEXT NOT NULL,
            location TEXT NOT NULL,
            distance TEXT NOT NULL,
            verified INTEGER NOT NULL DEFAULT 0,
            phone TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS heroes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            reports INTEGER NOT NULL DEFAULT 0,
            confirmations INTEGER NOT NULL DEFAULT 0,
            solved INTEGER NOT NULL DEFAULT 0,
            points INTEGER NOT NULL DEFAULT 0
        );
        """
    )

    if connection.execute("SELECT COUNT(*) FROM reports").fetchone()[0] == 0:
        connection.executemany(
            """
            INSERT INTO reports
                (title, category, location, severity, status, confirmations, icon, color, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                ("Streetlight out on River Road", "Streetlight", "Ngara, Nairobi", "Medium", "Unresolved", 14, "light", "yellow", datetime.now().isoformat()),
                ("Deep pothole beside the market", "Roads", "Kawangware, Nairobi", "High", "Unresolved", 21, "road", "coral", datetime.now().isoformat()),
                ("Blocked drainage after the rain", "Drainage", "Kilimani, Nairobi", "Critical", "In progress", 9, "water", "blue", datetime.now().isoformat()),
            ],
        )

    if connection.execute("SELECT COUNT(*) FROM fixers").fetchone()[0] == 0:
        connection.executemany(
            """
            INSERT INTO fixers (name, specialty, location, distance, verified, phone)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            [
                ("Mike's Plumbing", "Water & drainage", "Ngara, Nairobi", "1.2 km", 1, "+254700000001"),
                ("Eastlands Waste Co.", "Waste collection", "Eastlands, Nairobi", "2.4 km", 1, "+254700000002"),
                ("Jirani Electric", "Streetlights & power", "Kilimani, Nairobi", "3.1 km", 1, "+254700000003"),
            ],
        )

    if connection.execute("SELECT COUNT(*) FROM heroes").fetchone()[0] == 0:
        connection.executemany(
            """
            INSERT INTO heroes (name, reports, confirmations, solved, points)
            VALUES (?, ?, ?, ?, ?)
            """,
            [
                ("Alice Karanja", 12, 27, 8, 850),
                ("James Mwangi", 14, 32, 6, 720),
                ("Naomi Wambui", 8, 19, 5, 610),
            ],
        )

    connection.commit()
    connection.close()


@app.get("/api/health")
def health():
    return jsonify(status="ok")


@app.get("/api/reports")
def get_reports():
    connection = get_connection()
    rows = connection.execute(
        """
        SELECT id, title, category, location, severity, status,
               confirmations, icon, color, photo, created_at AS createdAt
        FROM reports
        ORDER BY created_at DESC, id DESC
        """
    ).fetchall()
    connection.close()
    return jsonify([row_to_dict(row) for row in rows])


@app.post("/api/reports")
def create_report():
    data = request.get_json(silent=True) or {}
    category = str(data.get("category", "")).strip()
    description = str(data.get("description", "")).strip()
    location = str(data.get("location", "")).strip()
    photo = str(data.get("photo", "")).strip()

    if not category or not description or not location:
        return jsonify(error="Category, description, and location are required."), 400

    icon, color = CATEGORY_DATA.get(category, ("road", "coral"))
    severity = "High" if category == "Safety" else "Medium"
    created_at = datetime.now().isoformat()

    connection = get_connection()
    cursor = connection.execute(
        """
        INSERT INTO reports
            (title, category, location, severity, status, confirmations, icon, color, photo, created_at)
        VALUES (?, ?, ?, ?, 'Unresolved', 1, ?, ?, ?, ?)
        """,
        (description, category, location, severity, icon, color, photo, created_at),
    )
    connection.commit()
    report = connection.execute(
        """
        SELECT id, title, category, location, severity, status,
               confirmations, icon, color, photo, created_at AS createdAt
        FROM reports WHERE id = ?
        """,
        (cursor.lastrowid,),
    ).fetchone()
    connection.close()
    return jsonify(row_to_dict(report)), 201


@app.post("/api/reports/<int:report_id>/confirm")
def confirm_report(report_id):
    connection = get_connection()
    report = connection.execute(
        "SELECT confirmations FROM reports WHERE id = ?", (report_id,)
    ).fetchone()

    if report is None:
        connection.close()
        return jsonify(error="Report not found."), 404

    confirmations = report["confirmations"] + 1
    connection.execute(
        "UPDATE reports SET confirmations = ? WHERE id = ?",
        (confirmations, report_id),
    )
    connection.commit()
    connection.close()
    return jsonify(
        id=report_id,
        confirmations=confirmations,
        highPriority=confirmations >= 20,
    )


@app.patch("/api/reports/<int:report_id>/status")
def update_report_status(report_id):
    data = request.get_json(silent=True) or {}
    status = str(data.get("status", "")).strip()

    if status not in ALLOWED_STATUSES:
        return jsonify(error="Status must be Unresolved, In progress, or Fixed."), 400

    connection = get_connection()
    cursor = connection.execute(
        "UPDATE reports SET status = ? WHERE id = ?", (status, report_id)
    )
    connection.commit()
    connection.close()

    if cursor.rowcount == 0:
        return jsonify(error="Report not found."), 404
    return jsonify(id=report_id, status=status)


@app.get("/api/stats")
def get_stats():
    connection = get_connection()
    stats = connection.execute(
        """
        SELECT COUNT(*) AS total,
               SUM(CASE WHEN severity = 'Critical' THEN 1 ELSE 0 END) AS critical,
               SUM(CASE WHEN status = 'Unresolved' THEN 1 ELSE 0 END) AS pending,
               SUM(CASE WHEN status = 'Fixed' THEN 1 ELSE 0 END) AS fixed,
               SUM(CASE WHEN confirmations >= 20 THEN 1 ELSE 0 END) AS highPriority
        FROM reports
        """
    ).fetchone()
    active_fixers = connection.execute(
        "SELECT COUNT(*) AS count FROM fixers WHERE verified = 1"
    ).fetchone()["count"]
    connection.close()

    result = row_to_dict(stats)
    result["activeFixers"] = active_fixers
    return jsonify(result)


@app.get("/api/fixers")
def get_fixers():
    connection = get_connection()
    rows = connection.execute(
        """
        SELECT id, name, specialty, location, distance, verified, phone
        FROM fixers ORDER BY verified DESC, id
        """
    ).fetchall()
    connection.close()
    return jsonify([row_to_dict(row) for row in rows])


@app.get("/api/heroes")
def get_heroes():
    connection = get_connection()
    rows = connection.execute(
        """
        SELECT id, name, reports, confirmations, solved, points
        FROM heroes ORDER BY points DESC
        """
    ).fetchall()
    connection.close()
    return jsonify([row_to_dict(row) for row in rows])


@app.get("/")
def home():
    return send_from_directory(BASE_DIR, "mtaa-fix.html")


if __name__ == "__main__":
    initialize_database()
    app.run(host="127.0.0.1", port=5000, debug=True)
