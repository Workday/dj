export type QueryDraftApi =
  | {
      type: 'query-draft-create';
      service: 'query-draft';
      request: { projectName?: string };
      response: { filepath: string };
    }
  | {
      type: 'query-draft-execute';
      service: 'query-draft';
      request: { sql: string; limit?: number };
      response: {
        columns: string[];
        rows: (string | number | boolean | null)[][];
        rowCount: number;
        executionTime?: number;
      };
    };
