/** @type {import("jest").Config} */
module.exports = {
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: {
          module: "ESNext",
          moduleResolution: "Bundler",
          strict: true,
          esModuleInterop: true,
          isolatedModules: true,
          types: ["jest", "node"],
          verbatimModuleSyntax: false,
        },
      },
    ],
  },
  testMatch: ["**/*.test.ts"],
  testTimeout: 120000,
};
