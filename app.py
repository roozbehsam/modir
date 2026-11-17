import os
import sqlite3
from datetime import datetime

from flask import Flask, abort, g, jsonify, request

DB_PATH = os.environ.get("DB_PATH", os.path.join(os.path.dirname(__file__), "data", "modir.db"))

app = Flask(__name__, static_folder="static", static_url_path="")

SCHEMA = """
CREATE TABLE IF NOT EXISTS projects (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    status      TEXT    NOT NULL DEFAULT 'open',   -- open | blocked | paused | closed
    priority    INTEGER NOT NULL DEFAULT 2,        -- 1 (top) .. 4 (low)
    color       TEXT    NOT NULL DEFAULT '#6366f1',
    type        TEXT    NOT NULL DEFAULT 'project', -- project | task
    created_at  TEXT    NOT NULL
);
CREATE TABLE IF NOT EXISTS entries (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind        TEXT    NOT NULL,                  -- todo | action | blocker
    title       TEXT    NOT NULL,
    note        TEXT    NOT NULL DEFAULT '',
    at          TEXT    NOT NULL,                  -- local time 'YYYY-MM-DDTHH:MM' (editable)
    created_at  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entries_project ON entries(project_id, kind, at);
"""

STATUSES = {"open", "blocked", "paused", "closed"}
KINDS = {"todo", "action", "blocker"}
TYPES = {"project", "task"}


def now():
    return datetime.now().strftime("%Y-%m-%dT%H:%M")


def db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


def init_db():
    os.makedirs(os.path.dirname(DB_PATH) or ".", exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        conn.executescript(SCHEMA)
        cols = {r[1] for r in conn.execute("PRAGMA table_info(projects)")}
        if "type" not in cols:  # migrate databases created before tasks existed
            conn.execute("ALTER TABLE projects ADD COLUMN type TEXT NOT NULL DEFAULT 'project'")
        # One-time migration: 'done' was renamed to 'closed', and closing a task used to log a
        # "Done: <name>" / "Closed: <name>" action. Closing is no longer logged, so drop those.
        if conn.execute("UPDATE projects SET status = 'closed' WHERE status = 'done'").rowcount:
            conn.execute(
                """DELETE FROM entries
                   WHERE kind = 'action' AND (title LIKE 'Done: %' OR title LIKE 'Closed: %')
                     AND project_id IN (SELECT id FROM projects WHERE type = 'task')"""
            )


def clean(data, allowed):
    out = {k: v for k, v in (data or {}).items() if k in allowed}
    if "status" in out and out["status"] not in STATUSES:
        abort(400, "bad status")
    if "type" in out and out["type"] not in TYPES:
        abort(400, "bad type")
    if "kind" in out and out["kind"] not in KINDS:
        abort(400, "bad kind")
    if "priority" in out:
        out["priority"] = min(4, max(1, int(out["priority"])))
    for key in ("name", "title"):
        if key in out:
            out[key] = str(out[key]).strip()
            if not out[key]:
                abort(400, f"{key} required")
    return out


def sync_blocked(pid):
    """A project with open blockers is 'blocked'; once the last one is gone it goes back to 'open'."""
    n = db().execute(
        "SELECT COUNT(*) FROM entries WHERE project_id = ? AND kind = 'blocker'", [pid]
    ).fetchone()[0]
    if n:
        db().execute("UPDATE projects SET status = 'blocked' WHERE id = ?", [pid])
    else:
        db().execute("UPDATE projects SET status = 'open' WHERE id = ? AND status = 'blocked'", [pid])
    db().commit()


def update_row(table, row_id, fields):
    if fields:
        cols = ", ".join(f"{k} = ?" for k in fields)
        cur = db().execute(f"UPDATE {table} SET {cols} WHERE id = ?", [*fields.values(), row_id])
        if cur.rowcount == 0:
            abort(404)
        db().commit()
    row = db().execute(f"SELECT * FROM {table} WHERE id = ?", [row_id]).fetchone()
    if row is None:
        abort(404)
    return dict(row)


@app.get("/")
def index():
    return app.send_static_file("index.html")


# ---- projects ---------------------------------------------------------------

PROJECT_FIELDS = {"name", "description", "status", "priority", "color", "type"}


@app.get("/api/projects")
def list_projects():
    rows = db().execute(
        """
        SELECT p.*,
          (SELECT COUNT(*) FROM entries e WHERE e.project_id = p.id AND e.kind = 'todo')   AS todos,
          (SELECT COUNT(*) FROM entries e WHERE e.project_id = p.id AND e.kind = 'action') AS actions,
          (SELECT COUNT(*) FROM entries e WHERE e.project_id = p.id AND e.kind = 'blocker') AS blockers,
          (SELECT MAX(at)  FROM entries e WHERE e.project_id = p.id AND e.kind = 'action') AS last_at,
          (SELECT title FROM entries e WHERE e.project_id = p.id AND e.kind = 'blocker'
             ORDER BY e.at, e.id LIMIT 1)                                                   AS first_blocker,
          (SELECT title FROM entries e WHERE e.project_id = p.id AND e.kind = 'todo'
             ORDER BY e.at, e.id LIMIT 1)                                                   AS next_todo
        FROM projects p
        ORDER BY CASE p.status WHEN 'open' THEN 0 WHEN 'blocked' THEN 1 WHEN 'paused' THEN 2 ELSE 3 END,
                 p.priority, last_at DESC, p.id DESC
        """
    ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.post("/api/projects")
def create_project():
    data = clean(request.json, PROJECT_FIELDS)
    if "name" not in data:
        abort(400, "name required")
    data["created_at"] = now()
    cols = ", ".join(data)
    cur = db().execute(
        f"INSERT INTO projects ({cols}) VALUES ({', '.join('?' * len(data))})", list(data.values())
    )
    db().commit()
    return jsonify(update_row("projects", cur.lastrowid, {})), 201


@app.patch("/api/projects/<int:pid>")
def patch_project(pid):
    return jsonify(update_row("projects", pid, clean(request.json, PROJECT_FIELDS)))


@app.delete("/api/projects/<int:pid>")
def delete_project(pid):
    db().execute("DELETE FROM projects WHERE id = ?", [pid])
    db().commit()
    return "", 204


# ---- entries (todos + actions) ---------------------------------------------

ENTRY_FIELDS = {"kind", "title", "note", "at"}


@app.get("/api/projects/<int:pid>/entries")
def list_entries(pid):
    rows = db().execute(
        "SELECT * FROM entries WHERE project_id = ? ORDER BY at DESC, id DESC", [pid]
    ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.post("/api/projects/<int:pid>/entries")
def create_entry(pid):
    data = clean(request.json, ENTRY_FIELDS)
    if "title" not in data:
        abort(400, "title required")
    data.setdefault("kind", "action")
    data.setdefault("at", now())
    data["project_id"] = pid
    data["created_at"] = now()
    cols = ", ".join(data)
    cur = db().execute(
        f"INSERT INTO entries ({cols}) VALUES ({', '.join('?' * len(data))})", list(data.values())
    )
    db().commit()
    if data["kind"] == "blocker":
        sync_blocked(pid)
    return jsonify(update_row("entries", cur.lastrowid, {})), 201


@app.patch("/api/entries/<int:eid>")
def patch_entry(eid):
    old = db().execute("SELECT project_id, kind FROM entries WHERE id = ?", [eid]).fetchone()
    if old is None:
        abort(404)
    row = update_row("entries", eid, clean(request.json, ENTRY_FIELDS))
    if "blocker" in (old["kind"], row["kind"]):
        sync_blocked(old["project_id"])
    return jsonify(row)


@app.delete("/api/entries/<int:eid>")
def delete_entry(eid):
    old = db().execute("SELECT project_id, kind FROM entries WHERE id = ?", [eid]).fetchone()
    db().execute("DELETE FROM entries WHERE id = ?", [eid])
    db().commit()
    if old and old["kind"] == "blocker":
        sync_blocked(old["project_id"])
    return "", 204


# ---- cross-project open todos ----------------------------------------------

@app.get("/api/todos")
def open_todos():
    rows = db().execute(
        """
        SELECT e.id, e.project_id, e.title, e.note, e.created_at, p.name AS project, p.color
        FROM entries e JOIN projects p ON p.id = e.project_id
        WHERE e.kind = 'todo' AND p.status != 'closed'
        ORDER BY e.created_at DESC, e.id DESC
        """
    ).fetchall()
    return jsonify([dict(r) for r in rows])


# ---- cross-project timeline -------------------------------------------------

@app.get("/api/timeline")
def timeline():
    since = request.args.get("from", "0000")
    rows = db().execute(
        """
        SELECT e.id, e.project_id, e.title, e.note, e.at, p.name AS project, p.color
        FROM entries e JOIN projects p ON p.id = e.project_id
        WHERE e.kind = 'action' AND e.at >= ?
        ORDER BY e.at
        """,
        [since],
    ).fetchall()
    return jsonify([dict(r) for r in rows])


init_db()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 3000)), debug=True)
