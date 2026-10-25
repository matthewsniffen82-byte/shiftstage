export const PASSWORD_REQUIREMENTS = [
  "6+ characters",
  "1 uppercase letter",
  "1 number",
  "1 symbol (! @ # $)",
] as const;

export function passwordRequirementStatus(password: string) {
  return [password.length >= 6, /[A-Z]/.test(password), /[0-9]/.test(password), /[\p{P}\p{S}]/u.test(password)] as const;
}

export function passwordValidationMessage(password: string) {
  if (password.length > 1_024) return "Password is too long.";
  if (!passwordRequirementStatus(password).every(Boolean)) {
    return "Use at least 6 characters, including 1 capital letter, 1 number, and 1 special character.";
  }
  return "";
}
