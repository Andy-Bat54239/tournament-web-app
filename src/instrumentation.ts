export async function register() {
  // Only a server that stays up can keep a timer going, and only when asked to. `register` has to finish before the
  // server is ready, so it starts the loop and returns.
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.BACKGROUND_SYNC === "true") {
    const [{ startBackgroundSync }, { syncResults }] = await Promise.all([import("./server/background"), import("./server/instance")]);
    startBackgroundSync(syncResults);
  }
}
