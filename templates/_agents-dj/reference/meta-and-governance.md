# Custom Meta & Governance Metadata

Load this when attaching free-form `meta` (ownership, compliance, SLAs), applying the optional governance vocabulary, or checking which `meta` keys the framework owns.

## Custom Meta (Free-form)

Both `.model.json` and `.source.json` accept **free-form user-defined keys** on their `meta` blocks. Use this to attach arbitrary metadata (ownership, compliance tags, process info, SLAs, etc.) that you want to surface in the generated `.yml` and consume downstream (dbt docs, Lightdash, custom tooling).

Schemas: `model.meta.schema.json`, `column.meta.schema.json`, `source.meta.schema.json`, `source.table.meta.schema.json`.

### Governance metadata conventions (optional)

These keys are **not required and not enforced** by the framework — they are a shared vocabulary so that projects that choose to track governance metadata do so consistently. Offer them when authoring; if the user skips, omit them entirely (do not write placeholders). Teams that want them mandatory enforce that themselves (CI, review, custom validation). Before offering, mirror the keys the project already uses by scanning sibling models.

| Key              | Scope          | Meaning                                                                     |
| ---------------- | -------------- | --------------------------------------------------------------------------- |
| `owner`          | model / source | Owning team or individual (e.g., `finops-team`)                             |
| `owner_slack`    | model / source | Contact channel (e.g., `#finops-team`)                                      |
| `pii`            | model / column | Whether the model/column carries personally identifiable info               |
| `classification` | model / column | Sensitivity tier (e.g., `public`, `internal`, `confidential`, `restricted`) |
| `compliance`     | model / column | Applicable regimes (e.g., `["gdpr", "ccpa"]`)                               |
| `freshness_sla`  | model / source | Expected freshness (e.g., `daily by 06:00 UTC`)                             |

Column-level `pii` / `classification` / `compliance` inherit through clean passthrough selects (see below), so tagging a source or staging column once can propagate downstream.

### Model-level meta

Root `meta` block on any model type:

```jsonc
{
  "type": "mart_select_model",
  "group": "finance",
  "topic": "billing",
  "name": "accounts_daily",
  "from": { "model": "int__finance__billing__accounts_daily" },
  "select": [...],
  "meta": {
    "owner": "finops-team",
    "owner_slack": "#finops-team",
    "freshness_sla": "daily by 06:00 UTC",
    "pii": false,
  },
}
```

- Free-form keys flow through to the emitted `.yml` verbatim.
- **No automatic inheritance**: each model declares its own model-level meta (model-level meta is not inherited from upstream models).

### Column-level meta

Any select item on `.model.json` accepts a `meta` object:

```jsonc
{
  "name": "email",
  "type": "dim",
  "meta": { "pii": true, "compliance": ["gdpr", "ccpa"] },
}
```

- **Inheritance**: Column-level free-form meta IS inherited through **clean passthrough selects** (plain string selects and named-column selects without `expr`). `expr`-based selects (including `expr`-based renames) do **not** inherit meta.
- Downstream per-key overrides work as expected: a downstream column meta key overwrites the inherited key; keys the downstream doesn't declare stay inherited.

### Framework-reserved keys under `meta`

A small set of keys are owned by the framework — it writes them into the emitted YAML's `meta` block from structured sibling fields. Authoring any of these under `meta` directly is allowed by the schema but will be silently overwritten at emit time, and the extension surfaces a **Warning-severity diagnostic** in the Problems tab pointing to the canonical field.

| Scope  | Key                            | Canonical authoring location                             |
| ------ | ------------------------------ | -------------------------------------------------------- |
| model  | `metrics`                      | `lightdash.metrics` on the model                         |
| model  | `portal_partition_columns`     | framework-derived; do not author                         |
| model  | `local_tags`                   | `tags: [{ "type": "local", "tag": "..." }]` on the model |
| model  | `case_sensitive`               | `lightdash.case_sensitive` on the model                  |
| model  | (any key on `lightdash.table`) | `lightdash.table.<key>` on the model                     |
| column | `type`                         | `type` on the select item                                |
| column | `dimension`                    | `lightdash.dimension` on the select item                 |
| column | `metrics`                      | `lightdash.metrics` on the select item                   |
| column | `case_sensitive`               | `lightdash.case_sensitive` on the select item            |
| column | `origin`                       | framework-derived from upstream lookup; do not author    |
