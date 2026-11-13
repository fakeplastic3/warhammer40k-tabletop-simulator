# Source analysis

The supplied file is a condensed DOCX study reference, not a complete official rulebook. All 231 top-level paragraphs and all eight tables were read. Source checksum and edition claim are in SOURCE_METADATA.json. The document claims 11th edition (June 2026). We do not independently certify that claim or silently substitute another edition.

## Citation convention

P1 means the first top-level body paragraph in document.xml (including empty paragraphs). T6 R2 means table 6, second row, counting its header. DOCX layout is renderer-dependent; there is no source PDF, so PDF page numbers are unavailable. Source text and copyrighted reference assets must never enter Git.

## Complete mechanical map

| Chapter    | Source         | Mechanics and dependencies                                                                                                                                                                                                      |
| ---------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1          | P20–42         | Ownership, active player effect ordering, base measurement, D6/D3/2D6, no repeated rerolls, automatic vs critical outcomes, leadership, coherency, engagement, battle-shock, starting strength, off-table and keyword semantics |
| 2          | P43–49         | Model/weapon profiles, unusable characteristics, random A/D, AP vs saves, datasheets and characteristic modifiers                                                                                                               |
| 3          | P50–55         | Segmented moves, friendly traversal, enemy collision, final placement, coherency, atomic cancellation, setup                                                                                                                    |
| 4          | P56–61         | Weapon and target declaration, independent range/visibility witnesses, melee splits, attack pools                                                                                                                               |
| 5          | P62–73; T4     | Hit/wound/save/damage, defender allocation, sorted saves, CHARACTER protection, precision, AP, no spill, FNP, lethal                                                                                                            |
| 6          | P74–79         | Model visibility, full visibility, mortal spill, devastating cap, hazards                                                                                                                                                       |
| 7          | P80–85         | Five rounds unless mission overrides; command/movement/shooting/charge/fight; timing and mission checks                                                                                                                         |
| 8          | P86–90         | Both players gain CP, required battle-shock checks and recovery                                                                                                                                                                 |
| 9          | P91–98         | Stationary, normal, advance, fall back, desperate escape, movement penalties                                                                                                                                                    |
| 10         | P99–105        | Normal, assault, close-quarters, indirect shooting eligibility and restrictions                                                                                                                                                 |
| 11         | P106–111       | One charge attempt, 12-inch eligibility, 2D6, targets after roll, nearer movement, Fights First                                                                                                                                 |
| 12         | P112–120       | Separate pile-in/fight/consolidate steps, alternate selections, Fights First, overrun, compulsory eligibility                                                                                                                   |
| 13         | P121–133       | Exposed/light/dense footprints, traversability, climbing/support, cover modifies BS, hidden/detection, obscuring, solid, plunging                                                                                               |
| 14         | P134–139       | Terrain and marker objectives, summed model OC, end-phase checks, secured, shock removes OC                                                                                                                                     |
| 15         | P140–144; T5   | Ten stratagems: costs, timing, target restrictions, once/phase and one/unit/phase                                                                                                                                               |
| 16         | P145–149       | Mission actions, restrictions, interruption and completion                                                                                                                                                                      |
| 17         | P150–154       | Monster/vehicle traversal, FRAME geometry, engaged shooting modifiers                                                                                                                                                           |
| 18         | P155–164       | Capacity/eligibility from datasheets; embark; rapid/tactical/combat/emergency/assault/shock disembark; firing deck                                                                                                              |
| 19         | P165–171       | Permitted leader/support attachments, bodyguard toughness, keyword union, ability-source lifetimes, allocation                                                                                                                  |
| 20         | P172–179       | 50% reserves, round 2 ingress, 6-inch edge, >8 enemies, zone restrictions, round 3 losses, deep strike, reposition                                                                                                              |
| 21         | P180–183       | Fly declaration, -2 movement, hover, surge ability prerequisites and closest enemy                                                                                                                                              |
| 22         | P184–189       | Aura duplicate policy, faction/psychic/wargear sources, plunging                                                                                                                                                                |
| 23         | P190–194       | Aircraft ingress-only, return to reserves, traversal and flying-only charges/melee                                                                                                                                              |
| 24         | P195–197; T6   | 35 named core ability entries, duplicate ability policy and scouts minimum                                                                                                                                                      |
| 25         | P198–205; T8   | Faction, points, detachment, enhancement, datasheet caps, warlord, upgrades                                                                                                                                                     |
| Reminders  | P206–216       | Explicit edition distinctions and requirement to consult missing errata/mission/datasheets                                                                                                                                      |
| References | T1–8; P218–231 | Phase chart, numerical chart, wound chart, stratagems, abilities, eligibility, size limits. P231 explicitly excludes full Rules Appendix.                                                                                       |

## Interpretation boundaries

Flat circular bases are an implementation geometry assumption, not a general replacement for FRAME silhouettes or true model-part visibility. Mission scoring and custom troop profiles are original demo content. A rule appearing in this map is not a claim of executable coverage. Consult RULES_IMPLEMENTATION and UNRESOLVED_RULES for status.
