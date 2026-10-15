/** Stand-in for the LLM client at the step level. Handlers get { name, system, user }; output goes through the real schema. */
export function createMockLlm(handlers) {
  const calls = [];
  return {
    calls,
    stats: {},
    async completeJson(args) {
      calls.push(args);
      const handler = handlers[args.name] ?? handlers[args.name.split(':')[0]];
      if (!handler) throw new Error(`mock llm: no handler for ${args.name}`);
      return args.schema.parse(await handler(args));
    },
  };
}
