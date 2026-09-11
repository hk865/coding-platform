# Taskboard baseline v1

A small local task board: browser UI → HTTP API → JSON file. Node 22+ only, no install step.

Run `npm test`, then `npm start` and open the printed local URL. Default storage is `data/tasks.json`; `TASK_DATA_FILE` and `PORT` can override storage and port.

The initial board provides basic status selection and numbered pages. Existing API: `GET /api/tasks?status=all|open|done&page=1&pageSize=3` and `POST /api/tasks` with `{id,title,status}`. Create with an existing ID is idempotent. Public smoke tests describe current basic behavior; additional requirements are in TASK.md.
