import { PASSWORD_REQUIREMENTS, passwordRequirementStatus } from "@/src/lib/dancr/password-policy";

export function PasswordRequirements({ password }: { password?: string } = {}) {
  const met = passwordRequirementStatus(password || "");
  return <ul aria-label="Password requirements" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "4px 16px", margin: "0 0 4px", paddingLeft: password === undefined ? 20 : 0, listStyle: password === undefined ? undefined : "none", color: "var(--dancr-color-text-secondary)", fontSize: 13, lineHeight: 1.6 }}>
    {PASSWORD_REQUIREMENTS.map((requirement, index) => <li key={requirement}
      aria-label={password === undefined ? undefined : `${met[index] ? "Met" : "Not yet met"}: ${requirement}`}
      style={password === undefined ? undefined : { display: "grid", gridTemplateColumns: "16px minmax(0, 1fr)", gap: 6, color: met[index] ? "var(--dancr-color-success)" : "var(--dancr-color-text-secondary)" }}>
      {password === undefined ? null : <span aria-hidden="true">{met[index] ? "✓" : "•"}</span>}
      {requirement}
    </li>)}
  </ul>;
}
