#!/usr/bin/env node
import * as readline from 'readline';

import { toToolContent } from './response';
import { createE2e } from './tools/create-e2e';
import { createModel } from './tools/create-model';
import { createSource } from './tools/create-source';
import { describeStructure } from './tools/describe-structure';
import { discardChange } from './tools/discard-change';
import { getChange } from './tools/get-change';
import { getLineage } from './tools/get-lineage';
import { getModel } from './tools/get-model';
import { listModels } from './tools/list-models';
import { listProjects } from './tools/list-projects';
import { listTrinoTables } from './tools/list-trino-tables';
import { previewData } from './tools/preview-data';
import { previewModelTool } from './tools/preview-model';
import { previewSource } from './tools/preview-source';
import { publishChange } from './tools/publish-change';
import { reviewChange } from './tools/review-change';
import { runModel } from './tools/run-model';
import { shipChange } from './tools/ship';
import { trinoStatus } from './tools/trino-status';
import { updateModel } from './tools/update-model';
import { useLocalProject } from './tools/use-local-project';
import { useProject } from './tools/use-project';
import { validateModel } from './tools/validate-model';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const projectSelectorProps = {
  projectId: {
    type: 'string',
    description: 'Catalog production project id (e.g. project-a)',
  },
  localPath: {
    type: 'string',
    description: 'Independent local dbt project / workspace path',
  },
  workspaceRoot: { type: 'string' },
  projectPath: { type: 'string' },
  projectName: { type: 'string' },
};

const TOOL_DEFINITIONS = [
  {
    name: 'dj_list_projects',
    description:
      'List production catalog projects (project-a, project-b, …) or discover dbt projects under a local path. Prefer this first so the user can pick a project.',
    inputSchema: {
      type: 'object',
      properties: { ...projectSelectorProps },
    },
  },
  {
    name: 'dj_use_project',
    description:
      'Select a configured production catalog project by id for this session (Mode A).',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'dj_use_local_project',
    description:
      'Select your own local dbt checkout path for independent work (Mode B).',
    inputSchema: {
      type: 'object',
      properties: {
        localPath: { type: 'string' },
        projectName: { type: 'string' },
      },
      required: ['localPath'],
    },
  },
  {
    name: 'dj_describe_structure',
    description:
      'Describe DJ folder conventions and existing groups/topics for the active project. Pass suggestion (e.g. "aws billing") for naming hints.',
    inputSchema: {
      type: 'object',
      properties: {
        ...projectSelectorProps,
        suggestion: { type: 'string' },
      },
    },
  },
  {
    name: 'dj_list_models',
    description: 'List .model.json files in the active or selected dbt project',
    inputSchema: {
      type: 'object',
      properties: {
        ...projectSelectorProps,
        pattern: { type: 'string' },
      },
    },
  },
  {
    name: 'dj_get_model',
    description: 'Read a .model.json file and its generated .sql/.yml artifacts',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceRoot: { type: 'string' },
        modelPath: { type: 'string' },
        includeArtifacts: { type: 'boolean' },
      },
      required: ['modelPath'],
    },
  },
  {
    name: 'dj_validate_model',
    description: 'Validate a DJ model or source JSON against DJ schemas',
    inputSchema: {
      type: 'object',
      properties: {
        ...projectSelectorProps,
        modelPath: { type: 'string' },
        modelJson: { type: 'object' },
        kind: { type: 'string', enum: ['model', 'source'] },
      },
    },
  },
  {
    name: 'dj_preview_model',
    description:
      'Preview generated SQL, YAML, and columns without writing files (artifact-only; no warehouse)',
    inputSchema: {
      type: 'object',
      properties: {
        ...projectSelectorProps,
        modelPath: { type: 'string' },
        modelJson: { type: 'object' },
      },
    },
  },
  {
    name: 'dj_trino_status',
    description:
      'Check whether Trino is configured and reachable (SELECT 1). Required for live source/model data preview.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
      },
    },
  },
  {
    name: 'dj_list_trino_tables',
    description:
      'Browse Trino catalogs → schemas → tables → columns for source discovery before modeling.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        catalog: { type: 'string' },
        schema: { type: 'string' },
        table: { type: 'string' },
      },
    },
  },
  {
    name: 'dj_preview_source',
    description:
      'Sample rows from a Trino source table (SELECT … LIMIT) before creating DJ models.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        catalog: { type: 'string' },
        schema: { type: 'string' },
        table: { type: 'string' },
        limit: { type: 'number' },
        columns: { type: 'array', items: { type: 'string' } },
      },
      required: ['table'],
    },
  },
  {
    name: 'dj_preview_data',
    description:
      'Live model preview via dbt compile/run + Trino. Default uses --defer so upstreams resolve from a shared schema (DJ_DBT_DEFER_SCHEMA / deferSchema, e.g. datamarts_portal) instead of building all upstreams. Set includeUpstream:true only if you must rebuild the full chain.',
    inputSchema: {
      type: 'object',
      properties: {
        ...projectSelectorProps,
        changeSetId: { type: 'string' },
        modelName: { type: 'string' },
        modelPath: { type: 'string' },
        mode: { type: 'string', enum: ['compile', 'run'] },
        includeUpstream: {
          type: 'boolean',
          description: 'Rebuild upstreams with +model (disables defer)',
        },
        defer: {
          type: 'boolean',
          description: 'Default true — dbt --defer --state for unselected upstreams',
        },
        deferSchema: {
          type: 'string',
          description: 'Shared schema for deferred upstreams (default datamarts_portal)',
        },
        statePath: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'dj_create_model',
    description:
      'Create a DJ .model.json (source of truth) and auto-generate sibling .sql + .yml in an isolated change-set. Does not require the DJ VS Code extension. Does not mutate base until dj_ship.',
    inputSchema: {
      type: 'object',
      properties: {
        ...projectSelectorProps,
        model: { type: 'object' },
        overwrite: { type: 'boolean' },
        previewOnly: {
          type: 'boolean',
          description: 'Default true — write into isolated change set',
        },
      },
      required: ['model'],
    },
  },
  {
    name: 'dj_update_model',
    description:
      'Update a DJ .model.json in an isolated change-set and regenerate .sql/.yml. Publish with dj_ship after approval.',
    inputSchema: {
      type: 'object',
      properties: {
        ...projectSelectorProps,
        modelPath: { type: 'string' },
        modelJson: { type: 'object' },
        previewOnly: {
          type: 'boolean',
          description: 'Default true — write into isolated change set',
        },
      },
      required: ['modelPath', 'modelJson'],
    },
  },
  {
    name: 'dj_get_lineage',
    description:
      'Trace upstream/downstream model and source lineage from .model.json dependencies (agent-readable graph; no extension UI)',
    inputSchema: {
      type: 'object',
      properties: {
        ...projectSelectorProps,
        modelPath: { type: 'string' },
        modelName: { type: 'string' },
        upstreamLevels: { type: 'number' },
        downstreamLevels: { type: 'number' },
      },
    },
  },
  {
    name: 'dj_create_source',
    description:
      'Create a .source.json (source of truth) and auto-generate .yml in an isolated change set. No DJ extension required.',
    inputSchema: {
      type: 'object',
      properties: {
        ...projectSelectorProps,
        source: { type: 'object' },
        overwrite: { type: 'boolean' },
        generateYml: { type: 'boolean' },
        previewOnly: { type: 'boolean' },
      },
      required: ['source'],
    },
  },
  {
    name: 'dj_create_e2e',
    description:
      'From a user requirement: create model/source in an isolated change set, return SQL/YAML preview + lineage. Set includeData:true for live Trino rows. After review: dj_review_change then dj_ship.',
    inputSchema: {
      type: 'object',
      properties: {
        ...projectSelectorProps,
        requirement: { type: 'string' },
        model: { type: 'object' },
        source: { type: 'object' },
        overwrite: { type: 'boolean' },
        includePreview: { type: 'boolean' },
        includeLineage: { type: 'boolean' },
        includeData: {
          type: 'boolean',
          description: 'If true and Trino is configured, run dj_preview_data after create',
        },
        dataMode: { type: 'string', enum: ['compile', 'run'] },
        dataLimit: { type: 'number' },
        previewOnly: { type: 'boolean' },
      },
      required: ['requirement'],
    },
  },
  {
    name: 'dj_run_model',
    description:
      'Run a dbt model (write to Trino) then preview rows. If upstream is omitted/ask, returns needsDecision — agent must ask the user: defer upstreams vs build +model, then recall with upstream: defer|build. Auto-parses when manifest is missing.',
    inputSchema: {
      type: 'object',
      properties: {
        ...projectSelectorProps,
        changeSetId: { type: 'string' },
        modelName: { type: 'string' },
        modelPath: { type: 'string' },
        upstream: {
          type: 'string',
          enum: ['ask', 'defer', 'build'],
          description:
            'ask (default) = return decision prompt; defer = --defer to shared schema; build = +model',
        },
        previewLimit: { type: 'number' },
        deferSchema: { type: 'string' },
      },
    },
  },
  {
    name: 'dj_get_change',
    description: 'Get status and files for an isolated change set (prefer dj_review_change for diffs before shipping)',
    inputSchema: {
      type: 'object',
      properties: { changeSetId: { type: 'string' } },
      required: ['changeSetId'],
    },
  },
  {
    name: 'dj_review_change',
    description:
      'Review a change set before PR: status, file list, unified diff, base freshness. Use when user asks to create a PR.',
    inputSchema: {
      type: 'object',
      properties: { changeSetId: { type: 'string' } },
      required: ['changeSetId'],
    },
  },
  {
    name: 'dj_discard_change',
    description: 'Discard an isolated change set and remove its worktree (revert before publish)',
    inputSchema: {
      type: 'object',
      properties: { changeSetId: { type: 'string' } },
      required: ['changeSetId'],
    },
  },
  {
    name: 'dj_ship',
    description:
      'Create PR from a change set: without approval returns suggested commit/PR text; with approval:true + commitMessage commits, pushes, and opens a GitHub/GHE PR. Preferred when user says “create PR”.',
    inputSchema: {
      type: 'object',
      properties: {
        changeSetId: { type: 'string' },
        approval: { type: 'boolean' },
        commitMessage: { type: 'string' },
        prTitle: { type: 'string' },
        prBody: { type: 'string' },
      },
      required: ['changeSetId'],
    },
  },
  {
    name: 'dj_publish_change',
    description:
      'Alias of dj_ship (legacy). Prefer dj_ship. Requires approval: true and commitMessage.',
    inputSchema: {
      type: 'object',
      properties: {
        changeSetId: { type: 'string' },
        approval: { type: 'boolean' },
        commitMessage: { type: 'string' },
        prTitle: { type: 'string' },
        prBody: { type: 'string' },
      },
      required: ['changeSetId', 'approval', 'commitMessage'],
    },
  },
] as const;

type ToolName = (typeof TOOL_DEFINITIONS)[number]['name'];

async function callTool(
  name: ToolName,
  args: Record<string, unknown>,
): Promise<ReturnType<typeof toToolContent>> {
  switch (name) {
    case 'dj_list_projects':
      return toToolContent(await listProjects(args));
    case 'dj_use_project':
      return toToolContent(
        await useProject(args as Parameters<typeof useProject>[0]),
      );
    case 'dj_use_local_project':
      return toToolContent(
        await useLocalProject(args as Parameters<typeof useLocalProject>[0]),
      );
    case 'dj_describe_structure':
      return toToolContent(await describeStructure(args));
    case 'dj_list_models':
      return toToolContent(await listModels(args));
    case 'dj_get_model':
      return toToolContent(await getModel(args as Parameters<typeof getModel>[0]));
    case 'dj_validate_model':
      return toToolContent(await validateModel(args));
    case 'dj_preview_model':
      return toToolContent(await previewModelTool(args));
    case 'dj_trino_status':
      return toToolContent(await trinoStatus(args));
    case 'dj_list_trino_tables':
      return toToolContent(await listTrinoTables(args));
    case 'dj_preview_source':
      return toToolContent(
        await previewSource(args as Parameters<typeof previewSource>[0]),
      );
    case 'dj_preview_data':
      return toToolContent(await previewData(args));
    case 'dj_create_model':
      return toToolContent(
        await createModel(args as Parameters<typeof createModel>[0]),
      );
    case 'dj_update_model':
      return toToolContent(
        await updateModel(args as Parameters<typeof updateModel>[0]),
      );
    case 'dj_get_lineage':
      return toToolContent(await getLineage(args));
    case 'dj_create_source':
      return toToolContent(
        await createSource(args as Parameters<typeof createSource>[0]),
      );
    case 'dj_create_e2e':
      return toToolContent(
        await createE2e(args as Parameters<typeof createE2e>[0]),
      );
    case 'dj_run_model':
      return toToolContent(await runModel(args));
    case 'dj_get_change':
      return toToolContent(
        await getChange(args as Parameters<typeof getChange>[0]),
      );
    case 'dj_review_change':
      return toToolContent(
        await reviewChange(args as Parameters<typeof reviewChange>[0]),
      );
    case 'dj_discard_change':
      return toToolContent(
        await discardChange(args as Parameters<typeof discardChange>[0]),
      );
    case 'dj_ship':
      return toToolContent(
        await shipChange(args as Parameters<typeof shipChange>[0]),
      );
    case 'dj_publish_change':
      return toToolContent(
        await publishChange(args as Parameters<typeof publishChange>[0]),
      );
    default:
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              ok: false,
              errors: [`Unknown tool: ${name}`],
            }),
          },
        ],
        isError: true,
      };
  }
}

function send(message: JsonRpcResponse | Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handleRequest(request: JsonRpcRequest): Promise<void> {
  const { id, method, params } = request;

  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'dj-mcp', version: '0.2.0' },
      },
    });
    return;
  }

  if (method === 'notifications/initialized') {
    return;
  }

  if (method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id,
      result: { tools: TOOL_DEFINITIONS },
    });
    return;
  }

  if (method === 'tools/call') {
    const toolName = params?.name as ToolName;
    const toolArgs = (params?.arguments ?? {}) as Record<string, unknown>;
    try {
      const result = await callTool(toolName, toolArgs);
      send({ jsonrpc: '2.0', id, result });
    } catch (error) {
      send({
        jsonrpc: '2.0',
        id,
        error: {
          code: -32000,
          message: (error as Error).message,
        },
      });
    }
    return;
  }

  if (method === 'ping') {
    send({ jsonrpc: '2.0', id, result: {} });
    return;
  }

  send({
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  });
}

function main(): void {
  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false,
  });

  rl.on('line', (line) => {
    if (!line.trim()) {
      return;
    }
    try {
      const request = JSON.parse(line) as JsonRpcRequest;
      void handleRequest(request);
    } catch (error) {
      send({
        jsonrpc: '2.0',
        error: {
          code: -32700,
          message: `Parse error: ${(error as Error).message}`,
        },
      });
    }
  });
}

main();
