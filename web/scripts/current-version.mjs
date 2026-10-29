// Lit `wrangler deployments status --json` sur stdin et affiche la version principale en ligne (vide si aucune).
let data = "";
process.stdin.on("data", (c) => (data += c));
process.stdin.on("end", () => {
  try {
    const versions = JSON.parse(data).versions ?? [];
    const main = versions.toSorted((a, b) => (b.percentage ?? 0) - (a.percentage ?? 0))[0];
    process.stdout.write(main?.version_id ?? "");
  } catch {
    process.stdout.write("");
  }
});
