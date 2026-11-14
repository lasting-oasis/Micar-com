# Research records for physics sheets

One JSON file per exact car configuration. Each figure names who published it and where. Figures were read from
web-search result summaries: pages could not be opened, so nothing here was checked against a primary document.
A second reader then tried to refute each figure (`check`).

```json
{
  "id": "2024-ford-mustang-gt",
  "year": 2024, "make": "Ford", "model": "Mustang", "trim": "GT Fastback (5.0L V8, 6-speed manual)",
  "bodyClass": "coupe",
  "gathered": "2026-11-14",
  "fields": [
    { "key": "wheelbaseIn", "number": 107.0, "publisher": "Ford", "url": "https://...", "sourceKind": "manufacturer",
      "note": "The wording relied on. Read from search-result summary; page not opened.",
      "corroboratingUrl": "https://...", "check": "confirmed", "checkNote": "..." },
    { "key": "gearRatios", "numbers": [3.24, 2.10, 1.42, 1.00, 0.81, 0.62], "publisher": "...", "url": "...", "sourceKind": "manufacturer", "note": "..." },
    { "key": "tyreFront", "text": "255/40R19", "publisher": "...", "url": "...", "sourceKind": "manufacturer", "note": "..." }
  ],
  "notFound": ["cgHeightIn"],
  "conflicts": [ { "key": "curbWeightLb", "values": [3832, 3900], "note": "which was kept and why" } ],
  "searchesUsed": 14
}
```

`sourceKind` is one of `manufacturer`, `agency`, `test` (an independent instrumented test), `reference` (anything republished).
`check` is `confirmed`, `unconfirmed` or `refuted` (a refuted figure is corrected and the old value moved to `conflicts`).

## Keys

Published units, as the source gives them.

| Group | Keys |
| --- | --- |
| Size and mass | `wheelbaseIn`, `trackFrontIn`, `trackRearIn`, `lengthIn`, `widthIn`, `heightIn`, `curbWeightLb`, `weightDistFrontPct`, `groundClearanceIn`, `cgHeightIn` |
| Engine or motor | `engineDescription`, `powertrain` (gasoline, diesel, hybrid, plug-in-hybrid, electric), `induction` (natural, turbo, twin-turbo, supercharged), `engineLocation` (front, mid, rear), `displacementL`, `cylinders`, `horsepower`, `horsepowerRpm`, `torqueLbFt`, `torqueRpmLow`, `torqueRpmHigh`, `redlineRpm`, `boostPsi`, `compressionRatio` |
| Driveline | `drivetrain` (FWD, RWD, AWD, 4WD), `awdSystem` (words), `transmissionType` (manual, automatic, dual-clutch, cvt, ecvt, single-speed), `gearCount`, `gearRatios` (array, first gear first), `finalDriveRatio`, `differential` (words: open, limited-slip, electronic, locking) |
| Tyres | `tyreFront`, `tyreRear` (size as printed), `tyreModel`, `tyreCategory` (all-season, summer, max-performance, track, all-terrain, winter) |
| Air | `dragCoefficient`, `frontalAreaSqFt`, `liftCoefficientFront`, `liftCoefficientRear` |
| Steering and brakes | `steeringRatio`, `turningCircleFt`, `brakeFrontDiscIn`, `brakeRearDiscIn` |
| Limits and economy | `topSpeedMph`, `topSpeedGoverned` (true or false), `epaCombinedMpg`, `epaCityMpg`, `epaHighwayMpg` |
| Instrumented tests (checks only, never inputs) | `test0to30Sec`, `test0to60Sec`, `test0to100Sec`, `testRollout` (true when the 0-60 uses the one-foot rollout), `testQuarterMileSec`, `testQuarterMileMph`, `testBraking60to0Ft`, `testBraking70to0Ft`, `testSkidpadG`, `testSkidpadDiameterFt`, `testTopSpeedMph`, `testWeightLb`, `testWeightDistFrontPct` |

A test figure must come from a named instrumented test of the same configuration, and its `publisher` is the tester.
