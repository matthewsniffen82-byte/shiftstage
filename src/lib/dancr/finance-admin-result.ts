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
  return { status: 200, body: { ok: true, ...body } };
}

function defaultRefreshFailureLogger(error: unknown) {
  console.error("ADMIN_FINANCE_POST_WRITE_REFRESH_FAILED", { error });
}
