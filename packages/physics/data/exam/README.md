# The parts exam

Documented real builds: one car, one change, a measurement before and after. The model must predict the change.
Figures were read from web-search result summaries: pages could not be opened.

```json
{
  "id": "turbo-tune-vw-gti-mk7",
  "topic": "ECU tune on a turbocharged engine",
  "gathered": "2026-11-14",
  "cases": [
    {
      "car": "2015 Volkswagen Golf GTI (2.0T, 6-speed manual)",
      "change": "ECU tune only, 93 octane",
      "physical": { "boostPsiBefore": 17, "boostPsiAfter": 23 },
      "measure": "wheel horsepower, chassis dyno",
      "before": { "wheelHp": 215, "wheelTorqueLbFt": 250 },
      "after": { "wheelHp": 285, "wheelTorqueLbFt": 330 },
      "publisher": "...", "url": "https://...", "sourceKind": "test",
      "note": "The wording relied on. Read from search-result summary; page not opened.",
      "check": "confirmed", "checkNote": "..."
    }
  ],
  "ruleOfThumb": [ { "claim": "...", "publisher": "...", "url": "..." } ],
  "searchesUsed": 12
}
```

`before` and `after` hold whatever was measured: `crankHp`, `wheelHp`, `wheelTorqueLbFt`, `zeroToSixtySec`,
`quarterMileSec`, `quarterMileMph`, `sixtyFootSec`, `skidpadG`, `braking60to0Ft`, `braking70to0Ft`, `lapSec`,
`topSpeedMph`, `weightLb`, `downforceLb` (with `atMph`).
