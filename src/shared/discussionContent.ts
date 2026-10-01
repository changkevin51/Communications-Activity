import type { Part3Scene, PromptId, PromptKind } from './discussion';

export type Choice = { id: string; label: string; short?: string };
export type Slider = { id: string; label: string; short: string; sub?: string };

export type PromptSpec = {
  id: PromptId;
  scene: Part3Scene;
  kind: PromptKind;
  /** played: only people who finished the game · anyone: everyone in the room */
  who: 'played' | 'anyone';
  title: string;
  body?: string;
  choices?: Choice[];
  exclusive?: string[];
  max?: number;
  sliders?: Slider[];
  anchors?: [string, string];
  submitLabel: string;
};

export const PROMPTS: Record<PromptId, PromptSpec> = {
  felt: {
    id: 'felt',
    scene: 'felt',
    kind: 'single',
    who: 'played',
    title: 'Did seeing the other three players change how you felt about your own score?',
    body: 'Private. Only totals appear on the screen.',
    choices: [
      { id: 'yes', label: 'Yes, noticeably', short: 'NOTICEABLY' },
      { id: 'some', label: 'Somewhat', short: 'SOMEWHAT' },
      { id: 'little', label: 'A little', short: 'A LITTLE' },
      { id: 'no', label: 'Not really', short: 'NOT REALLY' },
      { id: 'didnt', label: "I didn't really look at them", short: "DIDN'T LOOK" },
    ],
    submitLabel: 'Send',
  },
  switch: {
    id: 'switch',
    scene: 'switch',
    kind: 'sliders',
    who: 'anyone',
    title: 'Imagine you got 78% on a midterm.',
    body: 'How good would you feel about that 78% if…',
    sliders: [
      { id: 'hi', label: '…most people in your program got around 90%?', short: 'MOST GOT ~90%' },
      { id: 'mid', label: '…the class average was 78%?', short: 'AVERAGE WAS 78%' },
      { id: 'lo', label: '…most people in your program got around 60%?', short: 'MOST GOT ~60%' },
    ],
    anchors: ['Not good at all', 'Really good'],
    submitLabel: 'Send',
  },
  landscape: {
    id: 'landscape',
    scene: 'landscape',
    kind: 'multi',
    who: 'anyone',
    title: 'Where do you most often notice yourself measuring up against other people?',
    body: 'Pick up to three. Private — only totals appear.',
    choices: [
      { id: 'school', label: 'Grades & school', short: 'GRADES & SCHOOL' },
      { id: 'coop', label: 'Co-op & jobs', short: 'CO-OP & JOBS' },
      { id: 'sport', label: 'Sports & fitness', short: 'SPORTS & FITNESS' },
      { id: 'social', label: 'Social media', short: 'SOCIAL MEDIA' },
      { id: 'plans', label: "Friends' plans & milestones", short: "FRIENDS' PLANS" },
      { id: 'gaming', label: 'Gaming', short: 'GAMING' },
      { id: 'creative', label: 'Creative work', short: 'CREATIVE WORK' },
      { id: 'none', label: 'None of these', short: 'NONE OF THESE' },
    ],
    exclusive: ['none'],
    max: 3,
    submitLabel: 'Send',
  },
  mirrors: {
    id: 'mirrors',
    scene: 'mirrors',
    kind: 'sliders',
    who: 'anyone',
    title: 'Alex (made up) hands in a group project.',
    body: 'How good would Alex feel about their own work if…',
    sliders: [
      { id: 'grades', label: '…everyone else in the group got an A, and Alex got a B+?', short: 'EVERYONE ELSE GOT AN A', sub: 'SOCIAL COMPARISON' },
      { id: 'friend', label: "…a friend told Alex their part was the clearest?", short: 'A FRIEND SAID "CLEAREST"', sub: 'REFLECTED APPRAISAL' },
    ],
    anchors: ['Not good at all', 'Really good'],
    submitLabel: 'Send',
  },
};

export type BeatCopy = { kicker: string; headline: string; lines?: string[] };

/** Projector copy per Part 3 scene and beat. Ask/reveal lines are filled in by the renderer from live data. */
export const SCREEN_COPY: Record<Part3Scene, BeatCopy[]> = {
  bridge: [{ kicker: 'PART 3', headline: "NOW IT'S ABOUT YOU.", lines: ['A few private questions on your phone.', 'No right answers. Only totals are ever shown.'] }],
  felt: [
    { kicker: 'DID IT WORK ON YOU?', headline: 'DID SEEING THE OTHER THREE CHANGE HOW YOU FELT ABOUT YOUR SCORE?' },
    { kicker: 'DID IT WORK ON YOU?', headline: 'WHAT YOU SAID.' },
    { kicker: 'DID IT WORK ON YOU?', headline: 'WHAT YOU SAID — AND WHAT YOUR RATINGS DID.' },
    { kicker: 'SOCIAL COMPARISON', headline: '' },
  ],
  switch: [
    { kicker: 'SAME SCORE, DIFFERENT ROOM', headline: 'SAME 78%. THREE DIFFERENT ROOMS.', lines: ['Rate each one on your phone.'] },
    { kicker: 'SAME SCORE, DIFFERENT ROOM', headline: 'THE 78% NEVER MOVED.' },
    { kicker: 'REFERENCE GROUPS', headline: 'WHO YOU COMPARE WITH SETS WHAT A SCORE MEANS.' },
    { kicker: 'REFERENCE GROUPS', headline: '' },
  ],
  landscape: [
    { kicker: 'OUT THERE', headline: 'WHERE DO YOU NOTICE YOURSELF MEASURING UP?', lines: ['Pick up to three on your phone.'] },
    { kicker: 'OUT THERE', headline: 'WHERE THIS CLASS COMPARES.' },
    { kicker: 'OUT THERE', headline: 'HOW MANY OF THESE COMPARISONS DID YOU PICK?' },
  ],
  mirrors: [
    { kicker: 'TWO MIRRORS', headline: 'MEET ALEX. (MADE UP.)', lines: ['1 · Everyone else in the group got an A. Alex got a B+.', '2 · A friend tells Alex their part was the clearest.'] },
    { kicker: 'TWO MIRRORS', headline: 'HOW GOOD WOULD ALEX FEEL?', lines: ['Rate both on your phone.'] },
    { kicker: 'TWO MIRRORS', headline: 'SAME WORK. TWO MIRRORS.' },
    {
      kicker: 'TWO MIRRORS',
      headline: 'LOOKING SIDEWAYS VS. BEING SEEN.',
      lines: ['Social comparison: measuring yourself against other people.', 'Reflected appraisal: seeing yourself through how others see you.'],
    },
    { kicker: 'REFLECTED APPRAISAL', headline: '' },
  ],
  chooser: [
    { kicker: 'WHO CHOSE?', headline: 'WHO CHOSE YOUR COMPARISON TODAY?' },
    { kicker: 'WHO CHOSE?', headline: 'NOW SWAP ONE BOX.' },
    { kicker: 'WHO CHOSE?', headline: 'WHO PICKS YOUR COMPARISONS THE REST OF THE WEEK?', lines: ['You rarely choose the room. Something usually chooses it for you.'] },
    { kicker: 'WHO CHOSE?', headline: '' },
  ],
  circle: [
    { kicker: 'FULL CIRCLE', headline: 'THIS IS WHERE YOU STARTED.', lines: ['Your real scores from the game.'] },
    { kicker: 'FULL CIRCLE', headline: 'EACH OF YOU WAS SHOWN A DIFFERENT ROOM.' },
    { kicker: 'FULL CIRCLE', headline: "YOU DIDN'T CHOOSE WHO YOU COMPARED YOURSELF WITH TODAY.", lines: ["Most days, you don't either."] },
  ],
};

export const PIPELINE = {
  today: ['YOUR SCORE', 'THE APP PICKED 3 PLAYERS', 'YOU SAW THEM', 'YOU RATED YOURSELF'],
  feed: ['YOUR LIFE', 'A FEED PICKS WHAT YOU SEE', 'YOU SEE IT', 'YOU RATE YOURSELF'],
  examples: ['LEADERBOARDS', 'PEOPLE YOU MAY KNOW', 'LIKE & VIEW COUNTS'],
};

export const SCENE_TITLES: Record<Part3Scene, string> = {
  bridge: 'Bridge',
  felt: 'Did it work?',
  switch: 'Room switch',
  landscape: 'Out there',
  mirrors: 'Two mirrors',
  chooser: 'Who chose?',
  circle: 'Full circle',
};
