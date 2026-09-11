# MA-03

Investigate and fix the reported pagination/status interaction: page lengths or displayed results can become misleading when a status filter is applied after navigating pages. Use separate API/data and UI investigations; another Run must reproduce the behavior before a Writer changes it. Preserve unfiltered pagination, filtered totals and task creation. Record the finding→reproduction→fix→independent-verification source chain, and do not report the same defect in a corrected control checkout.
