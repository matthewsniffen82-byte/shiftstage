type AccountActionEmail = {
  introduction: string;
  label: string;
  url: string;
  notes: string[];
};

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export function accountActionEmailHtml({ introduction, label, url, notes }: AccountActionEmail) {
  return [
    `<p>${escapeHtml(introduction)}</p>`,
    `<p><a href="${escapeHtml(url)}">${escapeHtml(label)}</a></p>`,
    ...notes.map(note => `<p>${escapeHtml(note)}</p>`),
  ].join("");
}
