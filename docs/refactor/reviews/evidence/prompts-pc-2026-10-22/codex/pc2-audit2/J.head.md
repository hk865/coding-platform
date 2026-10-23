# PC-2 audit 2, part J: the joint rows (rework 1)

Your part is `J`: `./.lead-ref/parts/J.diff` and `J-files.txt` (`tests/app/PC2-joint-*`, `tests/runtime/PC2-joint-*`).
Rows J-01 … J-13 (J-04, J-06, J-08, J-09 deferred; J-07 narrowed), which also carry H-09, T-09, G-09, Q-06, Q-07's fix
half, Q-08, Q-09.

**Look hardest at:** J-01/J-02/H-09 — DSH reply §1.2: the Host fixture has no Work entry, so the chain is "settings
route → the Host's binding resolve", then preparation and start on the frozen Work fixture reading the Host's prompts
directory. Does that prove what PC-05/PC-06/PC-08 ask (a model's `promptPack` saved through settings reaches a real
preparation; omitted → defaults; restart; the same modelId changed A → B)? If not, what public path would, within the
frozen fixtures? J-13 — reply §1.3: per-tool whole spec objects plus a fixed name list instead of one whole body
literal: equivalent (would any change to the body pass)? J-11 — the shrink chain's numbers (777/41, ranges
1375–2152 / 2154–2195, 2195, 43/4096): check them by hand where the inputs allow. J-03, J-05, J-07, J-10, J-12 as the
rows say; each expected value a literal or hand-computed.
