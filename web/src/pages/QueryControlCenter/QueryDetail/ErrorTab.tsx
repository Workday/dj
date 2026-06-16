import type { TrinoQueryInfo } from '@shared/trino/types';
import { Alert, Box, Text } from '@web/elements';

export type ErrorTabProps = { info: TrinoQueryInfo };

/**
 * Errors tab content. Renders a success Alert when the query did not
 * fail; otherwise an error Alert (errorCode + errorType + failure
 * message) plus the raw `failureInfo` JSON for the operator who needs
 * to dig further.
 *
 * Layout: the outer wrapper is `h-full min-h-0` and the `failureInfo`
 * box is `flex-1 min-h-0 overflow-auto` so a multi-page stack trace
 * scrolls inside the tab panel instead of pushing the entire detail
 * pane to scroll.
 */
export function ErrorTab({ info }: ErrorTabProps) {
  if (info.summary.state !== 'FAILED' && !info.failureInfo) {
    return (
      <Alert
        label="No errors"
        description="The query executed successfully."
        variant="success"
      />
    );
  }
  return (
    <div className="flex flex-col gap-2 h-full min-h-0">
      <Alert
        label={
          info.summary.errorCode
            ? `${info.summary.errorCode}${
                info.summary.errorType ? ` (${info.summary.errorType})` : ''
              }`
            : 'Query failed'
        }
        description={info.summary.failureMessage}
        variant="error"
      />
      {info.failureInfo && (
        <div className="flex-1 min-h-0 overflow-auto">
          <Box variant="bordered">
            <Text variant="label">failureInfo</Text>
            <pre className="text-xs whitespace-pre-wrap mt-2">
              {JSON.stringify(info.failureInfo, null, 2)}
            </pre>
          </Box>
        </div>
      )}
    </div>
  );
}
