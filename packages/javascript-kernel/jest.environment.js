/* eslint-env node, es2020 */
// Jest 26's node environment does not expose the Fetch API globals that Hono
// needs for `app.request`. Copy them from the outer Node realm.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const NodeEnvironment = require(
  require.resolve('jest-environment-node', {
    paths: [require.resolve('jest-runner')]
  })
);

class FetchApiNodeEnvironment extends NodeEnvironment {
  constructor(config, context) {
    super(config, context);
    for (const name of ['Request', 'Response', 'Headers']) {
      if (typeof this.global[name] === 'undefined') {
        this.global[name] = globalThis[name];
      }
    }
  }
}

module.exports = FetchApiNodeEnvironment;
