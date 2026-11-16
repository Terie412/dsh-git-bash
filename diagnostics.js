export const inject = ['cordisInspect', 'agentPresets'];
export function apply(ctx) {
  ctx.effect(() => ctx.cordisInspect.register({
    manifest: {
      id: 'GitBashDiagnostics', description: 'Read-only preset activation health.',
      methods: [{ name: 'health', description: 'Read preset errors and active composition.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, outputSchema: { description: 'Preset roster and composition health.' } }],
    },
    async query() {
      let executorImport;
      try { await import('@local/dsh-git-bash'); executorImport = 'ok'; }
      catch (error) { executorImport = { message: error.message, stack: error.stack }; }
      return { executorImport, presets: await ctx.agentPresets.list() };
    },
  }), 'git-bash.diagnostics');
}
