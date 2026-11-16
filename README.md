# Modir — personal project tracker

    docker compose up -d --build     # → http://localhost:3000

Data lives in `./data/modir.db` (SQLite, mounted into the container). Back it up by copying that file.

- **Project / Task**: type (project or task — same features, switchable anytime), name, description, status (open / blocked / paused / done), priority P1–P4, color.
- **Todo**: planned work. Tick it and it becomes an action stamped with the current time.
- **Action**: work you did. Time defaults to now and can be edited, including for past work.
- **Blocker**: something in the way. Adding one marks the project *blocked*; resolve it (it becomes an action) or delete it, and once none are left the project goes back to *open*.
# modir
