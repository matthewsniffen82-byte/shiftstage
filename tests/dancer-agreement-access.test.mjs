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
      await assert.rejects(f.createContext(request("/api/dancer/shifts", method, refresh)), e => e.status === 403 && /Dancer Agreement/.test(e.message));
    });
  }
  test(`NFC and age verification cannot bypass agreement acceptance, refresh=${refresh}`, async () => {
    for (const [path, access] of [["/api/nfc/test", { role: "dancer" }], ["/api/dancer/age-verification", { role: "dancer", allowAgeVerification: true }]]) {
      await assert.rejects(requestRoleFixture({ agreementAccepted: false }).createContext(request(path, "POST", refresh), access), e => e.status === 403 && /Dancer Agreement/.test(e.message));
    }
  });
  test(`private profile setup works before acceptance, refresh=${refresh}`, async () => {
    for (const path of ["/api/dancer/photos", "/api/dancer/avatar", "/api/dancer/profile", "/api/dancer/tv/videos", "/api/dancer/media/pin"]) {
      const f = requestRoleFixture({ agreementAccepted: false });
      assert.equal((await f.createContext(request(path, "PATCH", refresh), { role: "dancer", allowProfileSetup: true })).user.id, "verified-owner");
      assert.ok(f.calls.some(c => c[0] === "eq" && c[1] === "user_id" && c[2] === "verified-owner"));
    }
    for (const profile of [null, { status: "approved", verification_status: "approved", is_public: true }, { status: "draft", verification_status: "pending", is_public: true }]) {
      await assert.rejects(requestRoleFixture({ agreementAccepted: false, profile }).createContext(request("/api/dancer/photos", "POST", refresh), { role: "dancer", allowProfileSetup: true }), e => e.status === 403);
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
    await assert.rejects(requestRoleFixture(options).createContext(request("/api/dancer/shifts")), e => e.status === 503 && !e.message.includes("diagnostic"));
  }
});

test("private profile reads and removal stay available without accepting or publishing", async () => {
  for (const path of ["/api/dancer/profile", "/api/dancer/dashboard", "/api/dancer/tv/videos", "/api/dancer/age-verification"]) {
    assert.ok(await requestRoleFixture({ agreementAccepted: false }).createContext(request(path)));
  }
  for (const path of ["/api/dancer/avatar", "/api/dancer/photos", "/api/dancer/tv/videos/synthetic"]) {
    assert.ok(await requestRoleFixture({ agreementAccepted: false }).createContext(request(path, "DELETE"), { role: "dancer" }));
  }
});
