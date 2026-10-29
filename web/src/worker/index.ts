// Point d'entrée : n'exporter QUE des handlers (workerd refuse toute autre exportation).
import { app } from "./app";
import { scheduledRefresh } from "./cron";

export default {
  fetch: app.fetch,
  scheduled(_event, env, ctx) {
    ctx.waitUntil(scheduledRefresh(env));
  },
} satisfies ExportedHandler<Env>;
