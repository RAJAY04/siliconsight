# Teardown reference: MacBook Air 13-inch, M5 (Mac17,3)

Reference for drawing the exploded line-art view. Every number carries a tag:

- `[spec]` from Apple tech specs or local `system_profiler`/`ioreg`
- `[img]` measured from a published teardown photo (iFixit) of this chassis
- `[est]` estimated from teardown photos and chassis layout, not measured

No public teardown of the M5 Air exists yet (iFixit's M5 device page links no teardown as of 2026-10-18). The M5 Air reuses the 13-inch chassis Apple introduced with the M2 Air in 2022 (same 304.1 x 215 x 11.3 mm envelope, same four-cell battery shape, same port layout). The layout below comes from iFixit's M2 Air 13 teardown and chip ID, with the M4 Air teardown confirming that the disassembly and internal arrangement did not change. Treat board-level component positions as M2/M4-derived until an M5 teardown appears.

## 1. Model identification

| Field | Value | Source |
|---|---|---|
| Model name | MacBook Air | local `system_profiler` `[spec]` |
| Model identifier | Mac17,3 | local `[spec]` |
| Size and year | 13-inch, M5, 2026 (announced 3 March 2026) | Apple identification page, The Apple Wiki `[spec]` |
| Board ID | J813AP | local `ioreg` (`target-sub-type`) `[spec]` |
| Regulatory model | A3449 | local `ioreg` (`regulatory-model-number` decodes to "A3449") `[spec]` |
| Order number | MDHE4HN/A | local `[spec]` |
| Chip | Apple M5, 10-core CPU (4 "super" + 6 efficiency), 8-core GPU (binned 10-core die) | local + Apple `[spec]` |
| Memory | 16 GB unified, 153 GB/s | local + Apple `[spec]` |
| SSD | APPLE SSD AP0512Z, 512 GB | local `[spec]` |
| Battery | 53.8 Wh Li-poly; gauge bq40z651; design capacity 4629 mAh | Apple + local `[spec]` |
| Cooling | Fanless. `ioreg -l` has zero fan keys, the SMC reports fanCount 0, and Apple sells no Air with a fan | local + spec `[spec]` |
| Wireless | Apple N1 (Wi-Fi 7, Bluetooth 6, Thread) | Apple `[spec]` |
| Chassis | 304.1 mm W x 215 mm D x 11.3 mm H, 1.23 kg | Apple `[spec]` |
| Display | 13.6-inch Liquid Retina, 2560 x 1664, 224 ppi, with camera notch | Apple `[spec]` |

The 15-inch M5 Air is Mac17,4, so this machine is the 13-inch.

## 2. Coordinate table

### Coordinate system

- x runs 0 to 1 from the left edge to the right edge, as the user sees the laptop open in front of them.
- y runs 0 to 1 from the hinge (back) edge to the front edge.
- The table is **top-down** (as if the keyboard and top case were transparent and you look down at the internals). Draw from it directly.
- iFixit photos show the machine flipped with the bottom case off and the hinge at the top of the image. That view is **mirrored left to right** against this table: in the photos the ports appear on the right. Use `x_photo = 1 - x` to compare.
- 1 unit of x = 304.1 mm, 1 unit of y = 215 mm. Thickness in mm, measured from the bottom of the stack upward.

### Chassis and top-case features

| Item | x0 | y0 | x1 | y1 | Shape and notes | Tag |
|---|---|---|---|---|---|---|
| Chassis footprint | 0 | 0 | 1 | 1 | Rounded rectangle 304.1 x 215 mm, corner radius about 10 mm (r/W 0.033, r/D 0.047) | dims `[spec]`, radius `[est]` |
| Keyboard area | 0.05 | 0.07 | 0.95 | 0.52 | Full-width keyboard, 6 rows, function row at y0 | `[est]` |
| Touch ID / power key | 0.89 | 0.07 | 0.95 | 0.11 | Rightmost key of the function row | `[est]` |
| Trackpad | 0.30 | 0.58 | 0.70 | 0.95 | Rounded rect about 122 x 80 mm, centered on x | `[est]` |
| Speaker grilles | none | | | | No top-case grille; sound exits through the hinge gap | `[img]` per iFixit M2 |

### Display (lid, drawn above the stack)

Lid coordinates use its own frame: x 0..1 left to right, y 0..1 from top edge of the lid to the hinge.

| Item | x0 | y0 | x1 | y1 | Notes | Tag |
|---|---|---|---|---|---|---|
| Lid | 0 | 0 | 1 | 1 | Same footprint as chassis, about 4 mm thick | `[est]` |
| Active panel | 0.025 | 0.03 | 0.975 | 0.95 | 13.6 in diagonal, aspect 2560:1664 | size `[spec]`, margins `[est]` |
| Camera notch | 0.448 | 0.03 | 0.552 | 0.06 | About 32 x 6 mm, centered, rounded lower corners, 12 MP camera inside | `[est]` |
| Display flex cables | 0.40 | 0.97 | 0.60 | 1.0 | Run through the hinge to the logic board | `[est]` |

### Base internals (top-down)

| Component | x0 | y0 | x1 | y1 | Layer | Thickness mm | Notes | Tag |
|---|---|---|---|---|---|---|---|---|
| Hinge / clutch bar | 0.10 | 0.00 | 0.90 | 0.04 | L5 | 4 | Full-width hinge, display cables pass at center | `[est]` |
| Logic board | 0.10 | 0.04 | 0.62 | 0.30 | L3 | 1 (PCB) + 2 (parts) | Long rectangle along the hinge, a notch on its lower edge at the battery connector, left end meets the port daughterboard | `[est]` from `[img]` |
| Board shield, left half | 0.10 | 0.04 | 0.36 | 0.30 | L3 top | 0.2 | Thin shield with graphite tape, mostly empty; no heatsink | `[img]` |
| SoC package (M5 + DRAM) | 0.38 | 0.10 | 0.47 | 0.22 | L3 | 1.2 | Under the right half of the shield, see package below | `[est]` |
| NAND (512 GB) | 0.50 | 0.10 | 0.55 | 0.17 | L3 | 1 | 1 package on M2 256 GB; 512 GB likely 1 or 2 packages | `[est]` |
| N1 Wi-Fi/BT module | 0.56 | 0.06 | 0.61 | 0.12 | L3 | 1 | Replaces USI module of M2; near antenna feed at the hinge | `[est]` |
| PMIC / power area | 0.20 | 0.10 | 0.34 | 0.24 | L3 | 1 | Two Apple PMICs, Renesas charger, buck converters (M2 chip ID) | `[est]` |
| Battery connector (trap door) | 0.40 | 0.27 | 0.46 | 0.31 | L3 | 1 | Small iPhone-style connector at board's lower edge | `[img]` |
| Port daughterboard (MagSafe + 2 USB-C) | 0.00 | 0.08 | 0.08 | 0.36 | L3 | 5 | Modular, screwed, not glued | `[img]` |
| MagSafe 3 port | 0.00 | 0.09 | 0.02 | 0.16 | L3 | 5 | Left edge, rearmost | `[img]` |
| USB-C / Thunderbolt 4 #1 | 0.00 | 0.19 | 0.02 | 0.24 | L3 | 3.5 | Left edge | `[img]` |
| USB-C / Thunderbolt 4 #2 | 0.00 | 0.26 | 0.02 | 0.31 | L3 | 3.5 | Left edge | `[img]` |
| Audio daughterboard + 3.5 mm jack | 0.93 | 0.08 | 1.00 | 0.20 | L3 | 6 | Right edge, rear; adhesive-mounted | `[img]` |
| Speaker, left (woofer + tweeter) | 0.10 | 0.00 | 0.30 | 0.06 | L3 | 6 | Fires into the hinge gap | `[est]` |
| Speaker, right (woofer + tweeter) | 0.68 | 0.00 | 0.90 | 0.06 | L3 | 6 | Fires into the hinge gap | `[est]` |
| Antennas | 0.35 | 0.00 | 0.65 | 0.03 | L5 | 1 | Behind the hinge cover strip | `[est]` |
| Battery cell A (left outer) | 0.03 | 0.36 | 0.28 | 0.96 | L2 | 6.5 | Thicker cell, series pair | `[est]` from `[img]` |
| Battery cell B (center left) | 0.29 | 0.33 | 0.49 | 0.56 | L2 | 4 | Thinner, parallel pair, above trackpad | `[est]` from `[img]` |
| Battery cell C (center right) | 0.51 | 0.33 | 0.71 | 0.56 | L2 | 4 | Thinner, parallel pair, above trackpad | `[est]` from `[img]` |
| Battery cell D (right outer) | 0.72 | 0.36 | 0.97 | 0.96 | L2 | 6.5 | Thicker cell, series pair | `[est]` from `[img]` |
| Battery tray | 0.03 | 0.33 | 0.97 | 0.96 | L2 | 0.3 | Metal tray, screws plus 8 stretch-release strips | `[img]` |
| Trackpad + Taptic Engine | 0.30 | 0.58 | 0.70 | 0.95 | L4 | 3 | Taptic engine strip along the rear edge of the trackpad, about y 0.60..0.66 | `[est]` |
| Trackpad cable | 0.47 | 0.30 | 0.53 | 0.60 | L3/L4 | 0.2 | Runs between cells B and C to the board | `[est]` |

The four cells make a horseshoe around the trackpad: two thick cells on the outside running to the front edge, two thin cells side by side between the logic board and the trackpad. iFixit's M2 notes say the top two (center) cells are wired in parallel and the pack behaves like a 3-cell battery; pack mass 251.5 g. `[img]`

### SoC package detail

Package-local coordinates, x 0..1 across the package as drawn above, y 0..1 hinge to front.

| Item | x0 | y0 | x1 | y1 | Notes | Tag |
|---|---|---|---|---|---|---|
| Package substrate | 0 | 0 | 1 | 1 | About 26 x 32 mm | `[est]` |
| M5 die | 0.10 | 0.08 | 0.90 | 0.50 | Monolithic SoC, N3P | node `[spec]`, box `[est]` |
| DRAM package 1 (8 GB LPDDR5X) | 0.08 | 0.58 | 0.47 | 0.94 | On-package, beside the die | `[est]` |
| DRAM package 2 (8 GB LPDDR5X) | 0.53 | 0.58 | 0.92 | 0.94 | On-package, beside the die | `[est]` |

On every base M-series Air so far, the die and two DRAM packages sit on one shared substrate, with the DRAM placed side by side on one side of the die.

### Stacking order (exploded view, top to bottom)

| Layer | Part | Approx. thickness |
|---|---|---|
| L6 | Display lid (glass, panel, aluminum back) | 4 mm `[est]` |
| L5 | Hinge and antenna strip | 4 mm `[est]` |
| L4 | Top case: aluminum shell, keyboard, trackpad + Taptic Engine | 3 mm `[est]` |
| L3 | Logic board with shield, port and audio boards, speakers | 3 mm `[est]` |
| L2 | Battery tray and four cells | 4 to 6.5 mm `[est]` |
| L1 | Bottom case (flat aluminum, 4 pentalobe screws, no vents) | 0.8 mm `[est]` |

The total base is 11.3 mm `[spec]`. In the real machine the battery and board sit side by side in the same height band; the layers are an exploded drawing order, not a strict physical sequence. Thermal path: SoC to a thermal pad and the thin shield, then into the aluminum top case. No heat pipe, no vapor chamber, no fan.

## 3. ASCII sketch (top-down, hinge at top, ports on left)

```
 x=0                                                                 x=1
 +---------------------------------------------------------------------+ y=0
 |    [spk L        ] [antennas/hinge] [   spk R        ]               |
 |MS+-------------------------------------------------+         +-----+|
 |  | PMIC/power    | SoC  | NAND | N1  |              |         |audio||
 |C1| shield(graph.)| +DRAM|      |     |              |         | 3.5 ||
 |C2|               |      |      |     |              |         +-----+|
 |  +-------------------------[batt conn]-------------+                 |
 | +--------------+ +----------+ +----------+ +--------------+         | y=0.33
 | |              | | cell B   | | cell C   | |              |         |
 | |   cell A     | +----------+ +----------+ |   cell D     |         |
 | |   (thick)    |  +-----------------------+ |   (thick)    |        | y=0.58
 | |              |  |      TRACKPAD         | |              |        |
 | |              |  |   [taptic on rear]    | |              |        |
 | |              |  |                       | |              |        |
 | +--------------+  +-----------------------+ +--------------+        | y=0.96
 +---------------------------------------------------------------------+ y=1
 MS = MagSafe 3, C1/C2 = USB-C / Thunderbolt 4, 3.5 = headphone jack
```

## 4. M5 die layout

No annotated die shot of the base M5 exists in public sources I could find. TechInsights has published floorplan work on the M5 Pro (separate CPU and GPU chiplets on SoIC), which does not apply to the monolithic base M5. Apple's October 2025 M5 announcement included a stylized die render without labels.

The table below follows the block arrangement of Apple's labeled base M3/M4 die renders and community annotations, adjusted for M5 block counts (4 P, 6 E, 10 GPU cores with this machine's 8-core bin, 16-core Neural Engine). It is a plausible drawing, not a measured one. Every row is `[est]`. Die-local coordinates, x 0..1 left to right, y 0..1 top to bottom, die about 1.25:1 wide.

| Block | x0 | y0 | x1 | y1 | Notes |
|---|---|---|---|---|---|
| GPU (10 cores, 2 disabled here) | 0.00 | 0.00 | 0.45 | 0.62 | Draw as 2 columns x 5 cores; gray out 2 |
| GPU shared logic / tiler | 0.00 | 0.62 | 0.45 | 0.70 | |
| P-cluster (4 super cores + L2) | 0.47 | 0.00 | 0.75 | 0.30 | 4 cores in a 2x2 with shared L2 strip between |
| E-cluster (6 cores + L2) | 0.77 | 0.00 | 1.00 | 0.22 | 6 small cores in 2x3 |
| SLC (system level cache) | 0.47 | 0.32 | 0.80 | 0.52 | Central block between CPU and GPU |
| Neural Engine (16 cores) | 0.80 | 0.24 | 1.00 | 0.52 | |
| Media engines (encode/decode, ProRes) | 0.47 | 0.54 | 0.70 | 0.70 | |
| Display engine | 0.70 | 0.54 | 0.85 | 0.70 | |
| Secure Enclave, always-on, misc | 0.85 | 0.54 | 1.00 | 0.70 | |
| LPDDR5X interface, channel group A | 0.00 | 0.72 | 0.50 | 1.00 | PHY strip along the edge facing DRAM 1 |
| LPDDR5X interface, channel group B | 0.50 | 0.72 | 0.85 | 1.00 | PHY strip along the edge facing DRAM 2 |
| Thunderbolt / PCIe / I/O | 0.85 | 0.72 | 1.00 | 1.00 | |

Orient the die so the memory PHY edge (y=1) faces the DRAM packages in the package table above.

## 5. Sources

- Local machine: `system_profiler SPHardwareDataType SPPowerDataType SPNVMeDataType`, `ioreg -rd1 -c IOPlatformExpertDevice`, `ioreg -l` (fan key search), run 2026-10-18
- Apple, Identify your MacBook Air model: https://support.apple.com/102869
- Apple, MacBook Air (13-inch, M5) tech specs: https://support.apple.com/126320
- The Apple Wiki, Mac17,3: https://theapplewiki.com/wiki/Mac17,3
- EveryMac, A3449 lookup: https://everymac.com/ultimate-mac-lookup/?identify=A3449
- iFixit, MacBook Air 13" 2026 (M5) device page (ports modular, battery under board, no teardown yet): https://www.ifixit.com/Device/MacBook_Air_13%22_2026_%28M5%29
- iFixit, M2 MacBook Air teardown (layout, horseshoe battery, shield without heatsink): https://www.ifixit.com/News/62674/m2-macbook-air-teardown-apple-forgot-the-heatsink
- iFixit, MacBook Air M2 logic board chip identification: https://www.ifixit.com/Teardown/Macbook+Air+(M2+2022)+Logic+Board+and+Chip+Identification/151816
- iFixit, MacBook Air M2 battery replacement guide (tray, 8 adhesive strips): https://www.ifixit.com/Guide/MacBook+Air+2022+(M2)+Battery+Replacement/156332
- iClarified, iFixit M4 MacBook Air teardown video (same disassembly as M2): https://www.iclarified.com/96717/ifixit-tears-down-new-m4-macbook-air-video
- TechInsights, M5 Pro die-level analysis (chiplet design, not the base M5): https://techinsights.com/blog/what-die-level-analysis-reveals-about-apples-m5-pro-gpu-design
- YouTube, "MacBook Air M5 Teardown - What's Under the Hood?" (not reviewed in detail): https://www.youtube.com/watch?v=wCHFKhVzhvo
