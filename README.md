# Static version of the results on amem memory based tool retrieval

[deployed here](https://sepaww.github.io/amem-memory-based-tool-retrieval-static-webui/)

This directory is a backend-free GitHub Pages version of the Search Map. It is
separate from the Flask Web UI under `src/memory_tool_retrieval/web/`.

Generate or refresh the static data from the release root:

```bash
python scripts/export_search_viz_static.py
```

Preview it locally through an HTTP server (opening `index.html` directly will not
allow browsers to fetch the JSON files reliably):

```bash
python -m http.server 8000 --directory github_pages
```

Then open `http://127.0.0.1:8000/`.

The selector is generated from the manifest and contains only settings with a
committed data bundle. There are twelve configurations at `m=10`:

1. no evolution with no links;
2. no evolution with Jaccard links using `L=1`, threshold `0.75`, and
   semantic-then-Jaccard ranking over a 50-note semantic candidate pool;
3. evolved with no links;
4. evolved with the native A-MEM links stored in the corrected snapshot;
5. evolved with Jaccard links using the same settings as item 2.

The remaining seven settings are the no-evolution/no-link field ablations from
Thesis Table 5.5: all fields without tools, content plus context, content only,
context only, context plus keywords plus tags, keywords only, and tags only. Each
has its own memory embeddings and PCA projection. Together with item 1, these cover
all eight Table 5.5 field rows.

Every data bundle includes aggregate in-domain and OOD Coverage@6, macro F1@6,
mean cover rank, and unrecovered count. The exporter compares all four OOD memory
metrics against the authoritative final thesis Tables 5.4 and 5.5 and aborts on any
mismatch. Verification metadata remains in the exported data without adding a
verification badge to the UI.

Question dots can be shaded by either Question-to-Question or memory retrieval
outcome. Green means complete recovery by rank 6, blue means recovery at ranks
7--10, amber means recovery after rank 10, and red means at least one required tool
never appears in the produced ranking. The outcome class and its cover rank are
stored with every precomputed task detail; the palette is recorded in the manifest.
Changing the precomputed memory setting automatically returns the shading selector
to that setting's memory-retrieval outcomes and updates the train, test, and OOD
counts. Question-to-Question can still be selected as a fixed comparison baseline;
its colors intentionally remain unchanged across memory settings.

When a linked variant is selected, its precomputed note-to-note connections are
drawn behind the notes in the corresponding memory PCA panel. Reciprocal directed
links share one visual line to keep the map legible; the JSON retains every directed
link.

