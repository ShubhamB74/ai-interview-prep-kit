import { renderToString } from 'react-dom/server';
import { applyOps } from '@prepkit/shared/kitOps';
import BriefSection from '../components/builder/BriefSection.jsx';
import FlashcardsSection from '../components/builder/FlashcardsSection.jsx';
import KitBuilder from '../components/builder/KitBuilder.jsx';
import QuestionsSection from '../components/builder/QuestionsSection.jsx';
import ScheduleSection from '../components/builder/ScheduleSection.jsx';
import { makeKit } from '../../server/test-support/kitFixture.js';

// Every builder section renders (server-side) for a normal kit, a kit with edits, a regenerating kit and thin/empty kits.
const kit = makeKit();
applyOps(kit, [{ op: 'update_question', id: 'q1', patch: { prompt: 'Edited prompt?' } }, { op: 'update_question', id: 'q2', patch: { pinned: true } }]);
const thin = makeKit({ requirements: [{ id: 'r1', text: 'Must with no question', kind: 'technical', priority: 'must' }], questions: [], flashcards: [], days: 2 });
const empty = makeKit({ requirements: [], questions: [], flashcards: [], days: 2 });

const noop = () => {};
const rec = { title: 'T', regen: null };
const html = {};
const r = (name, el) => { html[name] = renderToString(el).replace(/<!-- -->/g, ''); };

r('builder', <KitBuilder rec={rec} kit={kit} saving={false} error={null} onClearError={noop} onEdit={noop} onRegenerate={noop} />);
r('questions', <QuestionsSection kit={kit} regen={null} onEdit={noop} onRegenerate={noop} />);
r('questions-regen', <QuestionsSection kit={kit} regen={{ status: 'running', section: 'questions', category: 'technical' }} onEdit={noop} onRegenerate={noop} />);
r('schedule', <ScheduleSection kit={kit} onEdit={noop} onRegenerate={noop} />);
r('thin-builder', <KitBuilder rec={rec} kit={thin} saving error={{ code: 'X', message: 'boom' }} onClearError={noop} onEdit={noop} onRegenerate={noop} />);
r('thin-brief', <BriefSection kit={thin} regen={null} onEdit={noop} onRegenerate={noop} />);
r('empty-brief', <BriefSection kit={empty} regen={null} onEdit={noop} onRegenerate={noop} />);
r('thin-q', <QuestionsSection kit={thin} regen={null} onEdit={noop} onRegenerate={noop} />);
r('thin-cards', <FlashcardsSection kit={thin} onEdit={noop} />);
r('thin-sched', <ScheduleSection kit={thin} onEdit={noop} onRegenerate={noop} />);

const checks = [
  ['questions render with the user\'s edit', html.questions.includes('Original q2 question?') && html.questions.includes('Edited prompt?')],
  ['edited and pinned badges', html.questions.includes('edited') && html.questions.includes('pinned')],
  ['reorder controls are labelled buttons', html.questions.includes('aria-label="Move question 1 down"')],
  ['category regenerate shows progress and is disabled while running', /Regenerating…/.test(html['questions-regen'])],
  ['empty category state', html['thin-q'].includes('No technical questions yet')],
  ['empty requirements: says the kit is intentionally thin', html['empty-brief'].includes('intentionally thin')],
  ['a must-have with no questions is flagged', html['thin-brief'].includes('no questions') && html['thin-builder'].includes('must-have')],
  ['empty flashcards state', html['thin-cards'].includes('No flashcards yet')],
  ['schedule days and rebuild control', html.schedule.includes('Day 1') && html.schedule.includes('Rebuild schedule')],
  ['save error is announced', html['thin-builder'].includes('could not be saved')],
  ['tabs are a real tablist', html.builder.includes('role="tablist"') && html.builder.includes('aria-selected="true"')],
  ['empty schedule explains itself', html['thin-sched'].includes('Day 2')],
];
let bad = 0;
for (const [name, ok] of checks) { console.log(ok ? 'ok  ' : 'FAIL', name); if (!ok) bad++; }
process.exit(bad ? 1 : 0);
