# Component data policy

Rules for everything in `src/components/`. They exist so the library can grow without ever presenting an invented fact as a real one.

## Three different things, never mixed

| Concept | Question it answers | Where it lives |
|---|---|---|
| **A. Catalogue evidence** | Where does this catalogue fact come from? | `EvidenceRecord.origin` + `SourceRef` (`provenance.ts`) |
| **B. Verification status** | Has anyone reviewed that evidence against its source? | `ReviewRecord.status`: `unverified`, `source-reviewed`, `cross-checked` |
| **C. Simulation input origin** | Where did a number typed into a simulation come from? | The simulator's own `DataSource` (`user-specified` / `illustrative-fixture`, `src/sim/loads.ts`) |

C is owned by the simulator, is unchanged, and is deliberately not modelled in the library. A catalogue record never carries a `DataSource`, and a simulation never reads catalogue evidence.

## Rules

1. **No invented facts.** No made-up part numbers, ratings, dimensions, pinouts, prices, certifications or datasheet claims. Test fixtures use obviously fictional names and the reserved `.invalid` domain.
2. **Generic definition is not a product.** A `ComponentDefinition` describes a kind of part ("Resistor"). Exact products are `ManufacturerPart` records. A generic definition may not claim `manufacturer-datasheet` evidence (validated).
3. **Manufacturer records need traceable evidence:** publisher, title, an https link to the official document, a page, and a revision or retrieval date. Validation rejects anything less.
4. **A datasheet is a manufacturer-published specification.** It is not independent physical verification. Only the review status records whether a named person compared the record with the source; a cross-check needs two different named reviewers. New records start `unverified`.
5. **Each value carries its own evidence.** One datasheet page supports one number, not the whole part.
6. **Representative 3D models carry no dimensions.** Sizes are never derived from capacitance, voltage or any other electrical value. Real geometry must come from manufacturer documentation (`manufacturer-geometry`).
7. **Third-party symbol and 3D assets need a licence check.** `origin: 'third-party'` requires a recorded `licence`; no such asset is shipped yet.
8. **Missing information stays explicitly missing.** Optional fields are left absent; nothing is filled with a plausible default.
9. **Simulatable only via an existing adapter.** `simulatable` requires a known adapter id and the `one-port-load` port. Having a definition never makes a part simulatable. The one-port limit (a load across the machine output, not placeable in a circuit) is stated in each record's limitations.
10. **Illustrative and user-provided values stay identifiable.** Educational text is `illustrative-educational`; values supplied by a person are `user-provided`; neither is presented as manufacturer data.
11. **Units are explicit.** Numbers are typed `Quantity` values (SI value + canonical unit). Conversion is between units of the same dimension only; unknown units throw.
12. **One definition per part.** Category, family and kind are single canonical values; roles and tags are cross-cutting. Aliases are normalised and collisions are rejected, never silently resolved.

## Current content

Five definitions mirroring the Load Lab (resistor, inductor, capacitor, series RLC, DC motor), all `illustrative-educational` / `unverified`. No manufacturer parts exist. The six formulas are the textbook expressions the Load Lab already shows, marked `engineering-reference`, unverified.
