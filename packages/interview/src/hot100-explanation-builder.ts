export function explain(steps: string, pitfall: string, complexity: string, ...notes: [string, string][]) {
  return { steps: steps.split('|'), pitfalls: [pitfall], complexity, annotations: notes.map(([before, comment]) => ({ before, comment })) };
}
