import type { AdminOperationsCenter } from "../../src/lib/dancr/admin-operations";

export function adminWorkspaceCounts(operations?: AdminOperationsCenter | null) {
  const attention = operations?.attention;
  const unavailable = (sections: string[]) => !operations || operations.warnings.some(warning => sections.includes(warning.section));
  const approvalSections = ["Dancer approvals", "Photo moderation", "Video moderation", "Social link reviews", "Content reports", "Club signup requests"];
  const approvals = attention ? attention.dancerProfiles + attention.photos + attention.videos + attention.socialLinks + attention.reports + attention.clubRequests : null;
  return {
    home: { value: !operations || operations.warnings.length ? null : attention?.total, label: "need attention" },
    approvals: { value: unavailable(approvalSections) ? null : approvals, label: "to review" },
    people: { value: unavailable(["Accounts"]) ? null : operations?.analytics.totalAccounts, label: "accounts" },
    clubs: { value: operations?.counts?.clubs, label: "clubs" },
    money: { value: operations?.counts?.openInvoices, label: "open invoices" },
    more: { value: unavailable(["Support inbox", "Copyright cases"]) ? null : (attention?.support || 0) + (attention?.dmca || 0), label: "open cases" },
  };
}

export function adminCountLabel(value?: number | null) {
  return value == null ? "—" : value.toLocaleString();
}
