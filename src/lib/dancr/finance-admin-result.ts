export type AdminFinanceSuccessResult = {
  status: 200;
  body: Record<string, unknown> & { ok: true };
};

type RefreshFailureLogger = (error: unknown) => void;

export async function successfulFinanceMutation(
  loadFinance: () => Promise<Record<string, unknown>>,
  details: Record<string, unknown> = {},
  logRefreshFailure: RefreshFailureLogger = defaultRefreshFailureLogger,
): Promise<AdminFinanceSuccessResult> {
  try {
    const finance = await loadFinance();
    return success({ ...details, finance });
  } catch (error) {
    logRefreshFailure(error);
    return success({ ...details, financeRefreshRequired: true });
  }
}

function success(body: Record<string, unknown>): AdminFinanceSuccessResult {
  const result = body.result;
  const publicBody = result && typeof result === "object" && "errors" in result && Array.isArray(result.errors)
    ? {
      ...body,
      result: {
        ...result,
        errors: result.errors.map(() => "Some finance work needs review. Check current invoice and payout states before retrying."),
      },
    }
    : body;
  return { status: 200, body: { ok: true, ...publicBody } };
}

function defaultRefreshFailureLogger(error: unknown) {
  console.error("ADMIN_FINANCE_POST_WRITE_REFRESH_FAILED", safeErrorMetadata(error));
}
import { safeErrorMetadata } from "../security/safe-error-metadata.ts";
