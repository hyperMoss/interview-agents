import { explanationPartA } from './hot100-explanations-a';
import { explanationPartB } from './hot100-explanations-b';
import { explanationPartC } from './hot100-explanations-c';
import { explanationPartD } from './hot100-explanations-d';

export type Hot100Explanation = {
  steps: string[];
  pitfalls: string[];
  complexity: string;
  annotations: { before: string; comment: string }[];
};
export const hot100Explanations: Record<number, Hot100Explanation> = {
  ...explanationPartA, ...explanationPartB, ...explanationPartC, ...explanationPartD,
};

export function annotateHot100Code(code: string, explanation: Hot100Explanation): string {
  const lines = code.split('\n');
  for (const annotation of explanation.annotations) {
    if (lines.filter(line => line.trimStart() === annotation.before).length !== 1) {
      throw new Error(`跟打注释锚点必须唯一：${annotation.before}`);
    }
    if (/[\r\n]/.test(annotation.comment)) throw new Error('代码注释必须为单行。');
  }
  return lines.flatMap(line => {
    const notes = explanation.annotations.filter(annotation => annotation.before === line.trimStart());
    const indent = line.slice(0, line.length - line.trimStart().length);
    return [...notes.map(annotation => `${indent}# ${annotation.comment}`), line];
  }).join('\n');
}
