import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const html = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");
const source = html.slice(html.indexOf("    function formatBusinessPhoneNumber("), html.indexOf('    document.getElementById("venueRequestContactPhone").addEventListener("input"'));
const context = vm.createContext({});
vm.runInContext(source, context);

test("business phone adds dashes progressively and accepts pasted phone numbers", () => {
  for (const [input, expected] of [
    ["", ""], ["7", "7"], ["702", "702"], ["7025", "702-5"],
    ["702555", "702-555"], ["7025550", "702-555-0"],
    ["7025550123", "702-555-0123"], ["(702) 555-0123", "702-555-0123"],
    ["17025550123", "1-702-555-0123"], ["+1 (702) 555-0123", "+1-702-555-0123"],
    ["+44 20 7946 0958", "+44 20 7946 0958"], ["702-555-0123 ext 42", "702-555-0123 ext 42"],
    ["702555012345", "702555012345"],
  ]) assert.equal(context.formatBusinessPhoneNumber(input), expected);
});

test("phone editing preserves cursor position and does not trap deletion at a dash", () => {
  for (const [value, cursor, expected, expectedCursor] of [
    ["7025", 4, "702-5", 5],
    ["702555-0123", 3, "702-555-0123", 3],
    ["70555-0123", 2, "705-550-123", 2],
    ["702-9555-0123", 5, "702-9555-0123", 5],
  ]) {
    const input = { value, selectionStart: cursor, selectionEnd: cursor, selectionDirection: "none",
      setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; } };
    context.formatBusinessPhoneInput({ currentTarget: input });
    assert.equal(input.value, expected);
    assert.equal(input.selectionStart, expectedCursor);
    assert.equal(input.selectionEnd, expectedCursor);
  }
});

test("phone formatter leaves in-progress composition untouched", () => {
  const input = { value: "7025" };
  context.formatBusinessPhoneInput({ currentTarget: input, isComposing: true });
  assert.equal(input.value, "7025");
});
