# Modir — personal project tracker

    docker compose up -d --build     # → http://localhost:3000

Data lives in `./data/modir.db` (SQLite, mounted into the container). Back it up by copying that file.

- **Project / Task**: type (project or task — same features, switchable anytime), name, description, status (open / blocked / paused / closed), priority P1–P4, color.
- **Closed** means *shelved, not finished*: you've put the project or task aside and don't plan to keep working on it, though you may pick it up again later (set its status back to *open*). Closed items leave the overview and are listed on the **Closed** page. Closing is not the same as being done.
- **Done** (tasks): checking off a task logs a "Done" action (shown as ✓ Done in the daily log) and moves the task to *closed*. Closing something by hand isn't logged.
- **Todo**: planned work. Tick it and it becomes an action stamped with the current time.
- **Action**: work you did. Time defaults to now and can be edited, including for past work.
- **Blocker**: something in the way. Adding one marks the project *blocked*; resolve it (it becomes an action) or delete it, and once none are left the project goes back to *open*.
# modir
