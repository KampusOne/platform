import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { app } from "../src/app";
import { routeCachePolicy } from "../src/lib/cache-policy";
const manifest = JSON.parse(readFileSync(new URL("../../docs/cache-route-manifest.json", import.meta.url),"utf8")) as {policies: Array<{method:string;path:string;backend:string;authorization:string}>};
describe("whole-platform cache policy inventory", () => {
  it("covers live Hono routes, including nested and overlapping routers", () => {
    const routes = [...new Set(app.routes.filter(route => route.method !== "ALL").map(route => route.method + " " + (route.path.replace(/\/$/,"") || "/")))].sort();
    expect(manifest.policies.map(route => route.method+" "+route.path).sort()).toEqual(routes);
    for (const route of manifest.policies) {
      expect(route.backend).toBe(routeCachePolicy(route.method,route.path).backend);
      expect(route.authorization).not.toBe("");
    }
  });
  it("leaves money, auth, quota, private media and unknown routes authoritative", () => {
    for (const path of ["/v1/payments/summary","/v1/ai/status","/v1/agents/earnings","/v1/account/sessions","/v1/account/restrictions","/v1/media/:id","/v1/student/orders/:id","/v1/new-feature"])
      expect(routeCachePolicy("GET",path).backend).toBe("fresh");
    expect(routeCachePolicy("POST","/v1/maps/route").backend).toBe("versioned-shared-dependency");
  });
});
