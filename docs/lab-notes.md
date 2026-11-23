# Lab Notes — Task Abstractions (R1)

Three tasks framed using Munzner's what–why–how abstraction.

---

## T1 — How many cells are in each cluster?

**Domain question:** Which clusters are large vs small in this dataset?

**What (data):** Cells (items), cluster membership (categorical attribute)  
**Why (action):** Summarise → aggregate counts per cluster to compare sizes  
**How (encoding):** 2D bar chart with length marks; one bar per cluster, colour matched to 3D view; bars sorted by cluster index; cell-type name label on each bar

---

## T2 — Where are cells expressing a specific gene?

**Domain question:** Which region of the embedding lights up for a marker gene like NKG7 or IL7R?

**What (data):** Cells (items), log-normalised expression of one gene (continuous attribute)  
**Why (action):** Locate → identify spatial extent of gene expression in PCA embedding  
**How (encoding):** Sequential colourmap (cividis) on the 3D scatter plot; zero maps to darkest bin (not detected); scale legend shows 0 to p99 clip value in log-norm units

---

## T9 — Which cells have uncertain cluster assignments?

**Domain question:** Which cells sit near a cluster boundary and might be misclassified?

**What (data):** Cells (items), neighbourhood purity score (derived continuous attribute)  
**Why (action):** Identify → flag unreliable assignments for quality assessment  
**How (encoding):** Saturation channel — high uncertainty desaturates the cell's cluster colour toward grey; a slider controls the encoding strength so the user can toggle between full colour and full uncertainty view
