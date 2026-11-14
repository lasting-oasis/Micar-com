# The two "after" runs, side by side

The same `e2e/data.ts`, the same rows and settings: first on `19a90d3`, then on the code branch's head `3c5aa0c` (which differs only in what a page is sent after a sign-out). Per row: each player's download (KB/s), joins (MB in all), the twenty nearest within 200 m (update gap, ms, median / p95), server CPU (share of one PC core), server memory (working set, MB). The figures are in `after-*.jsonl` (the head's run); the earlier run's are below only.

```
The two after runs side by side (19a90d3 | 3c5aa0c): KB/s each, joins MB, near gap, CPU, memory
drive|one|10       0.9 | 0.9    0.2 | 0.2    105 / 115 | 105 / 115    2.2% | 1.2%    105 | 103
drive|one|25       2.5 | 2.5    0.9 | 0.9    105 / 115 | 105 / 115    3.9% | 2.8%    137 | 135
drive|one|50       4.3 | 4.3    2.9 | 2.9    105 / 115 | 105 / 115    4.1% | 4.6%    169 | 168
drive|one|100      6.1 | 6.1    9.9 | 10.0    105 / 115 | 105 / 115    7.3% | 5.6%    150 | 174
drive|spread|10    0.1 | 0.1    0.2 | 0.2    — | —    0.8% | 1.4%    130 | 129
drive|spread|25    0.4 | 0.4    0.9 | 0.9    105 / 115 | 105 / 115    1.4% | 1.4%    133 | 131
drive|spread|50    0.9 | 0.9    2.9 | 2.9    105 / 115 | 105 / 115    3.2% | 2.0%    161 | 161
drive|spread|100   1.9 | 1.9    10.0 | 10.0    105 / 115 | 105 / 115    3.9% | 5.3%    174 | 173
play|one|10        1.0 | 1.0    0.2 | 0.2    105 / 115 | 105 / 115    2.0% | 1.3%    104 | 103
play|one|25        2.6 | 2.6    0.9 | 0.9    105 / 115 | 105 / 115    1.5% | 3.1%    140 | 113
play|one|50        4.4 | 4.4    2.9 | 2.9    105 / 115 | 105 / 115    3.1% | 2.2%    145 | 169
play|one|100       6.2 | 6.2    10.1 | 10.1    105 / 115 | 105 / 115    7.6% | 7.7%    177 | 175
```
