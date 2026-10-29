// Lit `wrangler secret list --format json` sur stdin ; échoue si le secret demandé est absent.
const name = process.argv[2];
let data = "";
process.stdin.on("data", (c) => (data += c));
process.stdin.on("end", () => {
  const names = JSON.parse(data || "[]").map((s) => s.name);
  if (!names.includes(name)) {
    console.error(`::error::secret ${name} absent : lancer « npx wrangler secret put ${name} --env <env> »`);
    process.exit(1);
  }
});
