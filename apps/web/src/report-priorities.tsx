import { useState } from 'react';
import { Button } from 'antd';
import type { Session } from '../../../packages/contracts/src/index';
import { addReviewItem } from './personal-data';

export function ReportPriorities({ session }: { session: Session }) {
  const [message, setMessage] = useState('');
  const priorities = session.turns.map((turn, index) => ({ turn, index })).sort((a, b) => a.turn.assessment.score - b.turn.assessment.score).slice(0, 3);
  return <section className="report-priorities" aria-label="优先复习的 QA"><h3>先复习这几道题</h3><p>按本次评分从低到高选择，改进建议来自对应 QA。{session.modelMode === 'demo' ? '规则演示评分仅供体验流程。' : ''}</p>
    {priorities.map(({ turn, index }) => <article key={turn.question.id ?? index}><strong>第 {index + 1} 题 · {turn.question.competency}</strong><p>{turn.assessment.improvements.join('；')}</p><div className="panel-actions"><Button onClick={() => {
      const element = document.getElementById(`qa-${index}`);
      if (element instanceof HTMLDetailsElement) { const parent = element.parentElement; if (parent instanceof HTMLDetailsElement) parent.open = true; element.open = true; element.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
    }}>查看第 {index + 1} 题依据</Button><Button onClick={() => setMessage(addReviewItem(session, turn, index) ? '已加入面试复习清单，明天再练一次。' : '这道题已在待复习清单中，或清单已满。')}>加入第 {index + 1} 题复习</Button></div></article>)}
    {message ? <p role="status" className="review-message">{message}</p> : null}
  </section>;
}
