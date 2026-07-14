/**
 * Error message utility for transforming technical errors into user-friendly messages
 * with collapsible technical details.
 */

export interface ErrorContext {
  type:
    | 'validation'
    | 'api_create'
    | 'api_update'
    | 'file_conflict'
    | 'general';
  mode?: 'create' | 'edit';
  technicalDetails?: string[];
  apiError?: unknown;
}

export interface GenericError {
  title: string;
  message: string;
  technicalDetails: string[];
}

/**
 * Transforms error context into user-friendly error messages with technical details
 */
export function getErrorMessage(context: ErrorContext): GenericError {
  const { type, technicalDetails = [], apiError } = context;

  switch (type) {
    case 'validation':
      return {
        title: 'Unable to Proceed Next Steps...',
        message:
          "Some of the information you entered doesn't meet the required format. Please check your inputs and try again.",
        technicalDetails,
      };

    case 'api_create':
      return {
        title: 'Unable to Create Model...',
        message:
          "We couldn't create your model. This might be due to a duplicate name or configuration issue.",
        technicalDetails: extractApiErrorDetails(apiError, technicalDetails),
      };

    case 'api_update':
      return {
        title: 'Unable to Update Model',
        message:
          "We couldn't save your changes. Please try again or contact support if the issue persists.",
        technicalDetails: extractApiErrorDetails(apiError, technicalDetails),
      };

    case 'file_conflict':
      return {
        title: 'Model Already Exists...',
        message:
          'A model with this name and topic combination already exists. Please choose a different name or topic.',
        technicalDetails,
      };

    case 'general':
    default:
      return {
        title: 'Something Went Wrong...',
        message:
          'We encountered an unexpected issue. Please try again or contact support if the problem persists.',
        technicalDetails: extractApiErrorDetails(apiError, technicalDetails),
      };
  }
}

/**
 * Extracts technical details from API error objects
 */
function extractApiErrorDetails(
  apiError: unknown,
  existingDetails: string[],
): string[] {
  const details = [...existingDetails];

  if (!apiError) {
    return details;
  }

  // Handle Error objects
  if (apiError instanceof Error) {
    if (apiError.message && !details.includes(apiError.message)) {
      details.push(apiError.message);
    }
  }

  // Handle structured error objects with details array
  if (
    typeof apiError === 'object' &&
    apiError !== null &&
    'details' in apiError &&
    Array.isArray(apiError.details)
  ) {
    const errorDetails = (apiError as { details: string[] }).details;
    errorDetails.forEach((detail: string) => {
      if (!details.includes(detail)) {
        details.push(detail);
      }
    });
  }

  // Handle error objects with message property
  if (
    typeof apiError === 'object' &&
    apiError !== null &&
    'message' in apiError &&
    typeof apiError.message === 'string'
  ) {
    const message = (apiError as { message: string }).message;
    if (!details.includes(message)) {
      details.push(message);
    }
  }

  // Handle response.data patterns (common in Axios errors)
  if (
    typeof apiError === 'object' &&
    apiError !== null &&
    'response' in apiError &&
    typeof apiError.response === 'object'
  ) {
    const response = (apiError as { response: Record<string, unknown> })
      .response;
    if (response.data) {
      if (
        typeof response.data === 'string' &&
        !details.includes(response.data)
      ) {
        details.push(response.data);
      } else if (
        typeof response.data === 'object' &&
        response.data !== null &&
        'message' in response.data
      ) {
        const msg = response.data.message;
        if (typeof msg === 'string' && !details.includes(msg)) {
          details.push(msg);
        }
      }
    }
  }

  return details;
}
