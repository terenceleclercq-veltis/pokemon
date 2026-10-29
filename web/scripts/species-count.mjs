// Lit `wrangler d1 execute --json` (SELECT COUNT(*) AS n FROM species) sur stdin et affiche n (vide si illisible).
let data = "";
process.stdin.on("data", (c) => (data += c));
process.stdin.on("end", () => {
  try {
    const n = JSON.parse(data)[0]?.results?.[0]?.n;
    process.stdout.write(Number.isInteger(n) ? String(n) : "");
  } catch {
    process.stdout.write("");
  }
});
