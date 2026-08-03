---
name: dj-update-ai-hints
description: Add or update Lightdash AI hints across a model's dependency tree. Use when working with AI hints in model or source JSON files.
---

# Update AI Hints

## Purpose

- Automate adding ai hints.

## Inputs

- **filePath**: The File path for excel sheet with ai hints.
- **sheetName**: Sheet name(s) in the excel file. Comma separated if multiple.
- **baseModel**: Base Model that we trying to update ai hints for.
- **tag**: The tag to filter models to apply them for AI Agent in Lightdash.

## Key Model Type Identification

- **Mart Models (mart\_\_)**: Final business-ready models
- **Intermediate Models (int\_\_)**: Business logic and aggregations
- **Staging Models (stg\_\_)**: Data cleaning and initial transformations
- **Sources**: Database tables defined in `/sources/*.yml`
- **Seeds**: CSV files in `/seeds/*.csv` directories

## Workflow

0. **Resolve the target project.** If the workspace holds more than one dbt project, ask the user which one to update — do not silently search a default. The `models/`, `sources/`, and `seeds/` paths below are relative to that project.
1. **Read in the Excel file** and load the sheet named using Python (preferably with 'pandas').
2. **Identify and trace the complete dependency tree**:
   - **Start with the base model** with the name passed as parameter
   - **Search 'models' directory** and its subdirectories for the base `.model.json` file
   - **Recursively trace dependencies**: Follow each reference in `from.model`, `from.join[]` sections
   - **Continue until reaching sources/seeds**: Trace through intermediate and staging models
   - **Identify terminal nodes**: `stg_select_source` models (reference `source:`) and `stg_select_model` models (reference `seed__`)
   - **Verify source files exist**: Check `/sources/*.yml` files for source definitions
   - **Verify seed files exist**: Check `/seeds/*.csv` files for seed data
   - **Handle model aliases**: Account for `override_alias` in join definitions (e.g., `suv_mapping__username`)
   - **Process self-joins**: Handle models that reference themselves with different aliases
3. **Three AI Hint Placement Rules** (CRITICAL - Follow these exactly):

   - **Rule 1: Source Files (.source.json)**
     - Place `ai_hint` as a **direct field** in the column, metric, dimension object at the same level as 'name', 'type', etc.
     - Some times a particular table is references from `.source.json` file. Ex: crm\_\_lookups.employee_records; crm is the root directory inside source, lookups is the data source, employee_records is the table
   - **Rule 2: Model Files**

     - **Top-level Lightdash Metrics**

       - JSON Path: `$.lightdash.metrics[*].ai_hint`
       - File Path Example: `~/dbt_project/models/intermediate/analytics/billing/int__analytics__billing__hourly_v2.model.json`

     - **Select Section - Dimension AI Hints**

       - JSON Path: `$.select[*].lightdash.dimension.ai_hint`
       - File Path Examples: `~/dbt_project/models/intermediate/analytics/billing/int__analytics__billing__hourly_v2.model.json`

     - **Select Section - Metric AI Hints (within select items)**

       - JSON Path: `$.select[*].lightdash.metrics[*].ai_hint`
       - File Path Examples: `~/dbt_project/models/intermediate/analytics/billing/int__analytics__billing__hourly_v2.model.json`

     - **Nested Lightdash Dimension AI Hints (within metrics)**
       - JSON Path: `$.select[*].lightdash.metrics[*].lightdash.dimension.ai_hint`
       - File Path Examples: `~/dbt_project/models/intermediate/analytics/billing/int__analytics__billing__hourly_v2.model.json`

### Real Example: Complete Dependency Tree

```
mart__analytics__billing__accounts_daily (ROOT)
├── mart__analytics__billing__account_hierarchy
│   └── stg__analytics__bigquery__account_hierarchy
│       └── SOURCE: warehouse__finops.account_rollup_hierarchy
│           └── FILE: /sources/warehouse/warehouse__finops.source.json
│
├── int__analytics__billing__daily_v2
│   └── int__analytics__billing__hourly_v2
│       └── int__analytics__billing__with_discounts_hourly_conformed_v2
│           ├── int__analytics__billing__with_discounts_hourly_v2
│           │   ├── int__analytics__billing__agg_hourly_v2
│           │   │   └── int__analytics__billing__raw_data_conformed
│           │   │       └── stg__analytics__billing_account__raw_data_conformed
│           │   │           └── SOURCE: raw__billing_data.raw_data
│           │   │               └── FILE: /sources/raw/raw__billing_data.source.json
│           │   ├── stg__analytics__discounts__standard_discount
│           │   │   └── seed__billing__standard_cost_v2
│           │   │       └── SEED FILE: /seeds/billing/seed__billing__standard_cost_v2.csv
│           │   └── [other staging models with seed/source dependencies]
│           ├── int__analytics__billing__environment_conformed_agg
│           └── [other conformance models]
│
├── int__analytics__billing__discount_rate_monthly
├── int__sales__lookups__employee_spend_organization (with aliases)
│   ├── int__sales__lookups__employee_supervisor_data
│   │   └── int__sales__lookups__employee_data (SELF JOIN)
│   │       └── stg__sales__lookups__employee_data
│   │           └── SOURCE: crm__lookups.employee_data
│   │               └── FILE: /sources/crm/crm__lookups.source.json
│   └── stg__analytics__cost_center__mapping
│       └── seed__mapping
│           └── SEED FILE: /seeds/cost_center/seed__mapping.csv
│
└── stg__analytics__cost_center__usagetype_mapping
    └── seed__usagetype_mapping
        └── SEED FILE: /seeds/cost_center/seed__usagetype_mapping.csv
```

## DO NOT's

1. **DO NOT** modify any files other than `.json` and files that are part of the dependency tree.
1. **DO NOT** add any columns or metrics. Just update existing.
1. **DO NOT** create additional scripts to achieve this. Just make the changes and Leave to user to whether commit them or revert back.
1. **DO NOT** modify or create `.yml` files.
1. **DO NOT** create empty dimension objects unnecessarily.
1. **DO NOT** remove comments or change formatting. Preserve JSONC structure completely.
1. **DO NOT** add tags to intermediate, staging, or source files - only the base model gets the specified tag.

### Success Metrics

- AI hints placed according to workflow
- Only base model receives specified tag
- JSONC format preserved (comments intact)
- All matching item_names from Excel updated
- No new columns/metrics added (only updates)

## Additional Instructions

1. You can re use existing Virtual Environment '.venv' at the root or create one for installing necessary packages.
2. Cleanup the created Virtual Environment once done.
3. **Tag Management**: Only add the specified tag to the BASE MODEL file. Do not add tags to intermediate, staging, or source files in the dependency chain.
