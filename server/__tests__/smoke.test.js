// Copyright (c) Meta Platforms, Inc. and affiliates.
// All rights reserved.
//
// This source code is licensed under the license found in the
// LICENSE file in the root directory of this source tree.

const { createPalette, _reset } = require("../palettes");

afterEach(() => _reset());

test("createPalette returns a palette with an id", () => {
  const palette = createPalette({
    name: "Test",
    colors: ["#ff0000", "#00ff00"],
    userId: 1,
    userName: "Tester",
    userPicture: null,
  });
  expect(palette.id).toBe(1);
  expect(palette.name).toBe("Test");
});
