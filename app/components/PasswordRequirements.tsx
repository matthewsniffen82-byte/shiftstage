import { PASSWORD_REQUIREMENTS } from "@/src/lib/dancr/password-policy";

export function PasswordRequirements() {
  return <ul aria-label="Password requirements" style={{ margin: "0 0 4px", paddingLeft: 20, color: "#c5bfd3", fontSize: 13, lineHeight: 1.6 }}>
    {PASSWORD_REQUIREMENTS.map(requirement => <li key={requirement}>{requirement}</li>)}
  </ul>;
}
