module.exports = {
  root: true,
  env: {
    node: true
  },
  extends: "eslint:recommended",
  rules: {
    "no-console": process.env.NODE_ENV === "production" ? "error" : "off",
    "no-debugger": process.env.NODE_ENV === "production" ? "error" : "off"
  },
  parserOptions: {
    ecmaVersion: 2018,
    sourceType: "module"
  }
};