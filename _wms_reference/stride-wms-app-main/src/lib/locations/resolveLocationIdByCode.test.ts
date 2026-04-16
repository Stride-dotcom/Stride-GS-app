import { describe, expect, it } from "vitest";
import { resolveLocationIdByCode } from "./resolveLocationIdByCode";

describe("resolveLocationIdByCode", () => {
  const locations = [
    { id: "loc-a-1", code: "A-01", warehouse_id: "wh-a" },
    { id: "loc-b-1", code: "A-01", warehouse_id: "wh-b" },
    { id: "loc-a-2", code: "B-02", warehouse_id: "wh-a" },
  ];

  it("returns the warehouse-scoped match when codes overlap", () => {
    const id = resolveLocationIdByCode({
      locations,
      code: "A-01",
      warehouseId: "wh-b",
    });

    expect(id).toBe("loc-b-1");
  });

  it("matches case-insensitively and trims whitespace", () => {
    const id = resolveLocationIdByCode({
      locations,
      code: "  b-02 ",
      warehouseId: "wh-a",
    });

    expect(id).toBe("loc-a-2");
  });

  it("returns null when no scoped match exists", () => {
    const id = resolveLocationIdByCode({
      locations,
      code: "A-01",
      warehouseId: "wh-missing",
    });

    expect(id).toBeNull();
  });
});
