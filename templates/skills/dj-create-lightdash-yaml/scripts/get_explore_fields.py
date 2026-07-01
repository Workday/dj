#!/usr/bin/env python3
"""Read-only Lightdash lookup for authoring Dashboards-as-Code YAML.

Prints the exact field IDs (dimensions + metrics, including per-interval date
variants) for an explore, or the valid space slugs for a project. Use the output
to fill `exploreName`/`tableName`, dimension/metric IDs, and `spaceSlug` in chart
and dashboard YAML -- never guess these from labels.

Credentials can be passed as flags or read from environment variables. The env
var names below are the **standard Lightdash CLI / DJ extension convention** (the
same vars the CLI and the extension's preview tooling use), so they are not
specific to any one project:

  --url        / LIGHTDASH_URL       e.g. https://lightdash.example.com  (required)
  --api-key    / LIGHTDASH_API_KEY   personal access token               (required)
  --project    / LIGHTDASH_PROJECT   project UUID                        (required)

Flags take precedence over env vars, so you can run this without exporting
anything (e.g. when the values live elsewhere or you want to avoid env state).

Usage:
  python get_explore_fields.py --explore <dbt_model_name>
  python get_explore_fields.py --url <url> --api-key <token> --project <uuid> --explore <name>
  python get_explore_fields.py --spaces
  python get_explore_fields.py --explore <name> --json   # raw-ish field dump

Read-only: issues only HTTP GETs. Safe to run against prod or preview projects.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request


def _api_get(base, key, path):
    if not base or not key:
        sys.exit(
            "error: provide Lightdash credentials via --url/--api-key flags or the "
            "LIGHTDASH_URL/LIGHTDASH_API_KEY env vars."
        )
    url = base.rstrip("/") + path
    req = urllib.request.Request(url, headers={"Authorization": f"ApiKey {key}"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")[:400]
        sys.exit(f"error: HTTP {exc.code} for {path}\n{body}")
    except urllib.error.URLError as exc:
        sys.exit(f"error: could not reach {url}: {exc}")


def _results(payload):
    return payload.get("results", payload) if isinstance(payload, dict) else payload


def list_spaces(base, key, project):
    data = _results(_api_get(base, key, f"/api/v1/projects/{project}/spaces"))
    print("spaceSlug\tname")
    for sp in data:
        if isinstance(sp, dict):
            print(f"{sp.get('slug')}\t{sp.get('name')}")


def show_explore(base, key, project, explore, as_json):
    data = _results(
        _api_get(base, key, f"/api/v1/projects/{project}/explores/{explore}")
    )
    base_table = data.get("baseTable")
    table = data.get("tables", {}).get(base_table, {})
    dims = table.get("dimensions", {})
    metrics = table.get("metrics", {})

    if as_json:
        out = {
            "exploreName": base_table,
            "label": table.get("label"),
            "dimensions": {f"{base_table}_{k}": v.get("type") for k, v in dims.items()},
            "metrics": {f"{base_table}_{k}": v.get("type") for k, v in metrics.items()},
        }
        print(json.dumps(out, indent=2))
        return

    print(f"exploreName / tableName: {base_table}")
    print(f"label: {table.get('label')}")
    print("\nDIMENSIONS  (fieldId | type | hidden)")
    for k, v in sorted(dims.items()):
        print(f"  {base_table}_{k} | {v.get('type')} | hidden={v.get('hidden')}")
    print("\nMETRICS  (fieldId | type | label)")
    for k, v in sorted(metrics.items()):
        print(f"  {base_table}_{k} | {v.get('type')} | {v.get('label')}")


def main():
    parser = argparse.ArgumentParser(
        description="Read-only Lightdash explore field-ID / space-slug lookup."
    )
    parser.add_argument(
        "--url",
        default=os.environ.get("LIGHTDASH_URL"),
        help="Lightdash base URL (defaults to LIGHTDASH_URL).",
    )
    parser.add_argument(
        "--api-key",
        default=os.environ.get("LIGHTDASH_API_KEY"),
        help="Lightdash personal access token (defaults to LIGHTDASH_API_KEY).",
    )
    parser.add_argument(
        "--project",
        default=os.environ.get("LIGHTDASH_PROJECT"),
        help="Project UUID (defaults to LIGHTDASH_PROJECT).",
    )
    parser.add_argument("--explore", help="Explore (dbt model) name.")
    parser.add_argument(
        "--spaces", action="store_true", help="List space slugs instead of fields."
    )
    parser.add_argument(
        "--json", action="store_true", help="Emit field IDs as JSON."
    )
    args = parser.parse_args()

    if not args.project:
        sys.exit("error: pass --project or set LIGHTDASH_PROJECT.")

    if args.spaces:
        list_spaces(args.url, args.api_key, args.project)
        return
    if not args.explore:
        sys.exit("error: pass --explore <name> (or --spaces).")
    show_explore(args.url, args.api_key, args.project, args.explore, args.json)


if __name__ == "__main__":
    main()
