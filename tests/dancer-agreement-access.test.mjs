import assert from "node:assert/strict";
import test from "node:test";
import { requestRoleFixture } from "./helpers/request-role-fixture.mjs";

const request = (path, method = "GET", refresh = false) => new Request("https://mydancr.com" + path, {
  method, headers: { authorization: "Bearer test-access", ...(refresh ? { "x-dancr-refresh-token": "test-refresh" } : {}) },
});

for (const refresh of [false, true]) {
  for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
    test(`unaccepted dancer cannot use ${method} dancer features, refresh=${refresh}`, async () => {
      const f = requestRoleFixture({ agreementAccepted: false });
      await assert.rejects(f.createContext(request("/api/dancer/profile", method, refresh)), e => e.status === 403 && /Dancer Agreement/.test(e.message));
    });
  }
  test(`profile setup and NFC cannot bypass agreement acceptance, refresh=${refresh}`, async () => {
    for (const [path, access] of [["/api/dancer/photos", { role: "dancer", allowProfileSetup: true }], ["/api/nfc/test", { role: "dancer" }], ["/api/dancer/age-verification", { role: "dancer", allowAgeVerification: true }]]) {
      await assert.rejects(requestRoleFixture({ agreementAccepted: false }).createContext(request(path, "POST", refresh), access), e => e.status === 403 && /Dancer Agreement/.test(e.message));
    }
  });
}
for (const path of ["/api/account", "/api/auth", "/api/support", "/api/dancer/agreement"]) {
  test(`${path} remains available to review, accept, sign out, get help or delete an account`, async () => {
    const f = requestRoleFixture({ agreementAccepted: false });
    assert.equal((await f.createContext(request(path))).user.id, "verified-owner");
    assert.equal(f.calls.some(c => c[0] === "rpc"), false);
  });
}
test("accepted dancers retain feature access and database failures fail closed", async () => {
  assert.equal((await requestRoleFixture().createContext(request("/api/dancer/profile"), { role: "dancer" })).user.id, "verified-owner");
  for (const options of [{ agreementError: { message: "private diagnostic" } }, { agreementData: {} }]) {
    await assert.rejects(requestRoleFixture(options).createContext(request("/api/dancer/profile")), e => e.status === 503 && !e.message.includes("diagnostic"));
  }
});
