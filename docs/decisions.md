# Design Decision Log

---

## D1 — Gene data storage

**Options considered:**
- (a) One big matrix file (all genes × cells)
- (b) One `.u8` file per gene + `genes.json` index ← chosen
- (c) HDF5

**Choice:** Option (b).  
**Why:** Lazy loading — only the gene the user picks is downloaded (~2.6 KB for 2638 cells). Option (a) would download 10+ MB upfront. Serves T2 directly.

---

## D2 — Expression scaling

**Options considered:**
- (a) Min–max normalisation
- (b) Percentile clip at p99 ← chosen
- (c) Z-score

**Choice:** Option (b), p99 clip.  
**Why:** A handful of very highly expressed cells would compress the whole colour scale into the dark end of the LUT. Clipping at p99 leaves ~1 % of cells at maximum colour; it doesn't hide outliers, but makes the typical range visible. Directly answers T2.

---

## D3 — Expression channel

**Options considered:**
- (a) Sequential LUT texture (cividis) ← chosen
- (b) Luminance only
- (c) Hue shift from cluster colour

**Choice:** Option (a), cividis.  
**Why:** Cividis is perceptually uniform AND CVD-safe (designed for deuteranopia). It is monotonic in both hue and lightness so viewers can judge relative values. Satisfies both T2 and R6.

---

## D4 — Category encoding (cluster colours + annotation)

**Choice:** Tableau-10 extended to 12 colours (existing PALETTE) + cell-type names from `annotation.json`.  
**Why:** Each cluster needs a distinct hue. The existing palette is already in use; adding annotation names gives T1/T8 context without changing the colour scheme. Names are derived from known PBMC3k marker genes (GNLY→NK, LYZ→Monocyte, etc.).

---

## D5 — Uncertainty measure

**Options considered:**
- (a) Cross-validated classifier confidence
- (b) Neighbourhood purity (k=15 nearest neighbours in PCA space) ← chosen
- (c) Distance to nearest cluster centroid

**Choice:** Option (b).  
**Why:** Requires no second model — only the PCA coordinates already computed in step 03. For each cell, fraction of k=15 PCA neighbours with a different cluster label gives a 0–1 impurity score. Directly encodes the intuition that border cells are uncertain. Answers T9.

---

## D6 — 2D linked view

**Options considered:**
- (a) Dot plot (mean expression × fraction per cluster per gene)
- (b) UMAP/t-SNE 2D scatter
- (c) Bar chart of cluster sizes ← chosen

**Choice:** Option (c).  
**Why:** Answers T1 directly with the least extra data: cluster sizes are computed from `obs_cluster.u8` and stored in `manifest.json`. Bar length is an accurate encoding of quantity. Clicking a bar highlights the cluster in the 3D view (bidirectional linking).

---

## D7 — Legends

- **Categorical:** panel top-right; one swatch + cell-type name + count per cluster; click highlights
- **Continuous (gene):** colour bar below HUD showing cividis gradient; tick marks at 0 and p99 value; label "log-norm expr"; hidden unless a gene is selected
- **Uncertainty:** no separate legend; the slider label and tooltip are enough since the encoding is monotonic

---

## D8 — Accessibility

Three measures implemented:

| # | Measure | Standard addressed |
|---|---------|-------------------|
| 1 | CVD toggle (deuteranopia simulation in GLSL) | WCAG 1.4.1 Use of Colour; tests that cividis remains interpretable |
| 2 | Keyboard navigation: Tab focus + Enter/Space on legend rows and bar chart | WCAG 2.1.1 Keyboard |
| 3 | Text contrast: #ddd on #101114 ≈ 7.6:1 ratio, #aaa on #101114 ≈ 5.0:1 | WCAG 1.4.3 Contrast Minimum (AA requires 4.5:1) |

**CVD toggle implementation note:** The deuteranopia simulation matrix (Viénot et al. 1999) is applied per-vertex in the GLSL shader so it works across both cluster and gene expression modes without any post-processing pass.
