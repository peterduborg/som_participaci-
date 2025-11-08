// ESM (package.json: { "type": "module" } ist ok, aber nicht nötig)
export const handler = async () => {
  return { statusCode: 200, body: "OK: function läuft" };
};
