"""Fill the database with demo projects, todos and actions.

    docker exec -i -e NOW="$(date +%Y-%m-%dT%H:%M)" modir python - < seed.py

Pass --reset as an argument (python - --reset) to wipe existing data first.
"""
import os
import random
import sqlite3
import sys
from datetime import datetime, timedelta

random.seed(7)
DB = os.environ.get("DB_PATH", "data/modir.db")
NOW = datetime.strptime(os.environ["NOW"], "%Y-%m-%dT%H:%M") if os.environ.get("NOW") else datetime.now()
fmt = lambda d: d.strftime("%Y-%m-%dT%H:%M")

# name, description, status, priority, color, active day ranges (days ago: from, to, density), actions, todos
PROJECTS = [
    ("Grant proposal — Smart Farming", "EU research grant application. Deadline end of month.",
     "open", 1, "#ef4444", [(40, 25, .5), (12, 0, .8)],
     ["Read the call text", "Outlined proposal sections", "Drafted executive summary", "Budget spreadsheet v1",
      "Meeting with partner university", "Wrote work package 1", "Wrote work package 2", "Collected CVs from team",
      "Revised impact section", "Gantt chart", "Fixed budget after feedback", "Letter of support requested"],
     ["Write risk management section", "Final proofreading", "Get signature from director", "Submit on portal"]),
    ("Company website redesign", "New landing page + blog. Working with the design team.",
     "open", 1, "#6366f1", [(90, 60, .35), (30, 0, .45)],
     ["Moodboard collected", "Wireframes for home page", "Reviewed designer mockups", "Set up Astro project",
      "Hero section implemented", "Blog layout", "Contact form + spam protection", "Lighthouse audit: 96",
      "Migrated old blog posts", "Fixed mobile nav bug"],
     ["Write About page copy", "Set up analytics", "DNS switch to new host"]),
    ("Thesis — chapter 3", "Experimental results and discussion.",
     "open", 2, "#8b5cf6", [(150, 100, .3), (55, 35, .4), (6, 0, .5)],
     ["Ran baseline experiments", "Plotted results", "Literature review update", "Wrote methods section",
      "Meeting with supervisor", "Re-ran ablation study", "Drafted discussion"],
     ["Fix figure 3.4 axis labels", "Add related work on transformers"]),
    ("Learn Rust", "Side project: work through the book + build a CLI tool.",
     "paused", 3, "#f59e0b", [(170, 120, .25)],
     ["Chapters 1–4 of the book", "Ownership exercises", "Built a todo CLI", "Error handling chapter",
      "Started async chapter"],
     ["Finish async chapter", "Rewrite CLI with clap"]),
    ("Home server setup", "Proxmox box for backups, media and self-hosted tools.",
     "open", 3, "#10b981", [(75, 65, .6), (20, 15, .5)],
     ["Installed Proxmox", "ZFS pool configured", "Set up nightly backups", "Nextcloud container",
      "Reverse proxy with Caddy"],
     ["Set up UPS shutdown script"]),
    ("Tax return 2025", "", "done", 2, "#06b6d4", [(200, 185, .5)],
     ["Collected invoices", "Filled the forms", "Sent to accountant", "Paid and filed"], []),
]

NOTES = ["", "", "", "Took longer than expected.", "Went well 👍", "Blocked on feedback for a bit.",
         "Need to revisit this later.", "Talked it through with the team."]

conn = sqlite3.connect(DB)
conn.execute("PRAGMA foreign_keys = ON")
if "--reset" in sys.argv:
    conn.execute("DELETE FROM projects")

for name, desc, status, prio, color, ranges, actions, todos in PROJECTS:
    start = NOW - timedelta(days=max(r[0] for r in ranges) + 2)
    pid = conn.execute(
        "INSERT INTO projects (name, description, status, priority, color, created_at) VALUES (?,?,?,?,?,?)",
        (name, desc, status, prio, color, fmt(start)),
    ).lastrowid

    # pick active days from the ranges, then spread the action titles over them (1–3 per day)
    days = [d for frm, to, p in ranges for d in range(frm, to - 1, -1) if random.random() < p]
    days = sorted(set(days), reverse=True) or [0]
    verbs = ["Continued: {}", "Polished: {}", "Reviewed: {}", "Follow-up on: {}"]
    pool = list(actions)
    while len(pool) < len(days) * 1.6:
        pool += [random.choice(verbs).format(t[0].lower() + t[1:]) for t in random.sample(actions, len(actions))]
    i = 0
    for d in days:
        for _ in range(random.choice([1, 1, 1, 2, 2, 3])):
            if i >= len(pool):
                break
            hour = random.choice([8, 9, 10, 11, 14, 15, 16, 17, 21, 22, 23])
            at = (NOW - timedelta(days=d)).replace(hour=hour, minute=random.randrange(0, 60, 5))
            if at > NOW:
                at = NOW - timedelta(minutes=random.randint(5, 90))
            conn.execute(
                "INSERT INTO entries (project_id, kind, title, note, at, created_at) VALUES (?,?,?,?,?,?)",
                (pid, "action", pool[i], random.choice(NOTES), fmt(at), fmt(at)),
            )
            i += 1

    for n, t in enumerate(todos):
        at = fmt(NOW - timedelta(days=len(todos) - n))
        conn.execute(
            "INSERT INTO entries (project_id, kind, title, note, at, created_at) VALUES (?,?,?,?,?,?)",
            (pid, "todo", t, "", at, at),
        )

conn.commit()
print(conn.execute("SELECT kind, COUNT(*) FROM entries GROUP BY kind").fetchall(),
      conn.execute("SELECT COUNT(*) FROM projects").fetchone())
