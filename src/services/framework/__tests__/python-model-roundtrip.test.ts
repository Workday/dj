import { describe, expect, test } from '@jest/globals';
import {
  buildNotebookCells,
  generatePythonModelScaffoldPy,
  parsePythonToCells,
  serializeCellsToPython,
  stripNotebookOnlyCells,
} from '@services/framework/utils';
import type { PythonModelConfig } from '@shared/framework/types';

/**
 * Round-trip guarantees for the jupytext-style notebook sync.
 *
 * .python.py is the source of truth. Opening the notebook builds cells from
 * the .py; saving the notebook serializes cells back to the .py. These tests
 * lock in lossless round-tripping so real models can never be mangled by a
 * notebook save (the corruption bug this feature fixes).
 */

const CONFIG: PythonModelConfig = {
  name: 'my_model',
  group: 'analytics',
  topic: 'revenue',
  model_type: 'python',
  dags: ['full_source_etl'],
  namespace: 'opus_python_source',
  table_name: 'my_model',
};

describe('parsePythonToCells / serializeCellsToPython', () => {
  test('a marker-less module is a single code cell and round-trips clean', () => {
    const py = [
      '"""Module docstring."""',
      'import logging',
      '',
      'log = logging.getLogger(__name__)',
      '',
      '',
      'def run_etl(context):',
      '    log.info("hello")',
      '',
    ].join('\n');

    const cells = parsePythonToCells(py);
    expect(cells).toHaveLength(1);
    expect(cells[0].cell_type).toBe('code');

    // No markers introduced; content preserved verbatim.
    expect(serializeCellsToPython(cells)).toBe(py);
  });

  test('multi-cell code round-trips through markers', () => {
    const cells = parsePythonToCells(
      ['# %%', 'import os', '', '# %%', 'def f():', '    return os.getcwd()', ''].join(
        '\n',
      ),
    );
    expect(cells).toHaveLength(2);
    expect(cells.every((c) => c.cell_type === 'code')).toBe(true);

    const py = serializeCellsToPython(cells);
    expect(parsePythonToCells(py)).toEqual(cells);
  });

  test('markdown cells round-trip via commented body', () => {
    const py = [
      '# %% [markdown]',
      '# # Heading',
      '#',
      '# some prose',
      '',
      '# %%',
      'x = 1',
      '',
    ].join('\n');

    const cells = parsePythonToCells(py);
    expect(cells[0].cell_type).toBe('markdown');
    expect(cells[1].cell_type).toBe('code');

    // Serializing back reproduces the exact canonical source.
    expect(serializeCellsToPython(cells)).toBe(py);
  });

  test('serialize is stable under a second parse/serialize pass', () => {
    const py = generatePythonModelScaffoldPy(CONFIG);
    const once = serializeCellsToPython(parsePythonToCells(py));
    const twice = serializeCellsToPython(parsePythonToCells(once));
    expect(once).toBe(py);
    expect(twice).toBe(py);
  });
});

describe('buildNotebookCells (notebook view)', () => {
  test('prepends a derived, notebook-only header cell', () => {
    const py = generatePythonModelScaffoldPy(CONFIG);
    const cells = buildNotebookCells(py, CONFIG);

    const header = cells[0];
    expect(header.cell_type).toBe('markdown');
    expect(header.metadata?.dj_notebook_only).toBe(true);
    const headerText = Array.isArray(header.source)
      ? header.source.join('')
      : header.source;
    expect(headerText).toContain('# Python Model: python__analytics__revenue__my_model');
    expect(headerText).toContain('**DAGs**: full_source_etl');
  });

  test('the derived header cell never leaks back into the .py', () => {
    const py = generatePythonModelScaffoldPy(CONFIG);
    const cells = buildNotebookCells(py, CONFIG);

    // notebook -> .py drops the header and reproduces the source exactly.
    expect(serializeCellsToPython(cells)).toBe(py);
  });
});

describe('stripNotebookOnlyCells (persisted .python.json snapshot)', () => {
  test('drops the derived header cell before persisting to JSON', () => {
    const py = generatePythonModelScaffoldPy(CONFIG);
    const notebookCells = buildNotebookCells(py, CONFIG);

    // The header is prepended for the view but must not land in .python.json.
    expect(notebookCells[0].metadata?.dj_notebook_only).toBe(true);

    const persisted = stripNotebookOnlyCells(notebookCells);
    expect(persisted).toEqual(parsePythonToCells(py));
    expect(
      persisted.some((c) => {
        const text = Array.isArray(c.source) ? c.source.join('') : c.source;
        return text.startsWith('# Python Model:');
      }),
    ).toBe(false);
  });

  test('also strips a header cell identified only by its text prefix', () => {
    const headerByText = {
      cell_type: 'markdown' as const,
      metadata: {},
      source: ['# Python Model: python__a__b__c\n', '**DAGs**: (none)'],
    };
    const codeCell = {
      cell_type: 'code' as const,
      metadata: {},
      execution_count: null,
      outputs: [],
      source: ['x = 1'],
    };
    expect(stripNotebookOnlyCells([headerByText, codeCell])).toEqual([codeCell]);
  });
});

describe('.py -> notebook -> .py stability', () => {
  test('a real multi-def module survives an open/save cycle unchanged', () => {
    const py = [
      '"""',
      'Python Model: python__analytics__revenue__my_model',
      'DAGs: full_source_etl',
      '"""',
      'import logging',
      '',
      'from python_models._trino_io import execute_sql, overwrite_partition',
      'from python_models._config import PythonModelConfig, get_catalog_name',
      '',
      'log = logging.getLogger(__name__)',
      '',
      '',
      'def extract(context):',
      '    raise NotImplementedError',
      '',
      '',
      'def transform_and_load(context):',
      '    ds = context["ds"]',
      '    table = f"{get_catalog_name()}.opus_python_source.my_model"',
      '    overwrite_partition(table, "portal_partition_daily", ds, insert_sql="")',
      '',
      '',
      'def run_etl(context):',
      '    extract(context)',
      '    transform_and_load(context)',
      '',
    ].join('\n');

    // Open as a notebook, then serialize the (unedited) cells back.
    const cells = buildNotebookCells(py, CONFIG);
    expect(serializeCellsToPython(cells)).toBe(py);
  });

  test('the generated scaffold survives an open/save cycle unchanged', () => {
    const py = generatePythonModelScaffoldPy(CONFIG);
    const cells = buildNotebookCells(py, CONFIG);
    expect(serializeCellsToPython(cells)).toBe(py);
  });
});
