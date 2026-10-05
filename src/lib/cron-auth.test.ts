import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isCronAuthorized } from "@/lib/cron-auth";

function request(header?: string): Request {
  return new Request("http://localhost:3000/api/cron/kalender", {
    headers: header ? { authorization: header } : {},
  });
}

describe("isCronAuthorized", () => {
  it("lässt das richtige Geheimnis durch", () => {
    assert.equal(isCronAuthorized(request("Bearer geheim"), "geheim"), true);
  });

  it("weist ein falsches Geheimnis gleicher Länge ab", () => {
    assert.equal(isCronAuthorized(request("Bearer geheiM"), "geheim"), false);
  });

  it("weist eine andere Länge ab, ohne zu werfen", () => {
    assert.equal(isCronAuthorized(request("Bearer geheimer"), "geheim"), false);
    assert.equal(isCronAuthorized(request("Bearer"), "geheim"), false);
    assert.equal(isCronAuthorized(request("geheim"), "geheim"), false);
  });

  it("weist eine Anfrage ohne Header ab", () => {
    assert.equal(isCronAuthorized(request(), "geheim"), false);
  });
});
