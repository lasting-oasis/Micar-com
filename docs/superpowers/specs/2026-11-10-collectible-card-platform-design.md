# Vehicles as collectible cards — design

Today MiCar draws one card per car on the home page: a value, a simulated 1 to 10 grade, a case and foil. Nothing is stored, the card knows nothing about what the car can do, and the Garage is a placeholder page. This work makes the card real. Every vehicle gets a persistent MiCar identity, a factory specification with a source on every figure, seven attributes on a 0 to 1000 scale and a Power Rating computed from that specification, a second layer for this vehicle's modifications and wear, a five-part grade with certification levels, a passport that keeps its history, a collectible card with rarity and editions, and card races scored from the attributes.

It adds one shared package, `packages/engine` (`@micar/engine`), and one page, the Garage, at `#/garage` in the value app. The home page, the calculator, the window sheets, the Strip and the world's Garage are not changed.

The plan already reserves `packages/engine` for "the valuation that already runs MiCar Value + a condition model + a driving model" (`docs/micar-central-page-plan.md`). This is its first instalment: the condition model and the driving model. The valuation stays in `apps/value/src/engine` and can move in later as its own module. Nothing in `packages/engine` imports it, reads a price or carries one.

## What the visitor sees

1. **The strip's Garage door** and the footer's Garage link open the Garage at `#/garage`. "soon" is gone from both. `/garage/` still answers and forwards there.
2. **The Garage, empty.** Title "MiCar Garage", the line "Your cars, as cards.", one button "Park a car", and under it the example cards: the two specimens from the brief (a Nissan GT-R NISMO and a Honda Civic, each stamped "example") and the reference catalogue as house cards. A notice says where things are kept: "Saved on this device. Nothing here leaves your browser. Accounts come with phase 1." The page shows this device's Garage ID, which stands in for an account until there are accounts.
3. **Park a car.** Three steps on one panel.
   - *The vehicle:* year, make, model, trim, body class, colour, and the VIN (optional, checked as it is typed, marked "private: never shown, never shared").
   - *The specification:* if the reference catalogue holds this vehicle, "Use the reference specification" fills the sheet and says "reference data, not verified". For any model the site lists from 2005 on, "How the EPA lists this model year" offers the configurations in the EPA's own vehicle file; picking one fills the engine size, cylinders, transmission, drive and fuel as agency data. Otherwise, or after, the owner types what they know. Every field shows its source. A live preview shows the seven attributes filling in and names what is still missing.
   - *Park it:* the vehicle gets its MiCar ID and its first card (Registration Edition).
4. **The vehicle's page** (`#/garage/<MiCar ID>`). The card on the left, flippable. Tabs on the right:
   - **Stats:** the seven attributes three ways (factory, this vehicle, ranked play), the Power Rating, every adjustment itemised with its evidence, and what data is missing.
   - **Grade:** five bars from 0 to 100, the number on the label, the certification ladder (Registered, Documented, Verified, Certified) and the checklist of what unlocks the next level.
   - **Passport:** the timeline, "Add an entry" (photo, maintenance, repair, mileage, inspection report, restoration, document, declaration) with files, the grade history, the card's editions, owners, "Transfer to a new owner", "Download the passport file" and "What others see" (the public view). A transfer needs the new owner's Garage ID; the seller then sends them the passport file, they bring it in, and from then on only they can write to it.
   - **Mods:** the modification catalogue as cards; fitting one writes a passport entry and shows what it does to each attribute, trade-offs included.
   - **Race:** five card races; pick a mode, the house fields three rivals of the same class, the result shows who won and why.
   - **Spec sheet:** the factory specification with each figure's source, editable.
5. **The card.** Case and paper label as on the home page (RAW until Documented, then the grade and its tier name), the owner's photo or the category picture, the Power Rating, the seven attributes as bars, the certification level, the rarity tier, the MiCar ID with the edition, and a chip for each modification fitted. The back carries the five-part grade.

Copy rules that stay true: the grade is free; foil follows the grade and is never for sale; a value is never printed on a collectible card and nothing in the engine knows a price; nothing that happens in a race touches the grade.

## Decisions

1. **One engine package, pure TypeScript.** `packages/engine`, source-only like `packages/brand`: no React, no DOM, no Node, no clock, no randomness. Callers pass the day, the timestamp, the ids and the seed. It compiles under the value app's TypeScript 7 flags (`verbatimModuleSyntax`, `erasableSyntaxOnly`, `noUnusedLocals`, `noUnusedParameters`) and the sim's TypeScript 5.9 (`strict`, `isolatedModules`, `lib: ES2020`). So: `import type` for types, no enums, no namespaces, no parameter properties, no `Array#at`, no `Object.hasOwn`, no `replaceAll`, no `structuredClone`.
2. **Three layers that never mix.** A. *Base stats*: the factory specification, scored. B. *Vehicle stats*: base plus this vehicle's modifications, wear and documented repairs. C. *The grade*: identity, paperwork, condition, originality, verification. The grade reads no attribute and no rating; the stats read no grade.
3. **A figure is never invented.** Every specification field is a value with its source (`manufacturer`, `agency`, `test`, `reference`, `owner`, `illustrative`) or it is null. A score made from a missing figure is either estimated by a documented rule and marked `estimated`, or left null and marked `unavailable`. The Power Rating is null until all seven attributes have a value; until then the card shows a provisional rating and says how many of seven it rests on.
4. **The seed catalogue is reference data.** Vehicles gathered from public sources on 2026-11-10 through web search, each figure with the publisher and URL the search gave. Page fetching was not available, so no figure was checked against a primary document. Every entry is `status: 'reference'` and every figure in it is `kind: 'reference'` with the publisher named. The interface says "reference data, not verified". Nothing in the catalogue is labelled manufacturer data. A figure the research could not source is left out, and the attribute that needs it is shown as not rated.
4a. **The EPA's vehicle file is agency data.** `apps/value/data/epa/vehicles.csv` is the EPA's own file, already kept in the repo by a monthly workflow. `scripts/build-epa-configs.ts` turns it into each model year's configurations and `engine/epaConfigs.ts` maps one onto specification fields with `kind: 'agency'`. Where the EPA's label does not settle a field (an automated manual, a hybrid's variable ratios, "4-Wheel or All-Wheel Drive") the field is left empty for the owner. The file has no fuel economy, power or weight.
5. **The brief's example is the calibration point.** Ruleset v1's tables are pinned so the reference specification of the 2024 Nissan GT-R NISMO scores exactly POWER 950, SPEED 920, ACCELERATION 880, HANDLING 880, DURABILITY 650, RELIABILITY 700, EFFICIENCY 500 and a Power Rating of 783. The specimen card shows those numbers stamped as illustrative; the catalogue card reaches them from the reference figures. The Power Rating is the weighted mean of the seven with equal weights, which is what makes 783.
6. **Uploads never change a specification and never verify anything.** A file moves a claim from `declared` to `documented` and no further. Only an attestation from a verifier in the registry the host supplies makes it `verified`. The Pages site ships an empty registry, so nothing there can reach Verified or Certified yet; the engine, the checklist and the tests are ready for inspectors, shops and providers.
7. **Ranked play reads only what is verified.** `vehicle` stats show everything recorded, each adjustment tagged with its evidence. `competition` stats are base plus verified modifications and verified wear only, so a car enters ranked races at its trim's baseline until something is verified. And the baseline itself has to be trusted: a ranked race takes a car only when its specification is the catalogue's own, figure for figure, or one a verifier attested, because otherwise the quickest way to win would be to type a bigger number. A specification an owner typed in races in free play. This keeps the plan's rule: racing never creates a reason to lie on the trail.
8. **The number on the label stays 1 to 10 with its ten tier names.** In the Garage it is issued by the five-part report: `grade10 = overall / 10`. The label reads RAW until the vehicle is Documented, which needs three documented records, the same rule that puts a card in the case today. The home page's simulator keeps its four-part demonstration formula and is not touched. Every snapshot carries its formula name (`micar-grade-v2`), and history is never rewritten.
9. **Certification maps onto states the product already has.** Registered is a parked raw card. Documented is the slabbed card on a self-reported trail with evidence attached. Verified keeps today's meaning: checked by an independent party. Certified adds an in-person inspection.
10. **Rarity and finish are two axes.** Finish stays earned by the grade (raw, standard, blue, holo, rainbow; unchanged thresholds). Rarity takes the seven names of the brief and describes how collectible this vehicle is from facts that are not performance: how many were built, its age, its certification level, how well preserved and original it is. Rarity takes no attribute as input. This supersedes the unbuilt five-rung ladder in `apps/value/docs/micar-garage-product-spec.md` line 21. One-of-One is never computed from a score: it needs a published build of one, or a verifier's attestation. A build number the owner typed in is shown on the sheet and moves nothing, or anyone could type a 1.
11. **Card races are a new mode on the web side.** Five modes scored from attributes. No `EventType`, no row in `EVENTS`, no payout rule and no physics changes in the sim. The plan's "racing as a stat-driven card game" comes back here; the Night Tuner spec's "supersedes" applies to the Strip.
12. **Modification cards are the card face of one catalogue.** The engine's catalogue uses the world's Garage vocabulary (engine, ECU, turbo, transmission, suspension, nitrous, tires, brakes, weight; tiers Street, Pro, Extreme) and adds supercharger, intake and exhaust, aero, off-road and economy setups. A modification changes specification figures (horsepower, torque, weight, economy, clearance) that are then scored by the same tables, plus stated points on the modelled indexes. Losses in reliability and durability scale with who installed it and whether upkeep is documented.
13. **Storage is the device, behind one module.** Passports in `localStorage`, files in IndexedDB, both private to the browser. One module owns it (`apps/value/src/garage/store.ts`, `files.ts`) so accounts can replace it. Export and import as JSON. Nothing is uploaded anywhere. Accounts stay off, as the open items say.
14. **Privacy is a projection.** The owner's view holds the VIN, files, notes, costs, shop names and exact days. `publicPassport()` is the only thing meant to leave the device: no VIN (only "VIN on file"), no owner ids (a count and a month), no file names or hashes, no notes, no costs, no shop names, days blurred to months, mileage rounded down to the thousand. A test serialises the public view and searches it for every private string.
15. **The MiCar ID is random.** `MC-XXXX-XXXX-XXXC`, Crockford base 32 with a check character, made from bytes the host supplies. It is never derived from the VIN (a VIN hash can be enumerated), and it does not change when the owner does.
16. **Tests gate the deploy without touching the workflows.** The engine's tests sit beside its modules. `apps/value/vite.config.ts` includes them in value's vitest run, so `pnpm --filter @micar/value test` runs them and they gate CI and Pages as value's own do. `pnpm --filter @micar/engine test` runs them alone.

## The engine

Files in `packages/engine/src`. `types.ts`, `util.ts`, `rules.ts` and `normalize.ts` exist; read them first. Every other module below is new. Modules import from each other by relative path without extensions. Each module opens with a plain comment saying what it is and why. Tests are `*.test.ts` beside the module, vitest with explicit imports, node environment, no mocks.

### `normalize.ts` — specification normalization (exists)

`scoreSpec(spec, options?)` returns seven `AttributeScore`s. The metric each attribute reads:

| Attribute | Metric | Without the figure |
| --- | --- | --- |
| POWER | output index = 0.7 x horsepower + 0.3 x torque (lb-ft) | horsepower alone, marked `estimated`; null without horsepower |
| SPEED | top speed, mph | estimated from power, class drag area and the class limiter, marked `estimated`; null without horsepower |
| ACCELERATION | 0 to 60, seconds | `k x (lb/hp)^0.75 x drivetrain factor`, marked `estimated`; null without horsepower and weight |
| HANDLING | grip index, g = skidpad figure + control term | grip modelled from class, weight and suspension grade, marked `modelled`; null without weight |
| DURABILITY | modelled points: class + frame + mass + drivetrain + clearance − engine stress | always `modelled`; null without weight |
| RELIABILITY | modelled points: base + induction + transmission + drivetrain + warranty − stress − many cylinders | always `modelled`; null until powertrain, induction and transmission type are known |
| EFFICIENCY | EPA combined MPG (MPGe when electric) | EPA's blend of city and highway when only those are on file; otherwise null |

`options.estimates: false` turns every `estimated` score into `unavailable`. `options.adjust` carries what modifications change outside the specification: `gripG`, `durabilityPoints`, `reliabilityPoints`, `sprintFactor`, `topSpeedFactor`. `powerRating`, `provisionalRating`, `layerOf`, `baseStats`, `illustrativeLayer`, `qualityOf`, `weakestQuality`, `qualityOfFields`, `specQuality` are exported from the same file.

### `specs.ts` — building and checking specifications

```ts
export function emptySpec(identity: VehicleIdentity): VehicleSpec                 // every field null
export function sourced<T>(value: T, source: Source): Sourced<T>
export const ownerSource: (asOf: string) => Source                                 // { kind: 'owner', asOf }
export type SpecIssue = { field: SpecField | 'identity'; reason: string }
export function checkIdentity(input: unknown, thisYear: number): Result<VehicleIdentity>
export function setSpecField(spec: VehicleSpec, field: SpecField, value: unknown, source: Source): { spec: VehicleSpec; issue: SpecIssue | null }
export function clearSpecField(spec: VehicleSpec, field: SpecField): VehicleSpec
export function parseSpec(input: unknown, thisYear: number): { spec: VehicleSpec | null; issues: SpecIssue[] }
export function bodyClassFromValueBody(name: string): BodyClass
export function bodyClassFromSimStyle(style: string): BodyClass
export const SPEC_FIELD_LABELS: Record<SpecField, string>                           // English, for forms and sheets
export const SPEC_FIELD_UNITS: Partial<Record<SpecField, string>>
export const SOURCE_KIND_LABELS: Record<SourceKind, string>
export const NUMERIC_FIELDS: readonly NumericSpecField[]
export const TEXT_FIELDS: readonly SpecField[]                                      // engine, transmission, suspension, brakes
export const CHOICE_FIELDS: Record<...>                                             // field -> its allowed values
export function sourceCounts(spec: VehicleSpec): Record<SourceKind, number>
```

Rules. Identity: year is a whole number from 1886 to `thisYear + 1`; make and model are 1 to 60 characters after `clipText`; trim up to 80, may be empty; body class is one of `BODY_CLASSES`. A numeric field must be a finite number inside its range in `SPEC_RANGES` (`rules.ts`); `cylinders` and `productionUnits` must be whole. A value outside its range is refused: the field stays as it was and an issue is returned. Nothing is clipped into range. Text fields are cleaned with `clipText` to 120 characters; empty text clears the field. A choice field must be one of its type's values. A source must have a known `kind`; `name` is clipped to 80, `url` kept only when it starts with `https://` or `http://` and is at most 300 characters, `asOf` kept only when `isIsoDate`, `note` clipped to 300. `parseSpec` reads a stored or imported specification field by field with the same checks; a bad field becomes null and an issue; a bad identity gives `spec: null`. `setSpecField` and `clearSpecField` return new objects and never touch their input.

`bodyClassFromValueBody`: 'Sedan' → sedan, 'SUV / Crossover' → suv, 'Pickup Truck' → pickup, 'Coupe / Sports' → coupe, 'Hatchback / Wagon' → hatchback, 'Minivan' → van, anything else → sedan. `bodyClassFromSimStyle`: sedan, coupe, hatchback, suv, van map to themselves, truck → pickup, sports → sports, anything else → sedan.

### `database.ts` and `data/` — the vehicle database

```ts
export const CATALOGUE: readonly CatalogueEntry[]                                    // data/catalogue.ts, generated from the research file
export function catalogueEntry(id: string): CatalogueEntry | null
export function findCatalogue(query: { year?: number; make?: string; model?: string; trim?: string }): CatalogueEntry[]
export function catalogueMatch(spec: VehicleSpec): CatalogueEntry | null
export type ExampleVehicle = { id: string; identity: VehicleIdentity; attributes: Attributes; note: string }
export const EXAMPLES: readonly ExampleVehicle[]                                     // data/examples.ts: the brief's two specimens
```

`findCatalogue` compares make and model without case or punctuation, treats `Chevy` as `Chevrolet`, and returns entries sorted by year (newest first) then trim. `catalogueMatch` returns the entry a specification is, figure for figure (the same identity and the same value in every field, whoever is named as the source), and null once anything is changed, added or removed: ranked play trusts the catalogue's own figures and nothing that only started as them. `data/catalogue.ts` is written by `packages/engine/scripts/build-catalogue.ts` (run through the value app's tsx) from the files in `packages/engine/data/research/`, the researchers' records kept as they came. The script maps each research key onto a specification field, keeps the publisher, URL and note, sets `kind: 'reference'` and the day gathered on every figure, drops prices, refuses any value `SPEC_RANGES` would refuse, and writes down in its own source every figure it leaves out and every grade it reads from a description. `EXAMPLES[0]` is the GT-R NISMO with the brief's seven values; `EXAMPLES[1]` is the Civic with illustrative values chosen so it is clearly below the GT-R in performance and above it in reliability and efficiency. Both notes say the values are placeholders and not verified manufacturer data.

### `condition.ts` — the condition engine

```ts
export const WEAR_LIFE: Record<WearSystem, { miles: number; years: number; consumable: boolean }>
export const WEAR_LOSS: Record<WearSystem, Partial<Record<AttributeKey, number>>>     // share of the attribute lost at full wear
export const WEAR_SYSTEM_LABELS: Record<WearSystem, string>
export function assessCondition(inputs: ConditionInputs): ConditionState
export function wearFactors(state: ConditionState | null, minEvidence: EvidenceLevel): { factors: Record<AttributeKey, number>; bySystem: { system: WearSystem; evidence: EvidenceLevel; factors: Partial<Record<AttributeKey, number>> }[] }
```

| System | Life | Consumable | Lost at full wear |
| --- | --- | --- | --- |
| engine | 200,000 mi or 25 years | no | POWER 12%, ACCELERATION 10%, SPEED 5%, RELIABILITY 25%, EFFICIENCY 10% |
| transmission | 150,000 mi or 20 years | no | ACCELERATION 5%, RELIABILITY 15%, EFFICIENCY 4% |
| suspension | 90,000 mi or 12 years | no | HANDLING 18%, DURABILITY 6% |
| brakes | 45,000 mi or 6 years | yes | HANDLING 8% |
| tires | 45,000 mi or 6 years | yes | HANDLING 12%, ACCELERATION 3%, EFFICIENCY 2% |
| body | 250,000 mi or 20 years | no | DURABILITY 30% |
| battery | 150,000 mi or 12 years | no | EFFICIENCY 8%, RELIABILITY 10%, POWER 5% |

Rules. A system's wear is `clamp(max(miles since new / life miles, years since new / life years), 0, 1)`. "Since new" is the vehicle's start (`<modelYear>-01-01`, odometer 0) unless a replacement or rebuild of that system is on record at `documented` or better, in which case it is that day and that odometer reading (a replacement with no mileage counts years only). With no mileage on file only the years count. The battery wears only when the powertrain is hybrid, plug-in hybrid or electric; otherwise its basis is `unknown`. Consumables are `unknown` (wear 0, no penalty) unless a documented replacement or an inspection gives them a state: a state nobody recorded is not assumed. Declared accident and title set a floor under body wear: Minor 0.25, Major 0.6, Rebuilt 0.5, Salvage 0.8. The newest inspection that reads a system overrides its wear with the inspector's figure, basis `inspected`, evidence `verified`. Evidence of modelled wear is the mileage reading's evidence; with years only, or for the accident and title floors, it is `declared`.

`wearFactors`: for each attribute, the product over systems of `1 − loss x wear^1.5`, taking only systems whose basis is not `unknown` and whose evidence is at least `minEvidence`. A factor is never above 1: wear lowers a score and nothing in this module raises one. A documented repair restores a system toward new and never past the base.

### `modifications.ts` — the modification engine

```ts
export type ModEffect = { horsepower: number; torque: number; weight: number; economy: number; sprint: number; topSpeed: number; clearanceIn: number; gripG: number; durability: number; reliability: number; originality: number }
export type ModDefinition = { category: ModCategory; name: string; summary: string; combustionOnly: boolean; group: 'tires' | 'induction' | null; tiers: readonly [ModEffect, ModEffect, ModEffect] }
export const MOD_TIER_NAMES: readonly ['Street', 'Pro', 'Extreme']
export const MODS: Record<ModCategory, ModDefinition>
export const INSTALL_FACTOR: Record<InstallQuality, number>                          // professional 0.75, owner 1, unknown 1.25
export const UPKEEP_FACTOR: Record<ActiveModification['upkeep'], number>             // documented 0.85, recent 1, lapsed 1.15
export function modLabel(category: ModCategory, tier: ModTier): string               // "Turbocharger kit · Pro"
export type ModRefusal = { eventId: string; category: ModCategory; reason: string }
export function resolveModifications(spec: VehicleSpec, mods: readonly ActiveModification[]): { applied: ActiveModification[]; refused: ModRefusal[] }
export function applyModifications(spec: VehicleSpec, mods: readonly ActiveModification[]): { spec: VehicleSpec; adjust: Required<ScoreAdjustments>; applied: ActiveModification[]; refused: ModRefusal[] }
export function originalityCost(mods: readonly ActiveModification[]): number
```

Effects per tier (Street / Pro / Extreme). Multipliers are 1 when not listed; additions are 0.

| Category | Name | Horsepower x | Torque x | Weight x | Economy x | 0-60 x | Top speed x | Clearance + in | Grip + g | Durability pts | Reliability pts | Originality |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| engine | Engine build | 1.08 / 1.16 / 1.25 | 1.06 / 1.12 / 1.20 | | 0.98 / 0.96 / 0.93 | | | | | −5 / −10 / −20 | −20 / −45 / −80 | 10 / 18 / 28 |
| ecu | ECU tune | 1.05 / 1.09 / 1.13 | 1.05 / 1.10 / 1.15 | | 1 / 0.99 / 0.97 | | | | | 0 / −5 / −10 | −10 / −25 / −45 | 4 / 6 / 8 |
| intake-exhaust | Intake and exhaust | 1.02 / 1.04 / 1.06 | 1.02 / 1.03 / 1.05 | 1 / 0.995 / 0.99 | | | | | | | 0 / −5 / −10 | 3 / 5 / 7 |
| turbo | Turbocharger kit | 1.25 / 1.45 / 1.70 | 1.25 / 1.45 / 1.65 | 1.01 / 1.015 / 1.02 | 0.94 / 0.90 / 0.85 | | | | | −15 / −30 / −50 | −60 / −100 / −150 | 18 / 26 / 35 |
| supercharger | Supercharger kit | 1.30 / 1.45 / 1.60 | 1.28 / 1.40 / 1.52 | 1.015 / 1.02 / 1.025 | 0.90 / 0.86 / 0.82 | | | | | −15 / −25 / −45 | −50 / −85 / −130 | 18 / 26 / 35 |
| nitrous | Nitrous | 1.10 / 1.18 / 1.28 | 1.10 / 1.18 / 1.28 | 1.005 / 1.008 / 1.01 | | | | | | −5 / −10 / −20 | −30 / −60 / −100 | 6 / 9 / 12 |
| transmission | Transmission and clutch | | | | | 0.98 / 0.96 / 0.94 | | | | 0 / 5 / 5 | 0 / −5 / −15 | 4 / 7 / 10 |
| suspension | Suspension | | | | | | | −0.3 / −0.6 / −1.0 | 0.02 / 0.04 / 0.06 | −5 / −15 / −30 | | 5 / 8 / 12 |
| tires | Performance tires | | | | 0.98 / 0.96 / 0.93 | 0.99 / 0.98 / 0.97 | | | 0.03 / 0.06 / 0.09 | −5 / −15 / −30 | | 2 / 3 / 4 |
| brakes | Brakes | | | | | | | | 0.005 / 0.01 / 0.02 | 0 / 5 / 5 | | 2 / 4 / 6 |
| weight | Weight reduction | | | 0.97 / 0.94 / 0.90 | | | | | | −10 / −25 / −45 | | 6 / 12 / 20 |
| aero | Aero | | | 1.002 / 1.004 / 1.006 | 0.995 / 0.99 / 0.98 | | 0.99 / 0.98 / 0.96 | | 0.01 / 0.02 / 0.04 | | | 3 / 5 / 8 |
| offroad | Off-road kit | | | 1.01 / 1.02 / 1.035 | 0.97 / 0.94 / 0.90 | 1.01 / 1.02 / 1.04 | 0.98 / 0.96 / 0.93 | 1 / 2 / 3.5 | −0.02 / −0.04 / −0.07 | 15 / 30 / 45 | 0 / −5 / −10 | 6 / 10 / 15 |
| eco | Economy setup | 0.99 / 0.98 / 0.97 | | | 1.03 / 1.05 / 1.07 | 1.01 / 1.02 / 1.03 | | | −0.01 / −0.02 / −0.03 | | 0 / 5 / 5 | 2 / 3 / 4 |

`combustionOnly` is true for engine, ecu, intake-exhaust, turbo, supercharger and nitrous. `group` is `induction` for turbo and supercharger and `tires` for tires, offroad and eco: within a group only one modification counts.

`resolveModifications`: keep the latest install per category (by `installedOn`, then `eventId`); refuse a combustion-only modification on an electric powertrain ("not for an electric powertrain"); within a group keep only the latest install and refuse the others ("replaced by a later fitment"); refuse everything else never. `applyModifications` works on the resolved list:

- horsepower, torque, curb weight and combined, city and highway economy are multiplied by the product of the tiers' multipliers; ground clearance gets the sum of additions. A null field stays null. A changed field keeps its source and gains `note: 'after modifications'`.
- when weight changes, economy is also multiplied by `1 + 0.6 x (share of weight removed)` (and the reverse when weight is added).
- 0 to 60, when on file, is multiplied by `((new lb / new hp) / (old lb / old hp)) ^ 0.75` when horsepower and weight are both on file. The tiers' 0-60 multipliers go to `adjust.sprintFactor`, so they apply to an estimated time too.
- top speed, when on file and not governed, is multiplied by `(new hp / old hp) ^ (1/3)`. A governed top speed is not raised by power. The tiers' top-speed multipliers go to `adjust.topSpeedFactor`.
- `adjust.gripG` is the sum of grip additions, plus `weight change in lb x HANDLING.model.gripPerLb` when the skidpad figure is on file (when it is not, the grip model reads the new weight itself).
- `adjust.durabilityPoints` and `adjust.reliabilityPoints` are the sums of the tiers' points, where each negative figure is first multiplied by `INSTALL_FACTOR[install] x UPKEEP_FACTOR[upkeep]`. Gains are not scaled.

More power also raises horsepower per litre, so the stress terms in DURABILITY and RELIABILITY charge for it through the same tables. `originalityCost` sums the applied tiers' originality figures, each multiplied by 0.6 when `verified`, 0.75 when `documented`, 1 when `declared`.

### `performance.ts` — the performance engine

```ts
export type StatsInputs = { spec: VehicleSpec; modifications?: readonly ActiveModification[]; condition?: ConditionState | null; options?: ScoreOptions }
export function vehicleStats(inputs: StatsInputs): VehicleStats
export function layerDelta(from: StatLayer, to: StatLayer): Record<AttributeKey, number | null>
```

`base = baseStats(spec, options)`. For the `vehicle` layer: apply all resolved modifications, score with their `adjust`, then multiply each attribute by its wear factor from `wearFactors(condition, 'declared')` and round. For the `competition` layer: the same with only the modifications whose evidence is `verified` and `wearFactors(condition, 'verified')`. `basis`, `inputs`, `missing` and `quality` of each score come from the scoring of the modified specification. Adjustments are itemised in order: modifications one at a time in install order (each delta is the score with that modification added minus the score before it), then each wear system. The deltas of a layer's adjustments add up exactly to that layer minus base, attribute by attribute; a null attribute has no deltas. With no modifications and no condition, all three layers are equal.

### `vin.ts` and `identity.ts`

```ts
// vin.ts
export function normalizeVin(input: string): string                                  // upper case, spaces and dashes removed
export type VinCheck = { format: 'standard' | 'pre-1981' | 'invalid'; checkDigit: 'valid' | 'invalid' | 'not-applicable'; modelYears: number[] }
export function checkVin(vin: string): VinCheck
export function vinMatchesYear(vin: string, year: number): boolean | null            // null when the VIN cannot say
export function maskVin(vin: string): string                                          // every character but the last four as a dot
// identity.ts
export function micarIdFromBytes(bytes: ArrayLike<number>): Result<string>           // needs at least 7 bytes
export function isMicarId(id: string): boolean
export function normalizeMicarId(input: string): string | null
```

A standard VIN is 17 characters from `0-9A-HJ-NPR-Z` (no I, O, Q). Check digit: position 9, transliteration A1 B2 C3 D4 E5 F6 G7 H8 J1 K2 L3 M4 N5 P7 R9 S2 T3 U4 V5 W6 X7 Y8 Z9, weights 8 7 6 5 4 3 2 10 0 9 8 7 6 5 4 3 2, sum mod 11, 10 written X. Model year: position 10, A is 1980 and 2010, B 1981 and 2011, through Y 2000 and 2030 (skipping I, O, Q, U, Z), then 1 to 9 for 2001 to 2009 and 2031 to 2039; `modelYears` lists the candidates. `pre-1981` is 5 to 16 characters from letters and digits: no check digit, no year. `vinMatchesYear` returns true when `year` is one of `modelYears`, false when it is not, and null for a VIN that is not standard.

The MiCar ID is `MC-` plus 12 characters in three groups of four: 11 characters of Crockford base 32 from the first 55 bits of the bytes, then one check character (the sum of the 11 values times the odd weights 1, 3, 5 ... 21, mod 32; odd weights mean any single wrong character changes the check). `normalizeMicarId` accepts lower case, missing dashes and the usual misreadings (O as 0, I and L as 1), and returns the canonical form or null when the check character is wrong.

### `passport.ts` — the vehicle passport

```ts
export function createPassport(input: { micarId: string; now: string; ownerId: string; spec: VehicleSpec; color?: string; vin?: string; eventId: string }): Result<Passport>
export function addEvent(passport: Passport, event: unknown, ctx: { now: string; by: string }): Result<Passport>
export function transferOwnership(passport: Passport, input: { eventId: string; toOwnerId: string; date: string; attachments?: Attachment[] }, ctx: { now: string; by: string }): Result<Passport>
export function updateSpec(passport: Passport, spec: VehicleSpec, ctx: { by: string }): Result<Passport>
export function updateVin(passport: Passport, vin: string, ctx: { by: string }): Result<Passport>
export function currentOwner(passport: Passport): string
export function everOwned(passport: Passport, id: string): boolean
export function timeline(passport: Passport): PassportEvent[]
export function eventById(passport: Passport, id: string): PassportEvent | null
export function mileageReadings(passport: Passport): { date: string; mileage: number; eventId: string }[]
export function latestMileage(passport: Passport, asOf: string): { value: number; date: string; eventId: string } | null
export function attachmentCount(passport: Passport, kinds?: readonly AttachmentKind[], subject?: PhotoSubject): number
export function latestDeclaration(passport: Passport, asOf: string): { condition: ConditionBand | null; accident: AccidentHistory | null; titleStatus: TitleStatus | null; originality: 'stock' | 'modified' | null }
export function appendSnapshot(passport: Passport, snapshot: GradeSnapshot): Passport
export function appendEdition(passport: Passport, edition: CardEdition): Passport
export function serializePassport(passport: Passport): string
export function parsePassport(input: unknown): Result<{ passport: Passport; dropped: number }>
export function checkAttachment(input: unknown): Attachment | null
export const EVENT_TYPE_LABELS: Record<PassportEventType, string>
```

Rules. Ids are supplied by the caller and must be new within the passport. `createPassport` checks the MiCar ID, writes the `registered` event and the first ownership period; the VIN is normalised and may be empty. `addEvent` is the owner's door: `ctx.by` must be the current owner; the type must be one of `OWNER_EVENT_TYPES` (an attestation or a void offered here is refused: "only a verifier can record this"); the date is a real day, not after the day of `ctx.now` and not before 1886-01-01; mileage is null or a whole number from 0 to 2,000,000; at most 20 attachments, each checked (id 1 to 40 characters, kind known, name clipped to 120, mime clipped to 80, size 0 to 200 MB, `sha256` 64 hex characters or null); title clipped to 120, note to 2000, shop and inspector to 120, parts and scope to 200; cost null or 0 to 10,000,000; visibility defaults to private. A modification removal must name in `undoes` an install of the same category that is on record and not already removed. Events are only ever appended: nothing edits or deletes one. `transferOwnership` closes the current period on `date`, opens the next, appends a `transfer` event, and keeps the MiCar ID, the events, the snapshots and the editions: the identity and the history stay with the vehicle. `updateSpec` and `updateVin` belong to the current owner and change no event.

`timeline` sorts by date, then `recordedAt`, then id. `parsePassport` reads stored or imported JSON field by field with the same checks; an event that fails is dropped and counted, and anything else that fails refuses the whole passport. `serializePassport(parsePassport(x))` round-trips.

`publicPassport` lives in `verification.ts` because it needs to know what is verified.

### `verification.ts` — verifiers, attestations, evidence

```ts
export const EMPTY_REGISTRY: VerifierRegistry
export const ATTESTATION_VALID_MONTHS: Record<AttestationScope, number | null>
export const ATTESTATION_SCOPE_LABELS: Record<AttestationScope, string>
export const VERIFICATION_REFUSALS: { readonly [reason: string]: string }
export type AttestationStatus = { eventId: string; attestation: Attestation; valid: boolean; weight: number; reason: string }
export type Standing = { day: string; statuses: AttestationStatus[]; attestations: AttestationStatus[]; voided: string[]; events: PassportEvent[] }
// in types.ts:
//   type SignatureCheck = (payload: string, signature: string, verifier: Verifier) => boolean
//   type VerifierRegistry = { verifiers: Verifier[]; checkSignature?: SignatureCheck }
export function standingOf(passport: Passport, registry: VerifierRegistry, asOf: string): Standing
export function attestationSubject(passport: Passport, scope: AttestationScope): string
export function subjectFingerprint(passport: Passport, scope: AttestationScope): string | null
export function attestationPayload(passport: Passport, attestation: Attestation): string
export function recordAttestation(passport: Passport, attestation: unknown, registry: VerifierRegistry, ctx: { now: string; eventId: string }): Result<Passport>
export function voidEvent(passport: Passport, input: { target: string; reason: string; attestationId: string }, registry: VerifierRegistry, ctx: { now: string; eventId: string }): Result<Passport>
// Each query takes a standing already worked out as an optional last argument.
export function attestationStatuses(passport: Passport, registry: VerifierRegistry, asOf: string, standing?: Standing): AttestationStatus[]
export function validAttestations(passport: Passport, registry: VerifierRegistry, asOf: string, scope?: AttestationScope, standing?: Standing): AttestationStatus[]
export function voidedEventIds(passport: Passport, registry: VerifierRegistry, asOf: string, standing?: Standing): string[]
export function eventEvidence(passport: Passport, eventId: string, registry: VerifierRegistry, asOf: string, standing?: Standing): EvidenceLevel
export function standingReadings(passport: Passport, registry: VerifierRegistry, asOf: string, standing?: Standing): { date: string; mileage: number; eventId: string; evidence: EvidenceLevel }[]
export function documentedRecords(passport: Passport, registry: VerifierRegistry, asOf: string, standing?: Standing): PassportEvent[]
export function activeModifications(passport: Passport, registry: VerifierRegistry, asOf: string, standing?: Standing): ActiveModification[]
export function conditionInputs(passport: Passport, registry: VerifierRegistry, asOf: string, standing?: Standing): ConditionInputs
export function publicPassport(passport: Passport, registry: VerifierRegistry, asOf: string, standing?: Standing): PublicPassport
```

**When an attestation counts.** On `asOf`, all of these hold: its verifier is in the registry and `active`; the verifier's `scopes` include its scope; the verifier's id is not, and never was, an owner of this passport; the entry that carries it names the verifier as its author and carries the attestation's own day and reading (so nothing can be claimed by dressing the entry up); it has what its scope attests (a reading for `mileage`, a score for `condition`, at least one record for `documentation` and `modification`); its date is not after `asOf`; it is inside its validity window; what it attested has not changed since; the registry's `checkSignature`, when there is one, accepts its signature; and its verifier has not taken it back. Windows in months: identity, specification and one-of-one never lapse; mileage 12; documentation, originality and modification 24; condition 24, at full weight for the first 12 and half weight after. `weight` is 1, 0.5 or 0, and every status that does not count carries the reason from `VERIFICATION_REFUSALS`.

**What an attestation is bound to.** `attestationSubject` is the part of the passport a scope speaks for: the VIN and the year, make and model for `identity` and `one-of-one`; the whole specification for `specification`; nothing for the others, which are bound by the records they name, the figure they carry, or their date. `recordAttestation` stores an eight-character fingerprint of the subject in `attestation.subject` (whatever the caller sent there is ignored). When the passport no longer matches it, the attestation stops counting with the reason "what was attested has changed since": an owner who corrects the VIN or raises a figure after verification is no longer verified, and is again if the passport is put back exactly as attested.

**Signatures.** `attestationPayload` is the exact text a verifier signs: a version tag, the vehicle's MiCar ID, every field of the attestation but `subject` and `signature`, the subject text, and every record the attestation names exactly as the passport holds it, as canonical JSON (keys sorted, so the text is the same however the data was built or stored). A signature over it cannot be moved to another vehicle and stops checking when the attestation, its subject or a record it confirmed is altered or deleted. `checkSignature` answers at once; a host whose cryptography is asynchronous checks ahead of time and answers from what it found. A checker that throws counts as a signature that does not check.

**What a passport file can and cannot prove.** A passport kept on its owner's device is the owner's to edit. With a checker in the registry, every attestation that counts is one its verifier really signed, for this vehicle, saying exactly this, about records untouched since. Without one, the host is vouching for where the passport is kept. Either way a holder can leave things out (a poor inspection, a withdrawal): only a store the owner cannot write to can prove nothing is missing. That store arrives with accounts; until then the site ships `EMPTY_REGISTRY` and nothing can be Verified.

**Recording.** `recordAttestation` is the only way an attestation enters a passport. It refuses one with a bad shape (`conditionScore` 0 to 100, system wear 0 to 1, mileage as in events, at most 200 event ids, note clipped to 500, `subject` eight hex characters or null), one that lacks what its scope attests, one that names a record not on the passport (a `documentation` attestation confirms an owner's entries; a `modification` one confirms modification entries), and one that would not count on the day it is recorded.

**Withdrawing.** `voidEvent` appends a `void` entry; nothing is removed. A record is withdrawn by a verifier holding a `documentation` attestation that counts today (`attestationId` names it). An attestation is taken back only by the verifier who made it (`attestationId` is its own id); a records attestation does not let one verifier withdraw another's attestation. A withdrawal stands when its authority counted on the day it was made and had not itself been taken back, and it then stands for good: a false receipt does not come back when the attestation that authorised its withdrawal lapses two years later. A verifier removed from the registry takes everything it did with it. The registered entry, transfers and withdrawals cannot be withdrawn.

**Evidence.** `eventEvidence`: `verified` when the entry is an attestation that counts, a `documentation` attestation that counts names it, or a `modification` attestation that counts names it and it is a modification; otherwise `documented` when the entry has at least one attachment; otherwise `declared`. An entry that was withdrawn, is dated after `asOf` or is not on the passport has no standing and reads `declared`. A reading has its own evidence (`standingReadings`, and the mileage in `conditionInputs`): `verified` when a verifier read it (the attestation's own entry) or confirmed the record that carries it, or when an owner's reading was taken the same day as a mileage attestation and is within 100 miles of it. An old entry that happens to show a similar figure is not verified, and an owner's reading never makes the entry itself verified.

`standingOf` is the single definition of what stands on a day: entries dated on or before it, not withdrawn, and, for an attestation, one that counts. `documentedRecords`: standing entries of type maintenance, repair, inspection, restoration, modification or document that have a file of their own. The same file attached to several records documents one of them: copies are told apart by fingerprint (`sha256`), and a record whose every file was already counted on an earlier record is left out. The grade counts photographs the same way, so the four exterior photographs are four different files. A file with no fingerprint cannot be compared and counts. `activeModifications`: standing installs that no standing removal undoes, with their evidence and `upkeep` (`documented` when a maintenance entry with an attachment is dated after the install and within the 12 months before `asOf`; else `recent` when the install is less than 12 months old; else `lapsed`). `conditionInputs`: the latest standing reading with its evidence; repairs whose `work` is replacement or rebuild and whose `system` is set, with their evidence; inspection readings from `condition` attestations that count; the latest standing declaration of accident and title.

`publicPassport` is the projection in decision 14, over what stands. An entry's title is the owner's when the entry is public, otherwise `EVENT_TYPE_LABELS[type]`; an attestation shows that it is one and its `scope`, and nothing of what it said. `verified` is `eventEvidence(...) === 'verified'`. Grade snapshots and card editions are given by month, without id or reason. Withdrawals and withdrawn entries are left out.

### `grading.ts` — the grading engine

```ts
export const GRADE_FORMULA = 'micar-grade-v2'
export const GRADE_WEIGHTS: Record<GradeCategoryKey, number>                         // identity .20, documentation .25, condition .25, originality .15, verification .15
export const GRADE_CATEGORY_LABELS: Record<GradeCategoryKey, string>
export const TIER_NAMES: readonly string[]                                           // '', Parts, Project, Rough, Worn, Daily, Driver, Clean, Garage-kept, Concours, Showroom
export function gradeFacts(passport: Passport, registry: VerifierRegistry, asOf: string, standing?: Standing): GradeFacts
export function gradePassport(passport: Passport, registry: VerifierRegistry, asOf: string, facts?: GradeFacts): GradeReport
export function snapshotOf(report: GradeReport, level: CertificationLevel, ctx: { id: string; at: string; reason: string; events: number }): GradeSnapshot
```

Each category is the sum of its items, clamped to 0 to 100 and to its cap. Item ids and labels are fixed (the apps translate the labels).

**Identity and authenticity.** `id.vehicle` "Year, make and model on record" 10. `id.vin` "VIN recorded and well formed" 15 for a standard VIN with a valid check digit, 10 for a pre-1981 VIN on a vehicle older than 1981, else 0. `id.vin-year` "VIN agrees with the model year" 5. `id.vin-photo` "Photo of the VIN plate" 5 (a photo event with subject `vin-plate` and an attachment). `id.papers` "Title or registration on file" 10 (a document event of that kind with an attachment). `id.title` "Title status declared" 5 for Clean, 2 for Rebuilt, 0 for Salvage or undeclared. `id.photos` "Exterior photographed from four sides" 5 (four exterior photo attachments). `id.verified` "Identity verified by an independent party" 45 (a valid `identity` attestation). Discrepancies: `vin-check-digit` when a 17-character VIN fails its check digit; `vin-year-mismatch` when `vinMatchesYear` is false.

**Documentation and history.** `doc.records` "Documented records" `min(n, 12) / 12 x 40`, n = `documentedRecords`. `doc.span` "Months of history covered" `min(m, 24) / 24 x 25`, m = months from the earliest to the latest documented record. `doc.receipts` "Receipts or invoices attached" 10. `doc.photos` "Photographs attached" 10. `doc.mileage` "Mileage log consistent" 10 with two or more readings on different days that never go down, 4 with one reading, 0 when a later reading is lower than an earlier one (discrepancy `odometer-rollback`). `doc.ownership` "Ownership chain documented" 5 when there has been one owner, or every transfer has an attachment. Each of the owner's records a verifier has withdrawn takes 10 off, up to 30 (discrepancy `voided-record`). An attestation its own verifier took back is not held against the owner: it simply no longer counts. The grade reads the owner's declarations from what stands, so a withdrawn declaration is ignored and the one before it speaks again.

**Physical condition.** With a valid `condition` attestation: the inspector's `conditionScore`; capped at 85 when the attestation is at half weight. Otherwise the declared band (Excellent 100, Good 75, Fair 50, Poor 25, undeclared 0) less the declared accident (Minor 20, Major 40), capped at 60, or at 75 with the photo set (four exterior, one interior, one odometer). Items: `cond.declared`, `cond.photos`, `cond.inspected`.

**Originality and modifications.** Undeclared (no declaration of originality and no modification on record): 50, cap 50. Otherwise 100 less `originalityCost(activeModifications)`, less 10 for each restoration not done with OEM parts (up to 20); capped at 85 without a valid `originality` attestation. Items: `orig.declared`, `orig.modifications`, `orig.restoration`, `orig.verified`.

**Verification.** Only from valid attestations: `ver.identity` 30, `ver.mileage` 10, `ver.documentation` 20, `ver.condition` 25 times its weight, `ver.originality` 15. Nothing an owner uploads or declares reaches this category.

`overall` is the weighted sum, one decimal. `grade10 = max(1, round1(overall / 10))`. `tier` is 10 when `grade10 >= 9.75`, otherwise `max(1, floor(grade10))`. The report reads no attribute and no rating.

### `certification.ts` — certification levels

```ts
export const LEVEL_LABELS: Record<CertificationLevel, string>
export const LEVEL_SUMMARIES: Record<CertificationLevel, string>
export function certify(passport: Passport, report: GradeReport, registry: VerifierRegistry, asOf: string, facts?: GradeFacts): CertificationResult
export function isSlabbed(level: CertificationLevel): boolean                        // documented or better
```

| Level | Requirements |
| --- | --- |
| Registered | `reg.vehicle` year, make and model on record; `reg.owner` an owner on record |
| Documented | `doc.vin` a well-formed VIN with no VIN discrepancy; `doc.records` three documented records; `doc.photos` four exterior photographs; `doc.mileage` a mileage reading; `doc.clean` no odometer rollback and no voided record; `doc.scores` Identity at least 40 and Documentation at least 30 |
| Verified | `ver.identity` identity verified by an independent party; `ver.second` mileage or records verified by an independent party; `ver.score` Verification at least 40 |
| Certified | `cert.inspection` an in-person condition inspection in the last 12 months; `cert.originality` originality verified; `cert.records` records verified; `cert.scores` every category at least 60 and Verification at least 85 |

A level is held when its requirements and every lower level's are met. `requirements` lists all four levels' requirements with `met` and a `detail` that says where things stand ("2 of 3"). A passport that somehow fails Registered is still reported as `registered` with the unmet requirement shown.

### `cards.ts` — the card generator

```ts
export const RARITY_LABELS: Record<RarityTier, string>
export const EDITION_NAMES: Record<CertificationLevel, string>                       // Registration Edition, Documented Edition, Verified Edition, Certified Edition
export function rarityOf(input: { productionUnits: Sourced<number> | null; specificationAttested?: boolean; modelYear: number; asOf: string; level: CertificationLevel; originality: number; condition: number; oneOfOneAttested: boolean }): Rarity
export function buildNumberCounts(productionUnits: Sourced<number> | null, specificationAttested?: boolean): boolean
export function finishOf(grade: { grade10: number; tier: number }, slabbed: boolean): { finish: CardFinish; foil: number }
export type Assembly = { asOf: string; stats: VehicleStats; report: GradeReport; certification: CertificationResult; rarity: Rarity; card: CollectibleCard; condition: ConditionState; modifications: { applied: ActiveModification[]; refused: ModRefusal[] } }
export function assemble(passport: Passport, registry: VerifierRegistry, asOf: string): Assembly
export function issueEdition(passport: Passport, registry: VerifierRegistry, ctx: { now: string; reason: string }): Passport
export function recordSnapshot(passport: Passport, registry: VerifierRegistry, ctx: { now: string; id: string; reason: string }): Passport
export function exampleCard(example: ExampleVehicle, asOf: string): CollectibleCard
export function catalogueCard(entry: CatalogueEntry, asOf: string): CollectibleCard
```

Rarity score = scarcity + age + provenance + preservation. *Scarcity* (0 to 40) from a build number that counts (`buildNumberCounts`: its source is a manufacturer, an agency, a test or a reference listing, or a verifier attested the specification; an owner's own figure scores 0 and the factor says so): up to 99 units 40; up to 999, 34; up to 4,999, 27; up to 19,999, 20; up to 99,999, 12; up to 499,999, 5; more or unknown, 0. *Age* (0 to 15) in years from the model year: 40 or more 15; 25 or more 11; 15 or more 6; 10 or more 3. *Provenance* (0 to 30): Registered 0, Documented 10, Verified 20, Certified 30. *Preservation* (0 to 15): Originality at least 90 gives 8, at least 80 gives 4; Physical condition at least 85 gives 7, at least 70 gives 3. Tiers: under 10 Common, 10 to 24 Uncommon, 25 to 39 Rare, 40 to 54 Epic, 55 to 69 Legendary, 70 and over Mythic. One-of-One only when a build number that counts is 1, or `oneOfOneAttested` (a valid `one-of-one` attestation). `assemble` works the passport's standing out once, hands it to every engine, and reports `specificationAttested`. The function takes no attribute and no rating, so performance cannot move rarity.

`finishOf` keeps the home page's rule: `raw` until slabbed, then `rainbow` at tier 10, `holo` at 9, `blue` at 7 and 8, `standard` below; `foil = clamp((grade10 − 6) / 4, 0, 1)`.

`assemble` is the one call an app needs: it runs the queries, the condition engine, the performance engine, the grade, the certification and the rarity, and builds the card. The card shows the `vehicle` layer with each attribute's delta from base; `quality` is `verified` when a valid `specification` attestation exists, otherwise the weakest source in the specification; `photoAttachmentId` is the first attachment of the newest exterior photo; `serial` is the MiCar ID, ` · E`, and the edition number. `issueEdition` appends an edition when the passport has none, or the level or the rarity tier differs from the last edition; otherwise it returns the passport unchanged. `recordSnapshot` appends a snapshot unless overall, the five scores and the level all equal the last one's. `exampleCard` builds an illustrative card (level registered, rarity common, `illustrative: true`, `quality: 'illustrative'`). `catalogueCard` builds a house card from base stats (level registered, rarity from the build number and age alone).

### `game.ts` — the game engine

```ts
export type RaceModeRule = { name: string; blurb: string; weights: Partial<Record<AttributeKey, number>> }
export const RACE_MODE_RULES: Record<RaceMode, RaceModeRule>
export const LUCK_SPREAD = 0.04
export const RACE_CLASSES: readonly { id: 'D' | 'C' | 'B' | 'A' | 'S' | 'X'; name: string; min: number }[]
export function raceClassOf(powerRating: number | null): 'D' | 'C' | 'B' | 'A' | 'S' | 'X' | null
export function terrainFactor(mode: RaceMode, entrant: RaceEntrant): number
export function race(mode: RaceMode, entrants: readonly RaceEntrant[], seed: number, options?: { ranked?: boolean }): RaceResult
export const SERIES_POINTS: readonly number[]                                        // 10, 6, 4, 3, 2, 1
export type SeriesResult = { seed: number; races: RaceResult[]; standings: { id: string; name: string; points: number; wins: number }[]; championId: string | null }
export function series(entrants: readonly RaceEntrant[], seed: number, options?: { modes?: readonly RaceMode[]; ranked?: boolean }): SeriesResult
export function entrantFromLayer(input: { id: string; name: string; spec: VehicleSpec; layer: StatLayer; basis: StatsBasis; trusted?: boolean }): RaceEntrant
export type SetupCard = { id: string; category: ModCategory; tier: ModTier; name: string; cost: number }
export const SETUP_BUDGET = 6
export const SETUP_CARDS: readonly SetupCard[]                                       // one per category and tier; cost is the tier
export function checkSetup(spec: VehicleSpec, cardIds: readonly string[]): Result<SetupCard[]>
export function entrantWithSetup(input: { id: string; name: string; spec: VehicleSpec; cardIds: readonly string[] }): Result<RaceEntrant>
export function pickRivals(player: RaceEntrant, pool: readonly RaceEntrant[], count: number, seed: number): RaceEntrant[]
```

| Mode | Name | Weights |
| --- | --- | --- |
| drag | Drag Race | ACCELERATION 0.45, POWER 0.35, SPEED 0.20 |
| circuit | Circuit Race | HANDLING 0.45, ACCELERATION 0.30, SPEED 0.25 |
| endurance | Endurance | RELIABILITY 0.40, DURABILITY 0.35, EFFICIENCY 0.25 |
| economy | Economy Challenge | EFFICIENCY 0.65, RELIABILITY 0.35 |
| offroad | Off-Road | DURABILITY 0.40, HANDLING 0.30, RELIABILITY 0.30 |

`rawScore` is the weighted sum of the mode's attributes. `terrain` is 1 except off-road, where it is the drivetrain factor (4WD 1, AWD 0.9, RWD 0.72, FWD 0.68, unknown 0.8) times the clearance factor (`clamp(0.8 + (inches − 5) x 0.04, 0.8, 1.05)`; with no clearance on file the class's default: offroad 1, pickup 0.97, suv 0.92, wagon 0.88, van 0.85, sedan and hatchback 0.84, coupe 0.82, sports 0.8). `luck` is `1 + (r − 0.5) x 2 x LUCK_SPREAD` with `r` from `mulberry32(hashString(seed + '|' + mode + '|' + id))`, so it does not depend on the order of the entrants. `score = rawScore x terrain x luck`, kept to one decimal. Order: score, then rawScore, then id. An entrant missing an attribute the mode needs is excluded with the reason ("no EFFICIENCY rating"). A ranked race also excludes any entrant whose basis is `vehicle` or `setup` ("ranked races run on verified stats"), and any entrant that is not `trusted` ("ranked races need a specification from the catalogue or one a verifier attested"). `trusted` is false unless the host says otherwise; the Garage sets it when `catalogueMatch(spec)` finds the catalogue entry the specification is, figure for figure, or when `assemble` reports `specificationAttested`. A setup that the vehicle cannot take is refused in words of its own ("one of those cards is not for an electric powertrain", "two of those cards cannot be fitted together"). Classes by Power Rating: D under 450, C from 450, B from 550, A from 650, S from 750, X from 850. `series` runs each mode with seed `seed + index`, gives `SERIES_POINTS` by position, and breaks ties by wins, then total score, then id.

A setup is free play: at most one card per category, total cost within `SETUP_BUDGET`, and the catalogue's own refusals apply. `entrantWithSetup` turns the cards into modifications (install `professional`, upkeep `recent`, evidence `declared`), runs `applyModifications` and `scoreSpec`, and returns an entrant with basis `setup`. `pickRivals` takes from the pool the entrants in the player's class (falling back to the nearest by Power Rating), leaves the player out, and picks `count` with the seed.

The game reads attributes, drivetrain, clearance and class. It never reads a grade, a rarity or a value.

### `index.ts`

Re-exports everything public from every module. The README (`packages/engine/README.md`) documents every table and formula in words, with the calibration table of the catalogue, for outside developers.

## The Garage (apps/value)

`apps/value/src/garage/`. Door-family styling: the page is wrapped in `<div className="dp gar">` so the slab's styles apply; new rules go in `garage.css` under `.dp.gar` with class names prefixed `gar-`. No Tailwind utilities inside. Phones first: 44px tap targets at 720px and under, no horizontal scroll at 375px. Every string goes through `t()` or `tx()` with a Spanish entry ("usted", the existing dealer vocabulary). Labels that come from the engine's tables reach `t()` through a variable, so those tables are added to the `keys` list in `i18n.test.ts`.

- `route.ts`: `view: 'garage'` for `#/garage` and `#/garage/<id>`; the branch sits before the legacy query rule. `main.tsx` renders `<Garage code={...} />`.
- `car/record.ts`: `garageUrl(id?)` beside the other URL helpers.
- `garage/store.ts`: the garage's state and the only code that touches `localStorage` (key `micar.garage.v1`). `loadGarage(storage, makeOwnerId)`, `saveGarage(storage, state)`, and pure actions that wrap the engine (`park`, `record`, `transfer`, `replaceSpec`, `replaceVin`, `removeCar`, `importGarage`, `exportGarage`). After every change it appends a grade snapshot if the grade moved and prints a new edition if a milestone was reached. Storage is injected so tests pass a fake. A read that fails validation never throws: the bad passport is skipped and counted, and the unreadable save is set aside under `micar.garage.unreadable`. `importGarage` replaces a car already parked only with a copy that continues it (every entry here, untouched and in place, and more after them), so a file can never overwrite a history with a different one. `useGarage.ts` holds the state in React, hands actions the garage as it is now rather than as a render saw it, and takes up what another tab of the site saves.
- `garage/files.ts`: files in IndexedDB (`micar-garage`, store `files`), keyed by attachment id, with a memory fallback when IndexedDB is missing or blocked; SHA-256 through `crypto.subtle` when present.
- `garage/ids.ts`: random bytes from `crypto.getRandomValues` for MiCar IDs, Garage IDs and event ids, and the device's wall clock written as a timestamp (the passport's days are the days on the owner's calendar).
- `garage/Garage.tsx` (page), `Park.tsx` (the three steps), `SpecForm.tsx`, `CollectibleCard.tsx`, `StatsPanel.tsx`, `GradePanel.tsx`, `PassportPanel.tsx`, `ModsPanel.tsx`, `RacePanel.tsx`, `Examples.tsx`, `useGarage.ts`.
- `garage/es-*.ts`: the Garage's Spanish, one table per part, joined in `garage/es.ts` and spread into the site's table. `garage/es.test.ts` covers the labels that reach `t()` through a table, here or in the engine.

`/garage/` keeps its generated page and its footer; the template gains a script that forwards to `../#/garage` and the body copy becomes a link for readers without scripts.

## MiCar World (apps/sim)

One small, safe use of the same engine, so a card and the world cannot disagree about a car: `apps/sim/src/world/cardStats.ts` turns the sim's `CarSpec` row into an engine specification (`kind: 'reference'` for a real model, `illustrative` for a body-style stand-in) and returns the base layer; a `CardStats` component prints the seven attributes and the rating on the owned-car tile in the lot tab. It renders no element with both `grid` and `grid-cols-12` (the smoke test counts those), touches no Strip code, no `EVENTS`, no Garage stat panel and no server code. `CarSpec` has no fuel economy, no transmission and no word on forced induction, so EFFICIENCY and RELIABILITY show as not rated and the rating as provisional, five of seven.

## Errors

- Storage missing, blocked or full: the Garage renders, says "This browser is not keeping the garage", and keeps working in memory. Nothing throws.
- A stored passport that fails validation is skipped and counted: "1 saved car could not be read and was left untouched". The raw value stays in storage under a quarantine key.
- A file too large (over 25 MB) or of a type that is not an image or a PDF is refused with the reason, before anything is stored.
- An unknown `#/garage/<id>` shows "This garage has no car with that ID" and a link back.
- An import that is not a garage export changes nothing and says so.
- A specification figure outside its range is refused at the field with the range.
- A race with fewer than two starters shows who was excluded and why.

## Tests

`packages/engine/src/*.test.ts`, run by both `pnpm --filter @micar/engine test` and `pnpm --filter @micar/value test`:

- `normalize.test.ts`: the GT-R NISMO reference specification scores the brief's seven values and 783; the Civic scores below it in the four performance attributes and above it in reliability and efficiency; every table is monotonic; a missing figure gives `estimated` or `unavailable` and never a value with basis `measured`; `estimates: false`; the rating is null with any attribute missing; scoring does not change its input.
- `specs.test.ts`, `database.test.ts`: range refusals, source cleaning, round trips, every catalogue entry passes `parseSpec` unchanged and carries only `reference` sources, lookups.
- `condition.test.ts`, `modifications.test.ts`, `performance.test.ts`: wear never raises a score; a documented replacement restores toward base and never past it; a declared replacement restores nothing; every modification's trade-off shows up in the scores; install quality and upkeep scale the losses; a turbo on an electric car is refused; layers are equal with nothing recorded; deltas add up; `competition` ignores declared and documented claims.
- `vin.test.ts`, `identity.test.ts`, `passport.test.ts`, `verification.test.ts`: check digits on known VINs; id round trips; an owner cannot write an attestation; an attestation from an unknown, inactive or owning verifier is not valid; one written into the file by hand does not count; expiry windows; an attestation stops counting when what it attested changes; signatures cannot be moved to another vehicle and stop checking when the attestation or a record it confirmed is altered; withdrawals (who may, that they stand for good, that they cannot be faked); a reading is verified only when a verifier read it; append-only; identity survives a transfer; the public view contains none of the private strings; `parsePassport` round trip and tolerance.
- `grading.test.ts`, `certification.test.ts`: each item's points; caps; adding a receipt changes Documentation and no attribute; nothing an owner can do moves Verification; the grade is the same for two passports with different specifications; each level's requirements; a rollback blocks Documented.
- `cards.test.ts`: rarity ignores performance (same inputs, different specifications, same tier); One-of-One only by a published build number or attestation, never by a figure the owner typed; a specification attestation stops vouching once the specification is changed; editions append and earlier ones stay; snapshots append and are not duplicated; the example card carries the brief's values.
- `game.test.ts`: the same seed gives the same result in any entrant order; the GT-R wins drag and circuit, the Civic and the Prius beat it in economy, the trucks win off-road; ranked refuses `vehicle` and `setup`, and a car whose specification is only its owner's word; setup budget and exclusions; no import from a valuation module anywhere in the package (a source scan).

`apps/value/src/garage/*.test.ts`: `route.test.ts` cases for the new route; `store.test.ts` with a fake storage (round trip, quarantine, parking, writing, editions at a milestone, a sale from one garage to another, import refusal, an import that continues a history and one that would overwrite it); the Spanish coverage test covers the new strings and tables. `apps/value/src/footer.test.ts` is updated for the door and footer link no longer being "soon". `apps/sim/src/world/cardStats.test.ts`: a model with a `CarSpec` row gets five scores and a provisional rating, the mapping keeps `kind: 'reference'`, and nothing the table lacks is filled in.

Before merge: `pnpm --filter @micar/engine test`, `pnpm --filter @micar/value test`, `pnpm --filter @micar/sim test`, `pnpm --filter @micar/sim exec tsc --noEmit`, `pnpm --filter @micar/sim build`, `pnpm site`, then a browser pass at 375px and desktop in both languages.

## Out of scope

- Accounts and a server-side store. The open items forbid turning accounts on until there is a persistent disk or a hosted database; the store module is the seam.
- Real verifiers. The registry, the attestation format and the signature hook exist; no inspector, shop or provider is connected.
- NFT minting. Nothing in the engine or the Garage needs a chain. A card edition is plain data and could be minted later by a separate module.
- Changing the home page's grade simulator, its copy or its formula.
- New Strip events, payouts in Octane, or card races on the sim server.
- An HTTP API on the sim server. The package's exported functions are the API.
- Widening the EPA workflow to keep fuel-economy columns (the committed file has none, so EFFICIENCY still needs a figure from the catalogue or the owner), and a per-trim specification file for all 847 models.
