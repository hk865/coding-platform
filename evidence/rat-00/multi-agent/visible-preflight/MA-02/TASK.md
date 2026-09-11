# MA-02

Add a persistent task filter combining status (all/open/done) with case-insensitive, trimmed substring search of titles. Use GET /api/tasks?q=...&status=...&page=...&pageSize=...; filter before pagination and return the filtered total. Add a visible search control. Changing a filter resets page to 1. Restore status and text when the page is reloaded, tolerating invalid stored state. Preserve task creation, idempotency by ID, HTML escaping, and unfiltered results. Produce an API/UI proposal before writing and consume the accepted proposal; verify independently before review.
