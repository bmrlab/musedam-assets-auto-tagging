// Optional in-process replacement for the standalone queue-scheduler/CronJob
// deployment (deploy/ack/base.yaml). See instrumentation-node.ts for details.
//
// instrumentation.ts is compiled for both the Node.js and Edge runtimes
// (this app has middleware.ts, so an Edge build always runs). Node-only
// logic must live in a separate module behind exactly this
// `if (process.env.NEXT_RUNTIME === "nodejs")` shape -- Next's build only
// excludes the dynamically imported module from the Edge bundle when it
// recognizes this pattern; anything else (an early return, a negated
// check, inlining the logic here) still gets pulled into the Edge compile
// and fails there, since Edge has no Node polyfills for the transitively
// imported sharp / Prisma / fs modules.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const instrumentationNode = await import("./instrumentation-node");
    await instrumentationNode.register();
  }
}
