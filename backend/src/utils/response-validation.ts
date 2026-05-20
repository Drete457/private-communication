import { logger } from './logger';

import type { Response } from 'express';
import type { z } from 'zod';

type SendValidatedJsonOptions = {
  label: string;
  status?: number;
  errorStatus?: number;
  errorBody?: Record<string, string>;
};

type ValidationIssue = {
  path: PropertyKey[];
};

const getIssuePaths = (issues: ValidationIssue[]): string[] => (
  issues
    .slice(0, 5)
    .map((issue) => issue.path.map(String).join('.'))
    .filter((path) => path.length > 0)
);

const sendValidatedJson = (
  res: Response,
  schema: z.ZodType,
  payload: unknown,
  options: SendValidatedJsonOptions
): Response => {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    logger.error('Invalid response payload', {
      label: options.label,
      issueCount: parsed.error.issues.length,
      issuePaths: getIssuePaths(parsed.error.issues)
    });

    return res.status(options.errorStatus ?? 500).json(options.errorBody ?? { error: 'Invalid response payload' });
  }

  return res.status(options.status ?? 200).json(parsed.data);
};

export { sendValidatedJson };