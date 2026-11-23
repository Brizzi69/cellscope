"""
Part 3 data export:
  - Gene expression .u8 files (one per gene, 0-255 scaled at p99)
  - genes.json index
  - annotation.json  (cluster → cell-type name)
  - obs_uncertainty.u8  (neighbourhood purity, k=15)
  - lut_cividis.u8  (256 RGBA bytes for JS DataTexture)
  - Updates manifest.json
"""
import json
import os
import numpy as np
import scanpy as sc
import matplotlib
matplotlib.use("Agg")
import matplotlib.cm as cm
from sklearn.neighbors import NearestNeighbors
from contract import OUT, load_manifest, save_manifest, write_u8

adata = sc.read_h5ad("out/03_clustered.h5ad")
manifest = load_manifest()

# ── 1. Cividis LUT ──────────────────────────────────────────────────────────
# 256 RGBA values (1024 bytes) for use as a THREE.DataTexture in JS
cividis = matplotlib.colormaps["cividis"]
lut = np.zeros(256 * 4, dtype=np.uint8)
for i in range(256):
    r, g, b, _ = cividis(i / 255.0)
    lut[i * 4 + 0] = int(r * 255)
    lut[i * 4 + 1] = int(g * 255)
    lut[i * 4 + 2] = int(b * 255)
    lut[i * 4 + 3] = 255
lut.tofile(os.path.join(OUT, "lut_cividis.u8"))
print("LUT saved (256 RGBA)")

# ── 2. Gene expression export ────────────────────────────────────────────────
# Source: adata.raw (all genes, log-normalised, before HVG filtering)
with open(os.path.join(OUT, manifest["markers"])) as f:
    markers_json = json.load(f)

# Collect: top 5 marker genes per cluster + first 100 HVGs
gene_set = []
for cluster_genes in markers_json["markers"].values():
    for m in cluster_genes[:5]:
        g = m["gene"]
        if g not in gene_set:
            gene_set.append(g)

for g in adata.var_names[:100]:
    if g not in gene_set:
        gene_set.append(g)

print(f"Exporting {len(gene_set)} genes")
os.makedirs(os.path.join(OUT, "genes"), exist_ok=True)

raw_var_names = list(adata.raw.var_names)
genes_meta = {}

for gene in gene_set:
    if gene not in raw_var_names:
        continue
    idx = raw_var_names.index(gene)
    col = adata.raw.X[:, idx]
    vals = (col.toarray().flatten() if hasattr(col, "toarray") else np.asarray(col).flatten()).astype(np.float32)
    hi = float(np.percentile(vals, 99))
    if hi < 1e-6:
        continue  # unexpressed gene
    scaled = np.clip(vals / hi, 0.0, 1.0)
    u8 = (scaled * 255).round().astype(np.uint8)
    fname = f"genes/{gene}.u8"
    u8.tofile(os.path.join(OUT, fname))
    genes_meta[gene] = {"file": fname, "hi": round(hi, 4)}

with open(os.path.join(OUT, "genes.json"), "w") as f:
    json.dump(genes_meta, f, indent=2)
print(f"Saved {len(genes_meta)} gene files")

# ── 3. Cluster annotation ────────────────────────────────────────────────────
# Derived from top marker genes using known PBMC3k biology.
# Lookup table: gene → cell type (priority: first match wins)
MARKER_LOOKUP = {
    "CD79A": "B cells",    "MS4A1": "B cells",
    "PPBP": "Megakaryocytes", "PF4": "Megakaryocytes",
    "FCGR3A": "FCGR3A+ Mono", "LST1": "FCGR3A+ Mono", "FCER1G": "FCGR3A+ Mono",
    "GNLY": "NK cells",    "GZMB": "NK cells",
    "CCL5": "CD8 T cells", "GZMA": "CD8 T cells", "CST7": "CD8 T cells",
    "LYZ": "CD14+ Mono",   "S100A9": "CD14+ Mono", "S100A8": "CD14+ Mono",
    "IL7R": "CD4 T cells", "CD3D": "CD4 T cells",  "LTB": "CD4 T cells",
    "HLA-DPA1": "Dendritic cells", "HLA-DPB1": "Dendritic cells",
    "NKG7": "NK cells",
}
# Ribosomal-dominant clusters are typically naive/resting T cells in PBMC3k
RPS_RPL_FALLBACK = "Naive CD4 T"

annotation = {}
for cluster, genes in markers_json["markers"].items():
    label = None
    top_genes = [m["gene"] for m in genes[:10]]
    for g in top_genes:
        if g in MARKER_LOOKUP:
            label = MARKER_LOOKUP[g]
            break
    if label is None:
        # If top genes are all ribosomal (RPS/RPL), assign naive T cell label
        ribosomal = sum(1 for g in top_genes[:5] if g.startswith("RPS") or g.startswith("RPL"))
        label = RPS_RPL_FALLBACK if ribosomal >= 3 else f"Cluster {cluster}"
    annotation[cluster] = label

with open(os.path.join(OUT, "annotation.json"), "w") as f:
    json.dump(annotation, f, indent=2)
print("Annotation:", annotation)

# ── 4. Uncertainty (neighbourhood purity) ───────────────────────────────────
# For each cell: fraction of k=15 PCA neighbours with a different cluster label.
pca = adata.obsm["X_pca"]
cluster_codes = adata.obs["cluster"].cat.codes.values.astype(np.int32)

K = 15
nn = NearestNeighbors(n_neighbors=K + 1, algorithm="ball_tree", n_jobs=-1)
nn.fit(pca)
_, indices = nn.kneighbors(pca)

uncertainty = np.zeros(len(cluster_codes), dtype=np.float32)
for i in range(len(cluster_codes)):
    nbrs = indices[i, 1:]  # skip self (index 0)
    uncertainty[i] = np.sum(cluster_codes[nbrs] != cluster_codes[i]) / K

write_u8("obs_uncertainty.u8", (uncertainty * 255).round().astype(np.uint8))
print(f"Uncertainty: mean={uncertainty.mean():.3f}, max={uncertainty.max():.3f}")

# ── 5. Cluster sizes ─────────────────────────────────────────────────────────
categories = manifest["obs"]["cluster"]["categories"]
cluster_sizes = {}
for code, label in enumerate(categories):
    cluster_sizes[label] = int(np.sum(cluster_codes == code))
print("Cluster sizes:", cluster_sizes)

# ── 6. Update manifest ───────────────────────────────────────────────────────
manifest["genes"] = "genes.json"
manifest["annotation"] = "annotation.json"
manifest["lut_cividis"] = "lut_cividis.u8"
manifest["obs"]["uncertainty"] = {"file": "obs_uncertainty.u8", "type": "float01"}
manifest["cluster_sizes"] = cluster_sizes
save_manifest(manifest)
print("manifest.json updated")
