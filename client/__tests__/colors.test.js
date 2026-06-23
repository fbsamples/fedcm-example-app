// Copyright (c) Meta Platforms, Inc. and affiliates.
// All rights reserved.
//
// This source code is licensed under the license found in the
// LICENSE file in the root directory of this source tree.

const { randomColor, hslToHex, hexToHsl, contrastColor, hexToRgba } = require("../colors");

describe("hslToHex", () => {
  test("converts pure red", () => {
    expect(hslToHex(0, 100, 50)).toBe("#ff0000");
  });

  test("converts pure green", () => {
    expect(hslToHex(120, 100, 50)).toBe("#00ff00");
  });

  test("converts pure blue", () => {
    expect(hslToHex(240, 100, 50)).toBe("#0000ff");
  });

  test("converts white", () => {
    expect(hslToHex(0, 0, 100)).toBe("#ffffff");
  });

  test("converts black", () => {
    expect(hslToHex(0, 0, 0)).toBe("#000000");
  });
});

describe("hexToHsl", () => {
  test("converts pure red", () => {
    expect(hexToHsl("#ff0000")).toEqual({ h: 0, s: 100, l: 50 });
  });

  test("converts white", () => {
    expect(hexToHsl("#ffffff")).toEqual({ h: 0, s: 0, l: 100 });
  });

  test("converts black", () => {
    expect(hexToHsl("#000000")).toEqual({ h: 0, s: 0, l: 0 });
  });
});

describe("hslToHex / hexToHsl roundtrip", () => {
  test.each([
    [0, 100, 50],
    [120, 100, 50],
    [240, 100, 50],
    [60, 80, 40],
    [200, 50, 70],
  ])("hsl(%i, %i, %i) roundtrips correctly", (h, s, l) => {
    const hex = hslToHex(h, s, l);
    const result = hexToHsl(hex);
    expect(result.h).toBeCloseTo(h, 0);
    expect(result.s).toBeCloseTo(s, 0);
    expect(result.l).toBeCloseTo(l, 0);
  });
});

describe("contrastColor", () => {
  test("returns black for white background", () => {
    expect(contrastColor("#ffffff")).toBe("#000000");
  });

  test("returns white for black background", () => {
    expect(contrastColor("#000000")).toBe("#ffffff");
  });

  test("returns white for dark blue", () => {
    expect(contrastColor("#000080")).toBe("#ffffff");
  });

  test("returns black for yellow", () => {
    expect(contrastColor("#ffff00")).toBe("#000000");
  });
});

describe("hexToRgba", () => {
  test("converts black", () => {
    expect(hexToRgba("#000000")).toBe("rgba(0, 0, 0, 1)");
  });

  test("converts white", () => {
    expect(hexToRgba("#ffffff")).toBe("rgba(255, 255, 255, 1)");
  });

  test("converts arbitrary color", () => {
    expect(hexToRgba("#a3f2c1")).toBe("rgba(163, 242, 193, 1)");
  });
});

describe("randomColor", () => {
  test("returns a valid 7-character hex string", () => {
    const color = randomColor();
    expect(color).toMatch(/^#[0-9a-f]{6}$/);
  });

  test("returns different colors on successive calls", () => {
    const colors = new Set(Array.from({ length: 20 }, () => randomColor()));
    expect(colors.size).toBeGreaterThan(1);
  });
});
