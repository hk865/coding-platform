# PC-2 audit 2, part H: Host, packs on disk and routes (rework 1)

Your part is `H`: `./.lead-ref/parts/H.diff` and `H-files.txt` (`src/app/**`, `create-platform.ts`,
`tests/app/PC2-H-*`). Rows H-01 … H-13 (H-09 same as J-01/J-02).

**Look hardest at:** H-01 (a configured root without a real path is a configuration error at start, naming both
paths; no other start behaviour changed for existing roots); H-02 (all restored roots checked before the restore
loop); H-03 (request validation errors carry `problems`; the HTTP bad-JSON branch keeps it; other settings routes'
bad-JSON answers unchanged — compare `server.ts` with `base/`); H-04 (save reads the chain, compares the effective
version or digest first, then validates the pack after the replacement; an invalid old pack no longer blocks a valid
save; a save that leaves the pack invalid is still `invalid` with every file byte-equal); H-05 (exclusive create; an
identical existing file reused; a different one `unavailable`; nothing overwritten, also on the tool path); H-06, H-07,
H-08, H-10, H-11, H-12, H-13 as the rows say. Any behaviour change outside the prompts routes is **会出错**.
