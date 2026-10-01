/**
 * Presenter-only speaker notes. Served on the presenter view, never on the
 * projector state or the participant protocol. Do not import this from
 * src/client or src/screen.
 */
import type { Pattern, RevealData, SceneId, WorldKey } from '../../shared/reveal';
import { fmt } from '../../shared/revealCopy';

export type NotesExtra = {
  assist?: { shaped: number; filled: number; assigned: number; added: number } | null;
  /** Quote saved for this Part 3 slot, if the beat is showing one. */
  slotText?: string | null;
  /** Choice counts, or slider medians, from the presenter question panel. */
  questionSplit?: { id: string; n: number }[] | null;
};

const WORLD: Record<WorldKey, string> = { up: 'Saw higher', neutral: 'Saw similar', down: 'Saw lower' };

function deltaLine(d: RevealData): string {
  const bit = (w: WorldKey) => `${WORLD[w]} ${fmt(d.worlds[w].meanDelta, 'delta')}`;
  return `LIVE: ${bit('up')} · ${bit('neutral')} · ${bit('down')}`;
}

function feltLive(extra?: NotesExtra): string | null {
  const s = extra?.questionSplit;
  if (!s?.length) return null;
  const label: Record<string, string> = { yes: 'noticeably', some: 'somewhat', little: 'a little', no: 'not really', didnt: "didn't look" };
  if (s.every((x) => x.n === 0)) return null;
  return `LIVE: ${s.map((x) => `${label[x.id] ?? x.id} ${x.n}`).join(' · ')}`;
}

function sliderLive(extra: NotesExtra | undefined, labels: Record<string, string>): string | null {
  const s = extra?.questionSplit;
  if (!s?.length || s.every((x) => x.n === 0)) return null;
  return `LIVE: ${s.map((x) => `${labels[x.id] ?? x.id} ${x.n}`).join(' · ')}`;
}

function interpret(pattern: Pattern): string[] {
  switch (pattern) {
    case 'expected':
      return [
        'IF EXPECTED: In this room, people shown higher performers tended to rate themselves lower, and people shown lower performers tended to rate themselves higher.',
        'SAY: That fits the idea that who we compare ourselves with can affect how we evaluate ourselves.',
        'CAUTION: Do not say we proved social comparison.',
      ];
    case 'partial':
      return [
        'IF WEAK: The direction matches that simple pattern, but the differences are pretty small.',
        'SAY: That\'s completely okay. This isn\'t a controlled research study.',
        'SAY: What the activity still shows clearly is the process: you got different comparison information, then you evaluated yourself again.',
        'CAUTION: Do not say we proved an effect.',
      ];
    case 'flat':
      return [
        'IF FLAT: The differences here are pretty small.',
        'SAY: That\'s completely okay. This isn\'t a controlled research study.',
        'SAY: What the activity still shows clearly is the process: you got different comparison information, then you evaluated yourself again.',
        'CAUTION: Do not say the chart proves an effect.',
      ];
    case 'reversed':
      return [
        'IF REVERSED: Our result moved differently from the simple pattern we might expect.',
        'ASK: Why might seeing someone better than you sometimes increase motivation or confidence rather than decrease it?',
        'CAUTION: Don\'t smooth this into the pattern you hoped for. Read the room you actually have.',
      ];
    case 'mixed':
      return [
        'IF MIXED: Our class doesn\'t show one simple pattern.',
        'SAY: That\'s useful too. Social comparison isn\'t a button where one input always produces the same reaction.',
        'ASK: Why might the same upward comparison discourage one person but motivate another?',
      ];
    default:
      return [
        'IF THIN: Too few second ratings to call a pattern.',
        'SAY: Stay with the process: different comparison information, then a second look at yourself. Don\'t invent a direction.',
      ];
  }
}

function feltPattern(pattern: Pattern): string {
  switch (pattern) {
    case 'expected':
      return 'IF EXPECTED: The ratings moved in the simple direction. If a lot of people said they weren\'t affected, say that gap: the number can move even when the memory doesn\'t.';
    case 'partial':
      return 'IF WEAK: The rating shifts are small. Don\'t tell them the chart proves they were influenced.';
    case 'flat':
      return 'IF FLAT: Ratings barely moved. If people say they felt something, take that seriously — and don\'t claim the scores prove an effect.';
    case 'reversed':
      return 'IF REVERSED: Ratings moved opposite the simple pattern. Ask why seeing someone better might motivate instead of discourage.';
    case 'mixed':
      return 'IF MIXED: No single pattern. Useful. Comparison isn\'t a button.';
    default:
      return 'IF THIN: Too few second ratings to line up with what people remember. Stay with the conversation.';
  }
}

function ratingLines(d: RevealData | null): string[] {
  if (!d || !d.selfRating.ok) return ['NOTE: Not enough first ratings yet to talk about a relationship.'];
  if (d.selfRating.corr === 'clear') return ['IF OBVIOUS: There is some relationship between performance and self-rating, which makes sense.'];
  if (d.selfRating.corr === 'none') return ['IF NOT: Our objective scores and our own judgments don\'t line up perfectly.'];
  return ['SAY: Don\'t force a tight story out of this scatter.'];
}

function sameScoreOpen(d: RevealData | null): string[] {
  const mode = d?.samescore?.mode;
  if (mode === 'illustration') {
    return [
      'CAUTION: Illustration only. There weren\'t enough real scores to build this from the room.',
      'SAY: This is an illustration of the setup, not three people from today.',
      'DO NOT SAY: that these are the scores someone here actually saw.',
    ];
  }
  if (mode === 'example') {
    return [
      'CAUTION: An example built from real scores in this room, not three classmates who tied.',
      'SAY: These are real scores from this room, arranged so we can see the contrast. They aren\'t one person\'s actual screen.',
      'SAY: The achievement in each column is basically comparable.',
    ];
  }
  return [
    'SAY: Here are people with roughly the same actual performance.',
    'SAY: Their achievement is basically comparable.',
    ...(mode === 'real' ? ['SAY: These are real players from this room.'] : []),
  ];
}

function worldsCaution(d: RevealData | null): string[] {
  if (!d) return [];
  const ms = (['up', 'neutral', 'down'] as const).map((w) => d.worlds[w].meanScore).filter((x): x is number => x !== null);
  if (ms.length < 2) return [];
  const spread = Math.max(...ms) - Math.min(...ms);
  if (spread > 60) {
    return ['CAUTION: The group averages are far apart. Don\'t say the groups were matched. If the caption says "roughly similar," trust the numbers instead.'];
  }
  return [];
}

function honesty(scene: SceneId, beat: number, data: RevealData | null, extra?: NotesExtra): string[] {
  const show = (scene === 'compare' && beat === 1) || (scene === 'mechanism' && beat === 1) || (scene === 'movement' && beat === 2) || (scene === 'felt' && beat === 2);
  if (!show) return [];
  const out: string[] = [];
  if (data?.source === 'demo') out.push('CAUTION: Rehearsal. These numbers are synthetic. Say so if anyone asks. Don\'t present them as this class.');
  const a = extra?.assist;
  if (a && (a.shaped || a.filled || a.assigned || a.added)) {
    const bits = [
      a.shaped ? `rewrote ${a.shaped} rating paths` : '',
      a.filled ? `filled ${a.filled} missing ratings` : '',
      a.assigned ? `gave ${a.assigned} people a room` : '',
      a.added ? `added ${a.added} players` : '',
    ].filter(Boolean);
    out.push(`CAUTION: Assist ${bits.join(', ')}. Describe the process. Don't present every mark as an untouched classmate result.`);
  }
  return out;
}

function mirrorQuoteNote(slot?: string | null): string {
  if (slot && /mirroring/i.test(slot)) return 'NOTE: The quote is on the next beat. Don\'t read it yet.';
  return 'NOTE: No mirroring quote is saved next. Say it yourself: "a mirroring of others\' judgments." Interplay, Chapter 3, p. 72.';
}

function script(scene: SceneId, beat: number, data: RevealData | null, extra?: NotesExtra): string[] {
  switch (scene) {
    case 'lobby':
      return [
        'SAY: We\'re going to start with an activity before we tell you what our topic is.',
        'SAY: Scan the QR code, join the room, and just follow whatever appears on your phone.',
        'SAY: Try not to compare screens with the people beside you yet.',
        'DO NOT SAY: social comparison, reference groups, reflected appraisal, self-concept, or that there are different versions.',
        'GOAL: Keep the topic a mystery.',
        'NOTE: Next opens the game on their phones.',
      ];
    case 'playing':
      return [
        'SAY: Once you\'re in, go ahead and complete the activity at your own pace.',
        'SAY: When you\'re finished, follow the instructions on your phone and then look back up here.',
        'NOTE: Don\'t narrate the game unless people are clearly stuck.',
        'NOTE: Next moves to Eyes up and sends the three other scores. Wait until "playing" is near zero.',
        'DO NOT SAY: scores, comparison, or what the phone is about to show them.',
      ];
    case 'hold':
      return [
        'NOTE: Arriving here sends the three scores. People may still be on the second rating. Let "done" climb before you talk.',
        'PAUSE: When the done count levels off —',
        'SAY: Alright, if you\'re finished, put your phone down for a second and look up here.',
        'SAY: Don\'t talk about what you saw yet.',
        'PAUSE: Wait until the room actually settles.',
        'SAY: We\'re going to show you what was actually happening.',
        'NOTE: Close joins. Confirm the projector. Then hold BEGIN REVEAL. That freezes the snapshot. Enter twice does the same.',
        'DO NOT SAY: the three rooms, or why those other scores were chosen.',
      ];
    case 'onegame':
      if (beat <= 0) {
        return [
          'SAY: First, all of you played the same basic game.',
          'POINT OUT: These dots are the actual scores from this room.',
          'SAY: Right now we\'re only looking at objective performance.',
          'SAY: Everyone was evaluated using the same scoring system.',
          'DO NOT SAY: comparison, or how anyone felt.',
          ...(data && data.n.eligible === 0 ? ['NOTE: Snapshot is empty. RESNAP when people finish.'] : []),
        ];
      }
      if (beat === 1) {
        return [
          'POINT OUT: The average and the middle score, if they\'re on screen.',
          'SAY: The important part isn\'t who got the best score.',
          'SAY: At this point, your score existed without any information about how anyone else did.',
        ];
      }
      return [
        'SAY: Every score was calculated the same way, from the same rounds.',
        'TRANSITION: Then we asked you something different.',
      ];
    case 'selfrating':
      if (data && !data.selfRating.ok) {
        return ['NOTE: Not enough first ratings to show.', 'SAY: We asked how well you thought you did, before any other scores. We just don\'t have enough of those yet.'];
      }
      if (beat <= 0) {
        return [
          'SAY: After the game, before seeing the other players, we asked how well you felt you performed.',
          'POINT OUT: Across is the actual performance. Up is the judgment of it.',
          'SAY: Objective performance and self-evaluation are not the same thing.',
        ];
      }
      return [
        ...ratingLines(data),
        'SAY: But this was still before the part we were actually interested in.',
      ];
    case 'cut':
      if (beat <= 0) {
        return [
          'SAY: After that first rating, your phone showed you three other players.',
          'SAY: At the time, that probably looked like ordinary game stats.',
          'PAUSE: Let that land.',
        ];
      }
      return [
        'ASK: Quick show of hands. Who actually looked at those other three scores?',
        'PAUSE: Let the room answer.',
        'SAY: Good — because those three scores weren\'t as random as they looked.',
        'TRANSITION: Next we show what was different about them.',
        'DO NOT SAY: upward, downward, or reference groups yet.',
      ];
    case 'samescore':
      if (!data?.samescore && beat === 0) return ['NOTE: This scene is skipped when there\'s nothing to build it from.'];
      if (beat <= 0) return sameScoreOpen(data);
      if (beat === 1) return ['SAY: Same neighborhood of scores. Not a trick of the scoring system.'];
      if (beat === 2) {
        return [
          'SAY: But they didn\'t see the same social environment.',
          'POINT OUT: One could see people above them.',
          'POINT OUT: One could see people near them.',
          'POINT OUT: One could see people below them.',
        ];
      }
      return [
        'SAY: The score itself didn\'t change.',
        'PAUSE: Let that sit.',
        'SAY: What changed was the context surrounding it.',
        'SAY: Same performance. Different context.',
        'TRANSITION: This is where Chapter 3 starts becoming useful.',
      ];
    case 'worlds':
      if (beat <= 0) {
        return [
          'SAY: Behind the scenes, the program put people into three different comparison environments.',
          'SAY: Some of you saw people who scored above you. Some saw people around your level. Some saw people below you.',
          'SAY: You were never told these different versions existed.',
        ];
      }
      if (beat === 1) {
        return [
          'SAY: The thing we were changing was the social information surrounding your own result.',
          ...worldsCaution(data),
        ];
      }
      return [
        'SAY: Chapter 3 calls the broader process social comparison: evaluating ourselves in comparison with other people.',
        'PARTNER: The people we use for those comparisons are called reference groups.',
        'SAY: The chapter describes them as "others against whom we evaluate our own characteristics."',
        'SAY: In our activity, we decided which "others" you got to see.',
        'POINT OUT: The labels just changed. Stronger performers: an upward comparison. Similar performers: a lateral comparison. Lower performers: a downward comparison.',
        'CAUTION: Don\'t imply each direction always feels the same. Reference groups sit inside social comparison. They aren\'t a separate theory.',
      ];
    case 'movement':
      if (data && data.n.paired < 3) {
        return [
          'NOTE: Not enough second ratings to show movement.',
          'SAY: We don\'t have enough people who rated twice to draw this yet.',
          'NOTE: RESNAP if more people have finished. Otherwise describe the process without the chart.',
        ];
      }
      if (beat <= 0) {
        return [
          'SAY: Now let\'s bring back your first self-ratings.',
          'SAY: These were your judgments before seeing the other players.',
        ];
      }
      if (beat === 1) {
        return [
          'SAY: After we showed you those selected scores, we asked the exact same question again.',
          'PAUSE: One beat.',
          'SAY: Your game performance had not changed between those two questions.',
        ];
      }
      if (beat === 2) {
        return [
          'SAY: These lines show how people\'s self-ratings changed.',
          'POINT OUT: Some went up. Some went down. Some barely moved.',
          'SAY: We\'re not saying everyone responds to comparison the same way.',
          'SAY: We\'re looking at what happened in this room.',
          ...(data ? [deltaLine(data)] : []),
          'NOTE: Don\'t explain the group pattern yet. That\'s the next scene.',
        ];
      }
      return [
        'POINT OUT: Each lane\'s average change.',
        'SAY: We\'ll put that in words on the next slide.',
        ...(data ? [deltaLine(data)] : []),
        'CAUTION: Don\'t interpret it before the chart does.',
      ];
    case 'compare':
      if (beat <= 0) {
        return [
          'SAY: Positive means the second self-rating was higher. Negative means it was lower.',
          ...(data ? [deltaLine(data)] : []),
          'SAY: Read the three numbers before you explain them.',
          'PAUSE: Let people see the chart.',
          'CAUTION: Don\'t force an interpretation on this beat.',
        ];
      }
      return [
        'SAY: This slide is describing this room. Read the headline, then use only the matching note.',
        ...(data ? [deltaLine(data), ...interpret(data.pattern)] : [
          'IF EXPECTED: Groups moved with the simple pattern — higher comparisons, lower self-ratings, and the reverse. Say it fits the idea. Do not say we proved it.',
          'IF WEAK: Direction matches, but the gaps are small. This isn\'t a controlled study. The process is still clear.',
          'IF FLAT: Differences are small. Say that\'s okay, and stay with the process.',
          'IF REVERSED: It went the other way. Ask why seeing someone better might motivate instead of discourage.',
          'IF MIXED: No one pattern. Ask why the same upward comparison might discourage one person and motivate another.',
          'IF THIN: Too few ratings. Don\'t invent a direction.',
        ]),
      ];
    case 'mechanism':
      if (beat <= 0) {
        return [
          'SAY: So here\'s the sequence.',
          'POINT OUT: You played. You got a score. You evaluated yourself. We selected other people for you to see. You evaluated yourself again.',
          'SAY: The part we deliberately changed was who you saw.',
        ];
      }
      return [
        'SAY: Everyone was shown three other players.',
        'ASK: Why did seeing only a few selected classmates matter at all, when your actual performance had not changed?',
        'PAUSE: Let that question hang. Don\'t answer it yet.',
        'NOTE: The reference-group line is "others against whom we evaluate our own characteristics." Interplay, Chapter 3, p. 72.',
        'SAY: If the next slide is that quote, read it there. We changed those others.',
        'SAY: If the next slide is Bridge, say the line yourself, then move on.',
        'NOTE: Reflected appraisal comes later, with Alex. Don\'t teach it here.',
      ];
    case 'concept':
      if (beat <= 0) {
        return [
          'SAY: Read the quotation on screen once.',
          'SAY: If it says "others against whom we evaluate our own characteristics," that\'s the textbook\'s language for reference groups.',
          'SAY: We changed the "others against whom" you were evaluating your result.',
          'DO NOT SAY: a long explanation.',
          'CAUTION: Don\'t introduce reflected appraisal on this slide.',
          'TRANSITION: Now we want to know whether you actually felt that happening.',
        ];
      }
      return [
        'CAUTION: A second quote here is early. The mirroring line belongs with Alex.',
        'SAY: If you leave it up, read it once and move on. Don\'t build the theory yet.',
      ];
    case 'bridge':
      return [
        'SAY: So far we\'ve looked at what happened in the data.',
        'SAY: Now we want to know what the experience actually felt like.',
        'SAY: We\'ll send a few short anonymous questions to your phones.',
        'SAY: Your individual answer won\'t be displayed. We\'ll look at the class response and then talk about it.',
        'NOTE: Phones light up on the next scene, not this one.',
      ];
    case 'felt':
      if (beat <= 0) {
        return [
          'SAY: Answer based on what you remember feeling, not what you think you\'re supposed to say.',
          'NOTE: When the count levels off, hit Close now.',
          'DO NOT SAY: what the ratings did. That\'s two beats from now.',
        ];
      }
      if (beat === 1) {
        return [
          'SAY: Here\'s how the class described the experience.',
          ...(feltLive(extra) ? [feltLive(extra)!] : []),
          'ASK: Is anybody surprised by this?',
          'PARTNER: Someone who said it affected you — what changed?',
          'PARTNER: Someone who said it didn\'t — why do you think those scores didn\'t matter?',
        ];
      }
      if (beat === 2) {
        return [
          'SAY: Now we\'re comparing two different things.',
          'POINT OUT: What you remember feeling.',
          'POINT OUT: How your actual rating changed.',
          ...(data ? [deltaLine(data), feltPattern(data.pattern)] : ['NOTE: Compare the bars with the rating line under them. Don\'t decide the story before you look.']),
          'ASK: Do we always notice when comparison is affecting how we evaluate ourselves?',
          'CAUTION: Don\'t answer that for them.',
        ];
      }
      return [
        'SAY: If a quote is on screen, read it once and stop.',
        'CAUTION: Don\'t invent a citation for this beat. The two lines we want are the reference-group line and, later, "a mirroring of others\' judgments."',
        'TRANSITION: The 78% is a more familiar version of the same idea.',
      ];
    case 'switch':
      if (beat <= 0) {
        return [
          'SAY: Let\'s take the game away and use something more familiar.',
          'SAY: Imagine you get 78% on a midterm. The grade stays exactly the same.',
          'SAY: Rate how you\'d feel about that grade in each situation.',
          'NOTE: Wait for the count to level off, then Close now.',
        ];
      }
      if (beat === 1) {
        return [
          'SAY: The 78 never moved.',
          'PAUSE: One beat.',
          'SAY: What changed was the group surrounding it.',
          ...(sliderLive(extra, { hi: 'most ~90', mid: 'average 78', lo: 'most ~60' }) ? [sliderLive(extra, { hi: 'most ~90', mid: 'average 78', lo: 'most ~60' })!] : []),
          'NOTE: Say the medians only after you\'ve glanced at them. Don\'t invent a gap.',
        ];
      }
      if (beat === 2) {
        return [
          'SAY: This is why reference groups matter.',
          'SAY: The textbook isn\'t only saying that we compare ourselves with others.',
          'SAY: It\'s saying the particular people we use as comparison standards can influence our self-concept and self-esteem.',
          'ASK: What makes one group a meaningful reference group while another barely matters?',
          'PAUSE: Let the class answer first.',
          'FOLLOW-UP: Only after they speak — similarity, closeness, belonging, expertise, competition, aspiration. Not a checklist, and not an exhaustive textbook list.',
          'SAY: In our game, the app supplied you with a temporary reference group.',
          'NOTE: If you have a breath — Chapter 3 also says an inappropriate reference group can distort how we evaluate ourselves, and that a more representative sample can make a self-concept more realistic. Then stop.',
        ];
      }
      return [
        extra?.slotText && /others against whom/i.test(extra.slotText)
          ? 'SAY: This is the textbook\'s language for reference groups.'
          : 'SAY: Read the quote that is actually on screen. Don\'t substitute a different line.',
        'SAY: This is basically the exact variable our app controlled. We changed the "others against whom" you evaluated your result.',
        'NOTE: If you already read this, one sentence is enough.',
        'DO NOT SAY: a long gloss.',
      ];
    case 'landscape':
      if (beat <= 0) {
        return [
          'SAY: Think outside this game.',
          'SAY: Pick up to three areas where you most notice yourself comparing with other people.',
          'NOTE: Optional scene. Close when the count settles.',
        ];
      }
      if (beat === 1) {
        return [
          'SAY: These are the areas that came up most in this room.',
          'ASK: For people who chose this one — who is usually the reference group?',
          'NOTE: Friends, classmates, coworkers, people online, upper-year students, experts — only if the room is already heading there.',
          'CAUTION: Don\'t psychoanalyze anyone\'s answer.',
        ];
      }
      return [
        'SAY: The slide is asking how many of these comparisons you actually picked.',
        'ASK: How many of these rooms did you choose — and how many were just there?',
        'TRANSITION: There\'s another way other people affect how we see ourselves, and it isn\'t comparison.',
      ];
    case 'mirrors':
      if (beat <= 0) {
        return [
          'SAY: So far, everything we\'ve discussed has involved comparing ourselves with other people.',
          'SAY: Chapter 3 describes another process that works differently.',
          'SAY: Alex is fictional. We\'re using the two situations to separate two ideas.',
          'POINT OUT: A B+ while everyone else gets an A. And a friend saying Alex\'s part was the clearest.',
        ];
      }
      if (beat === 1) {
        return [
          'SAY: Rate how you think Alex would feel about their own work in each situation.',
          'NOTE: Close when the count levels off.',
        ];
      }
      if (beat === 2) {
        return [
          'POINT OUT: The B+ against the A\'s. Alex is learning about the work by comparing it with other people\'s work. That\'s social comparison.',
          'PARTNER: The friend. Alex is receiving another person\'s judgment. That\'s a different source of self-information.',
          'SAY: Same work. Two different mirrors.',
          ...(sliderLive(extra, { grades: 'B+ vs A\'s', friend: 'friend' }) ? [sliderLive(extra, { grades: 'B+ vs A\'s', friend: 'friend' })!] : []),
        ];
      }
      if (beat === 3) {
        return [
          'ASK: How is judging yourself through someone else\'s performance different from judging yourself through how you think they see you?',
          'PAUSE: Take one or two answers.',
          'SAY: Social comparison asks, "How do I compare with them?"',
          'SAY: Reflected appraisal asks, "How do other people see me, and what does that tell me about myself?"',
          'SAY: Our original game was not reflected appraisal. We showed you their performance. We never sent you a classmate\'s judgment of your ability.',
          'SAY: "Someone else thinks you\'re highly capable" — that would be much closer to reflected appraisal.',
          'ASK: Would Alex care the same if that came from a stranger, or from a best friend, a teammate, or someone they respect?',
          'SAY: Chapter 3 calls that person a significant other. Some judgments count more, just as some reference groups count more.',
          mirrorQuoteNote(extra?.slotText),
        ];
      }
      return [
        'SAY: "A mirroring of others\' judgments." That\'s the textbook\'s description of reflected appraisal.',
        'SAY: This is different from simply seeing somebody else\'s performance. Here, another person\'s judgment of you becomes information you use to understand yourself.',
        'DO NOT SAY: that the game already demonstrated this.',
      ];
    case 'chooser':
      if (beat <= 0) {
        return [
          'SAY: Let\'s return to what actually happened today.',
          'POINT OUT: You produced a score. The app selected other people. You saw those people. Then you evaluated yourself.',
          'ASK: Which part of that process didn\'t you control?',
          'PAUSE: Let them say it — who the app selected.',
          'SAY: Exactly.',
        ];
      }
      if (beat === 1) {
        return [
          'SAY: Now replace our classroom app with a social or professional feed. The structure starts to look similar.',
          'SAY: Your life produces events and achievements. A feed decides which of those become visible. Those become available comparison points. Then you may evaluate yourself against them.',
          'SAY: We\'re not saying platforms are secretly running the same activity we just ran. Their goals can be completely different.',
          'SAY: The question is whether controlling visibility can also influence which people become available as reference groups.',
        ];
      }
      if (beat === 2) {
        return [
          'ASK: Outside this room, who or what decides which people\'s achievements are repeatedly visible to you?',
          'FOLLOW-UP: After they answer — friends, your program, people you follow, rankings, recommendation systems, your own choices.',
          'ASK: If a platform influences which people\'s achievements you repeatedly see, can it indirectly influence the reference groups you use to evaluate yourself?',
          'CAUTION: Don\'t give them the answer.',
          'NOTE: If you have time — Chapter 3 says online profiles become comparison points and often leave out ordinary imperfections. It describes an Instagram study where negative comparison was strongest among people who followed more strangers, while comparison was generally more positive for people who mostly followed friends and family. One or two sentences, then stop.',
        ];
      }
      return [
        'SAY: If a quote is on screen, read it once.',
        'CAUTION: We don\'t have another textbook line for this beat. Don\'t invent a citation.',
      ];
    case 'circle':
      if (beat <= 0) {
        return [
          'SAY: These are the same scores we showed you near the beginning.',
          'SAY: Nothing about the numbers themselves has changed.',
        ];
      }
      if (beat === 1) {
        return [
          'SAY: What changed was what surrounded those numbers.',
          'SAY: Some of you saw higher scores. Some saw similar scores. Some saw lower scores.',
          'PARTNER: That was social comparison — what am I like compared with them? Reference groups are which "them" the app handed you.',
          'SAY: The 78% was the same idea in a more familiar room.',
          'SAY: Alex was the other Chapter 3 process. Reflected appraisal — what do their judgments of me tell me about myself?',
          'SAY: Chapter 3 treats those as complementary ways other people help shape self-concept. Reference groups sit inside social comparison. They aren\'t a third, separate theory.',
          'NOTE: There is no separate concept-map slide. This beat is that map.',
        ];
      }
      return [
        'SAY: Today, you didn\'t choose who you compared yourself with.',
        'PAUSE: Let the slide\'s second line land.',
        'SAY: And a lot of the time outside this room, we don\'t completely choose either.',
        'SAY: So the question we want to leave you with is: who gets to be your mirror?',
        'SAY: Who do you compare yourself with? Whose opinions become part of how you see yourself? And how much of that did you actually choose?',
        'NOTE: Stop. Don\'t explain it.',
      ];
    case 'end':
      return [
        'SAY: Thanks, everyone.',
        'SAY: If you want — where do you see social comparison, reference groups, or reflected appraisal outside this activity?',
        'NOTE: Keep it short. The joke on screen can land on its own. Data stays anonymous.',
      ];
  }
}

export function notesFor(scene: SceneId, beat: number, data: RevealData | null, extra?: NotesExtra): string[] {
  return [...script(scene, beat, data, extra), ...honesty(scene, beat, data, extra)];
}
