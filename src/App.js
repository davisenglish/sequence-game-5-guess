// Required dependencies: react, @fortawesome/react-fontawesome, @fortawesome/free-solid-svg-icons
// Tailwind CSS is used for styling (optional, or replace with your own CSS)
// Drop this file into your React project and import/use <WordPuzzleGame />
import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCircleInfo, faChartSimple, faCheckCircle, faTimesCircle, faCircleQuestion, faHouseChimney, faList, faShareNodes, faChevronDown, faXmark, faEnvelope, faBug } from '@fortawesome/free-solid-svg-icons';
import words from 'an-array-of-english-words';

const GUESSES_PER_DAY = 4;

/** First line of contact email body (4-Guess build) */
const CONTACT_VERSION_LINE = 'Version: Stringlish 4-Guess';
/** Contact form opens the user’s mail app addressed to this inbox */
const CONTACT_TO_EMAIL = 'info@stringlish.com';

// Preprocess the word list once for performance, excluding certain suffixes
const EXCLUDED_SUFFIXES = [
  'ING', 'ED', 'S', 'ER', 'EST', 'LY', 'ISH'
];
const suffixRegex = new RegExp(`(${EXCLUDED_SUFFIXES.join('|')})$`, 'i');
const PREPROCESSED_WORDS = words
  .filter(w =>
    w.length >= 3 &&
    /^[A-Za-z]+$/.test(w) &&
    !suffixRegex.test(w.toUpperCase())
  )
  .map(w => w.toUpperCase());

// Memoization cache for sequence counts
const sequenceCountCache = {};

// CSV data storage for triplets_lessrestrictive
let tripletsData = null;
let tripletsDataPromise = null;

async function loadTripletsData() {
  if (tripletsData) return tripletsData;
  if (tripletsDataPromise) return tripletsDataPromise;

  tripletsDataPromise = (async () => {
    try {
      const response = await fetch(`${process.env.PUBLIC_URL}/triplets_lessrestrictive.csv`);
      const text = await response.text();
      const lines = text.trim().split('\n');

      const data = [];
      for (const line of lines) {
        const columns = line.split(',');
        if (columns.length >= 3) {
          const frequency = parseInt(columns[0], 10);
          const letters = columns[1].toUpperCase();
          const answers = columns.slice(2, 12).filter(a => a && a.trim()).map(a => a.trim().toUpperCase());

          if (!isNaN(frequency) && letters.length === 3 && answers.length > 0) {
            data.push({
              frequency,
              letters,
              answers
            });
          }
        }
      }

      tripletsData = data;
      return data;
    } catch (error) {
      console.error('Error loading triplets CSV:', error);
      return [];
    }
  })();

  return tripletsDataPromise;
}

// Word list from SCOWL/Wordnik CSV for guess validation
let wordListSet = null;
let wordListPromise = null;

async function loadWordList() {
  if (wordListSet) return wordListSet;
  if (wordListPromise) return wordListPromise;

  wordListPromise = (async () => {
    try {
      const response = await fetch(`${process.env.PUBLIC_URL}/words-enable.scowl.wordnik.csv`);
      const text = await response.text();
      const lines = text.trim().split('\n');
      const set = new Set();
      for (let i = 0; i < lines.length; i++) {
        const w = lines[i].trim().toLowerCase();
        if (!w || (i === 0 && w === 'word')) continue;
        set.add(w);
      }
      wordListSet = set;
      return set;
    } catch (error) {
      console.error('Error loading word list CSV:', error);
      wordListSet = new Set();
      return wordListSet;
    }
  })();

  return wordListPromise;
}

const LS_DAILY = {
  completedUtc: 'stringlich5_dailyCompletedUtc_v3',
  abandonedUtc: 'stringlich5_dailyAbandonedUtc_v3',
  snapshot: 'stringlich5_dailySnapshot_v3',
  inProgress: 'stringlich5_dailyInProgress_v3',
};

/** Local calendar YYYY-MM-DD — daily letters, completion, and rollover use this (new puzzle at local midnight). */
function getLocalDateString(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** True if `prevYmd` is exactly one local calendar day before `nextYmd` (YYYY-MM-DD). */
function isLocalYmdImmediatelyBefore(prevYmd, nextYmd) {
  const [py, pm, pd] = prevYmd.split('-').map(Number);
  const [ny, nm, nd] = nextYmd.split('-').map(Number);
  const p = new Date(py, pm - 1, pd);
  const n = new Date(ny, nm - 1, nd);
  return (n.getTime() - p.getTime()) / 86400000 === 1;
}

/** `mistakes[i]` = games with `i` invalid guesses (0..GUESSES_PER_DAY). Folds legacy 6-bucket saves into the new length. */
function coerceMistakesBuckets(m) {
  const len = GUESSES_PER_DAY + 1;
  const base = Array.from({ length: len }, () => 0);
  if (!Array.isArray(m)) return base;
  for (let i = 0; i < len; i++) base[i] = Number(m[i]) || 0;
  if (m.length > len) {
    for (let j = len; j < m.length; j++) {
      base[len - 1] += Number(m[j]) || 0;
    }
  }
  return base;
}

const SCORE_DISTRIBUTION_TIERS = [
  { emoji: '🐰', label: '≥ 40' },
  { emoji: '',   label: '30–39' },
  { emoji: '',   label: '20–29' },
  { emoji: '',   label: '10–19' },
  { emoji: '🐌', label: '1–9' },
];

function bucketIndexForScore(score) {
  const s = Math.max(0, Math.floor(Number(score) || 0));
  if (s >= 40) return 0;
  if (s >= 30) return 1;
  if (s >= 20) return 2;
  if (s >= 10) return 3;
  return 4;
}

/** Sorted, de-duplicated list of valid YYYY-MM-DD strings. */
function sortedUniqueYmd(arr) {
  return [...new Set((arr || []).filter((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
}

/** Longest run of consecutive calendar days within a sorted, unique date list. */
function longestConsecutiveRun(sortedDates) {
  if (!sortedDates || sortedDates.length === 0) return 0;
  let best = 1;
  let run = 1;
  for (let i = 1; i < sortedDates.length; i++) {
    if (isLocalYmdImmediatelyBefore(sortedDates[i - 1], sortedDates[i])) run += 1;
    else run = 1;
    if (run > best) best = run;
  }
  return best;
}

/**
 * Active streak = consecutive wins ending at the most recent win. It only counts
 * if that win is today or yesterday (no missed day), and today wasn't already lost.
 */
function currentRunFromWinDates(sortedDates, todayStr, lastLossDate) {
  if (!sortedDates || sortedDates.length === 0) return 0;
  if (lastLossDate && lastLossDate === todayStr) return 0;
  const last = sortedDates[sortedDates.length - 1];
  if (last !== todayStr && !isLocalYmdImmediatelyBefore(last, todayStr)) return 0;
  let run = 1;
  for (let i = sortedDates.length - 1; i > 0; i--) {
    if (isLocalYmdImmediatelyBefore(sortedDates[i - 1], sortedDates[i])) run += 1;
    else break;
  }
  return run;
}

/** Rebuild the `count` consecutive dates ending at `endYmd` — seeds the ledger from legacy saves. */
function seedWinDatesFromStreak(endYmd, count) {
  if (!endYmd || !count || count < 1) return [];
  const [y, m, d] = endYmd.split('-').map(Number);
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    out.push(getLocalDateString(new Date(y, m - 1, d - i)));
  }
  return out;
}

/**
 * The win-date ledger (`winDates`) is the source of truth for streaks. This derives
 * currentStreak/maxStreak from it, seeding from legacy fields the first time so existing
 * streaks are preserved. maxStreak keeps any previously stored value as a floor.
 */
function recomputeStreakFields(s) {
  let winDates = sortedUniqueYmd(s.winDates);
  if (winDates.length === 0 && s.lastWinPuzzleDate && (s.currentStreak || 0) > 0) {
    winDates = seedWinDatesFromStreak(s.lastWinPuzzleDate, s.currentStreak || 0);
  }
  s.winDates = winDates;
  const today = getLocalDateString();
  s.currentStreak = currentRunFromWinDates(winDates, today, s.lastLossDate || null);
  s.maxStreak = Math.max(Number(s.maxStreak) || 0, longestConsecutiveRun(winDates));
  s.lastWinPuzzleDate = winDates.length ? winDates[winDates.length - 1] : (s.lastWinPuzzleDate || null);
  return s;
}

/** Record a win on `puzzleDateStr` in the ledger and recompute streaks. */
function recordWinDate(s, puzzleDateStr) {
  s.winDates = sortedUniqueYmd([...(s.winDates || []), puzzleDateStr]);
  if (s.lastLossDate === puzzleDateStr) s.lastLossDate = null;
  return recomputeStreakFields(s);
}

/** Record a loss on `puzzleDateStr` (breaks the active streak) and recompute. */
function recordLossDate(s, puzzleDateStr) {
  s.lastLossDate = puzzleDateStr;
  return recomputeStreakFields(s);
}

/** Top unique scores, highest first, max 3 (no duplicate values). */
function normalizeHighestScoresList(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return [];
  return [...new Set(arr.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0))]
    .sort((a, b) => b - a)
    .slice(0, 3);
}

/**
 * If the player missed any calendar day after their last recorded win, current streak is not active.
 * Old saves without lastWinPuzzleDate: zero currentStreak so we don't show unverifiable numbers.
 */
function normalizeStatsStreak(raw) {
  const s = { ...raw };
  s.mistakes = coerceMistakesBuckets(s.mistakes);
  s.highestScores = normalizeHighestScoresList(s.highestScores || []);
  if (!Array.isArray(s.winScores)) s.winScores = [];
  if (!Array.isArray(s.scoreDistribution) || s.scoreDistribution.length !== 5) {
    s.scoreDistribution = [0, 0, 0, 0, 0];
  } else {
    s.scoreDistribution = s.scoreDistribution.map((n) => Math.max(0, Math.floor(Number(n) || 0)));
  }
  return recomputeStreakFields(s);
}

/** After a winning day (≥1 valid word), record the win in the ledger and recompute streaks. */
function applyDailyCalendarWinStreak(tempStats, puzzleDateStr) {
  recordWinDate(tempStats, puzzleDateStr);
}

function hashStringToInt(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** Same seed ⇒ same order for all players sharing this calendar day + triplet (matches daily puzzle identity). */
function sortAnswersDeterministic(answers, seedKey) {
  return [...answers].sort((a, b) => {
    const sa = String(a).trim().toUpperCase();
    const sb = String(b).trim().toUpperCase();
    const ha = hashStringToInt(`${seedKey}|${sa}`);
    const hb = hashStringToInt(`${seedKey}|${sb}`);
    if (ha !== hb) return ha - hb;
    return sa.localeCompare(sb);
  });
}

/** Display number: #1 = July 15, 2026 on the user's local calendar; #2 = Jul 16 local, etc. */
function getLocalStringlishNumber() {
  const now = new Date();
  const todayLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const epochLocal = new Date(2026, 6, 15);
  const dayIndex = Math.floor((todayLocal.getTime() - epochLocal.getTime()) / 86400000);
  return Math.max(1, dayIndex + 1);
}

function formatLocalDateLong(d = new Date()) {
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function readDailyCompletedUtc() {
  try {
    return localStorage.getItem(LS_DAILY.completedUtc);
  } catch (_) {
    return null;
  }
}

function readDailyAbandonedUtc() {
  try {
    return localStorage.getItem(LS_DAILY.abandonedUtc);
  } catch (_) {
    return null;
  }
}

function saveDailyCompletionSnapshot(snapshot) {
  try {
    localStorage.setItem(LS_DAILY.snapshot, JSON.stringify(snapshot));
    localStorage.setItem(LS_DAILY.completedUtc, snapshot.puzzleDate);
    localStorage.removeItem(LS_DAILY.abandonedUtc);
    localStorage.removeItem(LS_DAILY.inProgress);
  } catch (_) {}
}

function markDailyAbandonedForLocalDate(dateStr) {
  try {
    localStorage.setItem(LS_DAILY.abandonedUtc, dateStr);
    localStorage.removeItem(LS_DAILY.inProgress);
  } catch (_) {}
}

/** Convert a YYYY-MM-DD date string to an integer day offset from a fixed epoch. */
function puzzleDateToInt(puzzleDateStr) {
  const [y, m, d] = puzzleDateStr.split('-').map(Number);
  return Math.floor((new Date(y, m - 1, d) - new Date(2020, 0, 1)) / 86400000);
}

/**
 * Wang hash — good avalanche properties for integers.
 * Consecutive day numbers produce wildly different outputs,
 * avoiding the sequential-index bug that djb2 has on date strings.
 */
function wangHashInt(n) {
  let x = n ^ 0xdeadbeef;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = x ^ (x >>> 16);
  return Math.abs(x);
}

/** Same letters for every player sharing the same local calendar date string (deterministic from CSV pool). */
async function getDailyLetters(puzzleDateStr) {
  const data = await loadTripletsData();
  if (!data || data.length === 0) {
    return 'THE';
  }
  const filteredData = data.filter((item) => item.frequency >= 10);
  const pool = filteredData.length > 0 ? filteredData : data;
  const idx = wangHashInt(puzzleDateToInt(puzzleDateStr)) % pool.length;
  return pool[idx].letters;
}

function isSequential(word, letters) {
  let idx = 0;
  const target = letters.toUpperCase();
  for (let char of word.toUpperCase()) {
    if (char === target[idx]) idx++;
    if (idx === target.length) return true;
  }
  return false;
}

/** Profanity blocklist — whole-word match only; all entries are 5+ letters. */
const SWEAR_WORDS = new Set([
  'arsehole',
  'assbandit',
  'assclown',
  'assface',
  'asshat',
  'asshole',
  'assholes',
  'asswipe',
  'badass',
  'bastard',
  'bastards',
  'beaner',
  'beaners',
  'bitch',
  'bitches',
  'bitching',
  'bitchy',
  'bitchass',
  'bollocks',
  'bullshit',
  'chink',
  'chinks',
  'clusterfuck',
  'cockbite',
  'cockhead',
  'cocksucker',
  'cocksmoker',
  'cumdump',
  'cumguzzler',
  'cumshot',
  'cuntface',
  'cunthole',
  'damnit',
  'dickbag',
  'dickface',
  'dickhead',
  'dickwad',
  'dickweed',
  'dickweasel',
  'dipshit',
  'douche',
  'douchebag',
  'douchebags',
  'dumbass',
  'dumbasses',
  'faggot',
  'faggots',
  'fuckboy',
  'fucked',
  'fucker',
  'fuckers',
  'fucking',
  'fuckface',
  'fuckhead',
  'fuckoff',
  'fuckstick',
  'fucktard',
  'fuckwad',
  'fuckwit',
  'goddam',
  'goddammit',
  'goddamn',
  'goddamned',
  'gooks',
  'honkey',
  'honky',
  'horseshit',
  'jackass',
  'jackasses',
  'jackoff',
  'jerkoff',
  'knobjockey',
  'motherfucker',
  'motherfuckers',
  'motherfucking',
  'nigga',
  'niggas',
  'nigger',
  'niggers',
  'pissant',
  'pissed',
  'pisser',
  'pissing',
  'pisshead',
  'pussies',
  'pussy',
  'raghead',
  'shitbag',
  'shitbox',
  'shitface',
  'shithead',
  'shitkicker',
  'shitless',
  'shitting',
  'shitstorm',
  'shitty',
  'skank',
  'skanks',
  'skanky',
  'sluts',
  'slutty',
  'smartass',
  'spics',
  'titfuck',
  'titty',
  'tranny',
  'twats',
  'wanker',
  'wankers',
  'wetback',
  'wetbacks',
  'whore',
  'whores',
  'whoring',
  'whorehouse',
]);

function isSwearWord(word) {
  const lower = String(word || '').trim().toLowerCase();
  return lower.length >= 5 && SWEAR_WORDS.has(lower);
}

async function isValidWord(word) {
  // Reject hyphenated words
  if (word.includes('-')) return false;

  if (isSwearWord(word)) return false;

  const wordSet = await loadWordList();
  return wordSet.has(String(word || '').trim().toLowerCase());
}

// Helper to find 1-2 possible valid words for a given sequence
function findPossibleAnswers(letters, max = 2) {
  if (!letters || letters.length !== 3) return [];
  const regex = new RegExp(letters.split('').join('.*'), 'i');
  // Only use preprocessed words, as in the game
  const candidates = PREPROCESSED_WORDS.filter(w => regex.test(w));
  // Sort by length, then alphabetically, and return up to max
  return candidates.sort((a, b) => a.length - b.length || a.localeCompare(b)).slice(0, max);
}

// Full CSV answer list for `letters`, sorted deterministically for this local puzzle day (same as my-app-ver4).
async function getSortedCsvAnswersForLetters(letters, puzzleDateStr) {
  const dayKey = puzzleDateStr ?? getLocalDateString();
  const seedKey = `${dayKey}|${letters.toUpperCase()}`;
  const data = await loadTripletsData();
  if (!data || !letters || letters.length !== 3) return [];
  const normalized = letters.toUpperCase();
  const entry = data.find((item) => item.letters === normalized);
  if (!entry || !entry.answers || entry.answers.length === 0) return [];
  const list = entry.answers.filter((a) => a && a.trim());
  return sortAnswersDeterministic(list, seedKey);
}

/** Canonical hint word for this calendar day + triplet (same for every player). */
async function getDailyHintWord(letters, puzzleDateStr) {
  const dayKey = puzzleDateStr ?? getLocalDateString();
  const seedKey = `${dayKey}|${letters.toUpperCase()}`;
  const sorted = await getSortedCsvAnswersForLetters(letters, dayKey);
  if (!sorted.length) return null;
  const n = Math.min(20, sorted.length);
  const hintPool = sorted.slice(0, n);
  const idx = hashStringToInt(`${seedKey}|hint-target`) % hintPool.length;
  return hintPool[idx] ?? null;
}

// Possible answers for game-over display: daily hint word first, then others (same list for all players).
async function getPossibleAnswersFromCsv(letters, max = 4, puzzleDateStr) {
  const dayKey = puzzleDateStr ?? getLocalDateString();
  const sorted = await getSortedCsvAnswersForLetters(letters, dayKey);
  const dailyHint = await getDailyHintWord(letters, dayKey);
  const normalized = (w) => String(w || '').trim().toUpperCase();
  let rest = sorted.map(normalized).filter(Boolean);
  const hint = dailyHint ? normalized(dailyHint) : null;
  if (hint) {
    rest = rest.filter((w) => w !== hint);
    return [hint, ...rest].slice(0, max);
  }
  return rest.slice(0, max);
}

function PossibleAnswersFromCsv({ letters, max = 4, className = '', puzzleDate }) {
  const [answers, setAnswers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      const dayKey = puzzleDate ?? getLocalDateString();
      const result = await getPossibleAnswersFromCsv(letters, max, dayKey);
      if (!isMounted) return;
      setAnswers((result || []).map((w) => String(w || '').trim().toUpperCase()).filter(Boolean));
      setLoading(false);
    })();
    return () => { isMounted = false; };
  }, [letters, max, puzzleDate]);

  // Base was calc(0.875rem + 6pt) / calc(0.75rem + 6pt); scaled down 45% → ×0.55
  const wordFs = 'calc(0.875rem * 0.55 + 6pt * 0.55)';
  const lenFs = 'calc(0.75rem * 0.55 + 6pt * 0.55)';
  if (loading) return <div className="text-gray-400" style={{ fontSize: lenFs }}>Loading...</div>;
  if (answers.length === 0) return <div className="text-gray-400" style={{ fontSize: lenFs }}>No answers found</div>;
  const toTitleCase = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  return (
    <div className="flex flex-wrap justify-center gap-2 max-w-md mx-auto">
      {answers.map((w) => (
        <div
          key={w}
          className="rounded-lg px-3 py-1 flex items-center space-x-1 bg-gray-100 border border-gray-200"
        >
          <span className="font-medium text-gray-800" style={{ fontSize: wordFs }}>
            {toTitleCase(w)}
          </span>
          <span className="text-gray-600" style={{ fontSize: lenFs }}>
            ({w.length})
          </span>
        </div>
      ))}
    </div>
  );
}

/** L–I–N in game colors (rules wizard steps 1–3) */
function RulesWizardLinShapes() {
  return (
    <div className="flex justify-center space-x-2 mb-4">
      <div
        style={{
          width: 44,
          height: 44,
          background: '#c85f31',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'white',
          fontWeight: 600,
          fontSize: '1.35rem',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        }}
      >
        L
      </div>
      <div
        style={{
          width: 44,
          height: 44,
          background: '#195b7c',
          borderRadius: 8,
          transform: 'rotate(45deg) scale(0.85)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'white',
          fontWeight: 600,
          fontSize: '1.35rem',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        }}
      >
        <span style={{ transform: 'rotate(-45deg) scale(1.176)', display: 'inline-block', width: '100%', textAlign: 'center' }}>I</span>
      </div>
      <div
        style={{
          width: 44,
          height: 44,
          background: '#1c6d2a',
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'white',
          fontWeight: 600,
          fontSize: '1.35rem',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        }}
      >
        N
      </div>
    </div>
  );
}

function RulesExampleGuess({ valid, label, children }) {
  return (
    <div
      className={`rounded-lg border px-3 py-2.5 mb-2.5 ${
        valid ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
      }`}
    >
      <div className="flex items-start gap-2 mb-2">
        <FontAwesomeIcon
          icon={valid ? faCheckCircle : faTimesCircle}
          className="flex-shrink-0 mt-0.5 text-base"
          style={{ color: valid ? '#1c6d2a' : '#992108' }}
        />
        <span
          className={`leading-snug ${valid ? 'text-green-800' : 'text-red-800'}`}
        >
          {label}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1 pl-6">
        {children}
      </div>
    </div>
  );
}

const ICON_MODAL_ANIM_MS = 300;

function computeIconModalShrinkStyle(iconEl, cardEl) {
  if (!iconEl || !cardEl) {
    return {
      cardTransform: 'translate(0px, 0px) scale(0.08)',
      overlayOpacity: 0,
    };
  }
  const icon = iconEl.getBoundingClientRect();
  const card = cardEl.getBoundingClientRect();
  const iconCx = icon.left + icon.width / 2;
  const iconCy = icon.top + icon.height / 2;
  const cardCx = card.left + card.width / 2;
  const cardCy = card.top + card.height / 2;
  const scale = Math.min(icon.width / card.width, icon.height / card.height);
  return {
    cardTransform: `translate(${iconCx - cardCx}px, ${iconCy - cardCy}px) scale(${Math.max(scale, 0.05)})`,
    overlayOpacity: 0,
  };
}

function FloatingEmojis({ emojis, onDone }) {
  const particles = React.useMemo(() => {
    return Array.from({ length: 22 }, (_, i) => ({
      id: i,
      emoji: emojis[Math.floor(Math.random() * emojis.length)],
      left: `${3 + Math.random() * 94}%`,
      delay: Math.random() * 1.1,
      size: 1.4 + Math.random() * 1.0,
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    const t = setTimeout(onDone, 4800);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <>
      <style>{`
        @keyframes emojiFloatUp {
          0%   { transform: translateY(0); opacity: 1; }
          72%  { opacity: 1; }
          100% { transform: translateY(-115vh); opacity: 0; }
        }
      `}</style>
      <div
        style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 999999 }}
        aria-hidden="true"
      >
        {particles.map(({ id, emoji, left, delay, size }) => (
          <span
            key={id}
            style={{
              position: 'absolute',
              bottom: '-8%',
              left,
              fontSize: `${size}rem`,
              animation: `emojiFloatUp 3.5s ${delay}s ease-out forwards`,
              lineHeight: 1,
              userSelect: 'none',
            }}
          >
            {emoji}
          </span>
        ))}
      </div>
    </>
  );
}

function celebrationEmojisForScore(score) {
  if (score <= 0) return null;
  if (score <= 9)  return ['😏'];
  if (score <= 19) return ['😊'];
  if (score <= 29) return ['🤩'];
  if (score <= 39) return ['😍'];
  return ['🥳', '🎉'];
}

export default function WordPuzzleGame() {
  const [letters, setLetters] = useState('');
  const [roundStarted, setRoundStarted] = useState(false);
  const [input, setInput] = useState('');
  const [inputFontSizePx, setInputFontSizePx] = useState(30);
  const [validWords, setValidWords] = useState([]); // { word, letters, bonusTime }
  const [error, setError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [guessesRemaining, setGuessesRemaining] = useState(GUESSES_PER_DAY);
  const [gameOver, setGameOver] = useState(false);
  const [manuallyEnded, setManuallyEnded] = useState(false);
  const [score, setScore] = useState(0);
  const [scorePopping, setScorePopping] = useState(false);
  const [letterPopup, setLetterPopup] = useState(null);
  const [showRevealAnimation, setShowRevealAnimation] = useState(false);
  const [revealAnimationPlayedThisRound, setRevealAnimationPlayedThisRound] = useState(false);
  const [showAllWords, setShowAllWords] = useState(false);
  const [showStats, setShowStats] = useState(false);
  /** When true, Statistics modal shows the round result banner (Better Luck / Nicely Done / …). Shown after a finished round, game-over stats, or Behold Your Work — not from home/mid-game stats alone. */
  const [statsShowGameResultBanner, setStatsShowGameResultBanner] = useState(false);
  const [celebrationEmojis, setCelebrationEmojis] = useState(null);
  const [showInstructions, setShowInstructions] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [stats, setStats] = useState({
    gamesPlayed: 0,
    gamesWon: 0,
    currentStreak: 0,
    maxStreak: 0,
    winDates: [], // Ledger of YYYY-MM-DD dates won; streaks are derived from this
    lastWinPuzzleDate: null,
    lastLossDate: null,
    highestScores: [],
    mistakes: Array.from({ length: GUESSES_PER_DAY + 1 }, () => 0), // games by invalid-count 0..GUESSES_PER_DAY
    longestWords: [], // Array of {word, length} objects, sorted by length descending, one per length, max 3
    winScores: [], // Scores from won games (≥1 valid word), for average trend
    scoreDistribution: [0, 0, 0, 0, 0] // Counts per score tier: [40+, 30-39, 20-29, 10-19, 1-10]
  });
  const [showRules, setShowRules] = useState(false);
  const [rulesModalClosing, setRulesModalClosing] = useState(false);
  const rulesIconRef = useRef(null);
  const rulesModalCardRef = useRef(null);
  const rulesModalAnimTokenRef = useRef(0);
  const [rulesModalAnim, setRulesModalAnim] = useState({
    cardTransform: 'translate(0px, 0px) scale(1)',
    overlayOpacity: 1,
    transitionEnabled: false,
  });
  const [statsModalClosing, setStatsModalClosing] = useState(false);
  const statsIconRef = useRef(null);
  const statsModalCardRef = useRef(null);
  const statsModalAnimTokenRef = useRef(0);
  const [statsModalAnim, setStatsModalAnim] = useState({
    cardTransform: 'translate(0px, 0px) scale(1)',
    overlayOpacity: 1,
    transitionEnabled: false,
  });
  /** Hidden by default; click chart icon in Statistics modal to show (testing) */
  const [showClearStatsButton, setShowClearStatsButton] = useState(false);
  /** Bump when daily localStorage (completed/abandoned) changes so home UI re-reads */
  const [dailyUiEpoch, setDailyUiEpoch] = useState(0);
  const lastLocalDateRef = useRef(getLocalDateString());
  const roundStartedRef = useRef(false);
  const gameOverRef = useRef(false);
  useEffect(() => {
    roundStartedRef.current = roundStarted;
  }, [roundStarted]);
  useEffect(() => {
    gameOverRef.current = gameOver;
  }, [gameOver]);
  const [showRulesOnStart, setShowRulesOnStart] = useState(() => {
    try {
      const stored = localStorage.getItem('sequenceGameV2_4guessShowRulesOnStart');
      return stored !== 'false';
    } catch (_) {
      return true;
    }
  });
  const [showGiveUpConfirm, setShowGiveUpConfirm] = useState(false);
  const [rulesWizardStep, setRulesWizardStep] = useState(0); // 0–2 (three steps)
  const prevRulesWizardStepRef = useRef(0);
  const rulesWizardTouchStartRef = useRef(null);
  const rulesDismissedOnceRef = useRef(false);
  const hintTimerStartedThisRoundRef = useRef(false);
  const [hintWord, setHintWord] = useState(null);
  const [dailyHintWord, setDailyHintWord] = useState(null);
  const [hintRevealAnimating, setHintRevealAnimating] = useState(false);
  const [hintAvailable, setHintAvailable] = useState(false);
  const [hintFillProgress, setHintFillProgress] = useState(0);
  const [hintReadyPop, setHintReadyPop] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 375));
  const [viewportHeight, setViewportHeight] = useState(() => (typeof window !== 'undefined' ? window.innerHeight : 667));
  const [pressedKey, setPressedKey] = useState(null);
  const [mobileShiftActive, setMobileShiftActive] = useState(false);
  const [mobileCapsLock, setMobileCapsLock] = useState(false);
  const [showMobileGuessList, setShowMobileGuessList] = useState(false);
  const [guessListPopupPosition, setGuessListPopupPosition] = useState(null); // { top, left, width } — anchored to list button
  const [showContactModal, setShowContactModal] = useState(false);
  /** Which footer link opened the shared contact form (header title + icon only). */
  const [contactModalMode, setContactModalMode] = useState('contact');
  const [contactModalClosing, setContactModalClosing] = useState(false);
  const [contactEmail, setContactEmail] = useState('');
  const [contactSubject, setContactSubject] = useState('');
  const [contactMessage, setContactMessage] = useState('');
  const mobileShiftOnAtRef = useRef(0);
  const mobileShiftActiveRef = useRef(false);
  const mobileCapsLockRef = useRef(false);
  const mobileGuessListSnapshotRef = useRef([]); // snapshot when opening to avoid re-render loops
  const mobileGuessListBtnRef = useRef(null);
  const hintUnlockTimeoutRef = useRef(null);
  const hintFillIntervalRef = useRef(null);
  const inputRef = useRef(null);
  const inputValueRef = useRef('');
  const handleKeyboardLetterRef = useRef(null);
  const inputContainerRef = useRef(null);
  const inputMeasureRef = useRef(null);
  const lastKeyPressRef = useRef({ key: null, time: 0 });
  const backspaceHoldTimeoutRef = useRef(null);
  const backspaceHoldIntervalRef = useRef(null);
  const prevScoreRef = useRef(0);
  const isSubmittingRef = useRef(false);
  useEffect(() => {
    loadWordList();
    (async () => {
      const puzzleDay = getLocalDateString();
      lastLocalDateRef.current = puzzleDay;
      const params = new URLSearchParams(window.location.search);
      const completedToday = readDailyCompletedUtc() === puzzleDay;
      const abandonedToday = readDailyAbandonedUtc() === puzzleDay;

      // 1) Resume an in-progress session first so a refresh never drops a game.
      if (!completedToday && !abandonedToday) {
        const raw = localStorage.getItem(LS_DAILY.inProgress);
        if (raw) {
          try {
            const o = JSON.parse(raw);
            const savedDay = o.puzzleDate || o.utcDate;
            if (savedDay === puzzleDay && o.letters) {
              setLetters(o.letters);
              setValidWords(o.validWords || []);
              setScore(o.score ?? 0);
              setGuessesRemaining(o.guessesRemaining ?? GUESSES_PER_DAY);
              setHintWord(o.hintWord ?? null);
              setRoundStarted(true);
              setRevealAnimationPlayedThisRound(true);
              setShowRevealAnimation(false);
              return;
            }
          } catch (_) {}
        }
      }

      // 2) Finished today → jump straight to the results / stats view.
      if (completedToday) {
        if (localStorage.getItem(LS_DAILY.snapshot)) {
          setLetters(await getDailyLetters(puzzleDay));
          handleBeholdYourWork();
          return;
        }
        if (process.env.NODE_ENV !== 'development') {
          window.location.replace('/');
          return;
        }
      }

      // 3) Explicit play intent from the hub → begin now, skipping the landing.
      if (params.get('play') === '1' && !abandonedToday) {
        setLetters(await getDailyLetters(puzzleDay));
        handleBegin();
        return;
      }

      // 4) In production, redirect to the hub if reached without going through it.
      // In development, load the daily letters and show the landing screen so the
      // game is testable locally (npm start) without the hub running.
      if (process.env.NODE_ENV !== 'development') {
        window.location.replace('/');
        return;
      }
      setLetters(await getDailyLetters(puzzleDay));
    })();
    // Load stats from localStorage - version specific (calendar streak may zero stale currentStreak)
    const savedStats = localStorage.getItem('sequenceGameStats_v2_4guess');
    if (savedStats) {
      try {
        const parsed = JSON.parse(savedStats);
        const norm = normalizeStatsStreak(parsed);
        if (JSON.stringify(norm) !== savedStats) {
          try {
            localStorage.setItem('sequenceGameStats_v2_4guess', JSON.stringify(norm));
          } catch (_) {}
        }
        setStats(norm);
      } catch (_) {
        /* ignore corrupt stats JSON */
      }
    }
    
    // Detect mobile/tablet (show virtual keyboard for phones and tablets) and track viewport for keyboard scaling
    const checkMobile = () => {
      const w = typeof window !== 'undefined' && window.visualViewport ? window.visualViewport.width : window.innerWidth;
      const h = typeof window !== 'undefined' && window.visualViewport ? window.visualViewport.height : window.innerHeight;
      setIsMobile((typeof window !== 'undefined' ? window.innerWidth : 1024) <= 1024);
      setViewportWidth(w);
      setViewportHeight(h);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    if (typeof window !== 'undefined' && window.visualViewport) {
      window.visualViewport.addEventListener('resize', checkMobile);
      window.visualViewport.addEventListener('scroll', checkMobile);
    }
    
    return () => {
      window.removeEventListener('resize', checkMobile);
      if (typeof window !== 'undefined' && window.visualViewport) {
        window.visualViewport.removeEventListener('resize', checkMobile);
        window.visualViewport.removeEventListener('scroll', checkMobile);
      }
    };
  }, []);

  useEffect(() => {
    if (!roundStarted) return;
    // Replaying "Behold Your Work" sets gameOver + guessesRemaining in one update; do not re-apply stats
    if (gameOver) return;
    if (guessesRemaining <= 0 && !manuallyEnded) {
      // Add delay to allow final dot animation to complete
      setTimeout(() => {
        setGameOver(true);
        // Update stats when game ends
        updateStats();
        // Show stats modal automatically after a brief delay (with round-result banner)
        setTimeout(() => {
          setStatsShowGameResultBanner(true);
          openStatsModal();
          const roundScore = parseInt(localStorage.getItem('currentRoundScore_v2_4guess') || '0', 10);
          const emojis = celebrationEmojisForScore(roundScore);
          if (emojis) setCelebrationEmojis(emojis);
        }, 500);
      }, 600); // Slightly longer than the dot animation duration
    }
  }, [guessesRemaining, roundStarted, manuallyEnded, gameOver]);

  useEffect(() => {
    if (showRules) {
      setRulesWizardStep(0);
      prevRulesWizardStepRef.current = 0;
    }
  }, [showRules]);

  const rulesWizardSlideDir =
    rulesWizardStep > prevRulesWizardStepRef.current
      ? 'next'
      : rulesWizardStep < prevRulesWizardStepRef.current
        ? 'prev'
        : 'next';

  useLayoutEffect(() => {
    prevRulesWizardStepRef.current = rulesWizardStep;
  }, [rulesWizardStep]);

  const updateGuessListPopupPosition = useCallback(() => {
    const el = mobileGuessListBtnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const padding = 10;
    const maxW = 320;
    const w = Math.min(maxW, window.innerWidth - padding * 2);
    let left = Math.max(padding, Math.min(r.left, window.innerWidth - padding - w));
    const top = r.bottom + 8;
    setGuessListPopupPosition({ top, left, width: w });
  }, []);

  useLayoutEffect(() => {
    if (!showMobileGuessList) return;
    updateGuessListPopupPosition();
    window.addEventListener('resize', updateGuessListPopupPosition);
    window.addEventListener('scroll', updateGuessListPopupPosition, true);
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (vv) {
      vv.addEventListener('resize', updateGuessListPopupPosition);
      vv.addEventListener('scroll', updateGuessListPopupPosition);
    }
    return () => {
      window.removeEventListener('resize', updateGuessListPopupPosition);
      window.removeEventListener('scroll', updateGuessListPopupPosition, true);
      if (vv) {
        vv.removeEventListener('resize', updateGuessListPopupPosition);
        vv.removeEventListener('scroll', updateGuessListPopupPosition);
      }
    };
  }, [showMobileGuessList, updateGuessListPopupPosition]);

  // Keep inputValueRef in sync with input state so mobile Submit has source of truth
  useEffect(() => {
    inputValueRef.current = input;
  }, [input]);

  // Close mobile guess list when round/game state changes
  useEffect(() => {
    if (gameOver || !roundStarted) {
      setShowMobileGuessList(false);
      setGuessListPopupPosition(null);
    }
  }, [gameOver, roundStarted]);

  const startHintFillTimer = () => {
    setHintAvailable(false);
    setHintFillProgress(0);
    setHintReadyPop(false);
    if (hintUnlockTimeoutRef.current) clearTimeout(hintUnlockTimeoutRef.current);
    if (hintFillIntervalRef.current) clearInterval(hintFillIntervalRef.current);
    hintFillIntervalRef.current = setInterval(() => {
      setHintFillProgress((prev) => {
        if (prev >= 99.5) {
          if (hintFillIntervalRef.current) {
            clearInterval(hintFillIntervalRef.current);
            hintFillIntervalRef.current = null;
          }
          return 100;
        }
        return prev + (100 / 300);
      });
    }, 100);
    hintUnlockTimeoutRef.current = setTimeout(() => {
      hintUnlockTimeoutRef.current = null;
      setHintFillProgress(100);
      setHintAvailable(true);
      setHintReadyPop(true);
      setTimeout(() => setHintReadyPop(false), 200);
    }, 30000);
  };

  const clearHintTimers = () => {
    if (hintUnlockTimeoutRef.current) {
      clearTimeout(hintUnlockTimeoutRef.current);
      hintUnlockTimeoutRef.current = null;
    }
    if (hintFillIntervalRef.current) {
      clearInterval(hintFillIntervalRef.current);
      hintFillIntervalRef.current = null;
    }
  };

  // Canonical hint word for today's triplet — same for every player on this calendar day.
  useEffect(() => {
    let cancelled = false;
    if (!letters) {
      setDailyHintWord(null);
      return undefined;
    }
    (async () => {
      const w = await getDailyHintWord(letters, getLocalDateString());
      if (!cancelled) setDailyHintWord(w);
    })();
    return () => {
      cancelled = true;
    };
  }, [letters]);

  // Hint: available 30s after rules are closed (timer does not start while rules modal is open).
  // Start the timer only once per round when rules are first closed; reopening rules mid-game does not restart it.
  useEffect(() => {
    if (!roundStarted || gameOver || !letters) {
      setHintAvailable(false);
      setHintFillProgress(0);
      clearHintTimers();
      hintTimerStartedThisRoundRef.current = false;
      if (!roundStarted || !letters) setHintWord(null);
      return clearHintTimers;
    }
    // In active round: start timer only once, when rules are closed (first time or after reopening)
    if (!showRules && !hintTimerStartedThisRoundRef.current) {
      startHintFillTimer();
      hintTimerStartedThisRoundRef.current = true;
    }
    return () => {};
  }, [roundStarted, gameOver, letters, showRules]);

  useEffect(() => {
    return clearHintTimers;
  }, []);

  // Persist in-progress daily game so refresh can resume the same local-calendar-day puzzle
  useEffect(() => {
    if (!roundStarted || gameOver) return;
    const puzzleDay = getLocalDateString();
    if (readDailyCompletedUtc() === puzzleDay) return;
    const payload = {
      puzzleDate: puzzleDay,
      letters,
      validWords,
      score,
      guessesRemaining,
      hintWord,
      manuallyEnded,
    };
    try {
      localStorage.setItem(LS_DAILY.inProgress, JSON.stringify(payload));
    } catch (_) {}
  }, [roundStarted, gameOver, letters, validWords, score, guessesRemaining, hintWord, manuallyEnded]);

  // New puzzle when the user's local calendar day changes (not at UTC midnight)
  useEffect(() => {
    const handleLocalDayTick = async () => {
      const puzzleDay = getLocalDateString();
      if (puzzleDay === lastLocalDateRef.current) return;
      const prevDay = lastLocalDateRef.current;
      lastLocalDateRef.current = puzzleDay;
      setDailyUiEpoch((e) => e + 1);
      if (roundStartedRef.current && !gameOverRef.current) {
        markDailyAbandonedForLocalDate(prevDay);
      }
      setStats((prev) => {
        let n = normalizeStatsStreak({ ...prev });
        if (roundStartedRef.current && !gameOverRef.current) {
          // Left a game unfinished across the day boundary → that day counts as a miss.
          n = recordLossDate({ ...n }, prevDay);
        }
        try {
          localStorage.setItem('sequenceGameStats_v2_4guess', JSON.stringify(n));
        } catch (_) {}
        return n;
      });
      setRoundStarted(false);
      setGameOver(false);
      setShowRevealAnimation(false);
      setShowAllWords(false);
      setShowStats(false);
      setShowClearStatsButton(false);
      setShowInstructions(false);
      setInput('');
      inputValueRef.current = '';
      setValidWords([]);
      setScore(0);
      setError(false);
      setErrorMessage('');
      setGuessesRemaining(GUESSES_PER_DAY);
      setLetterPopup(null);
      setManuallyEnded(false);
      setHintWord(null);
      setDailyHintWord(null);
      setHintAvailable(false);
      setHintFillProgress(0);
      setHintReadyPop(false);
      clearHintTimers();
      hintTimerStartedThisRoundRef.current = false;
      setLetters(await getDailyLetters(puzzleDay));
      // New day: route back through the hub rather than showing a landing screen.
      if (process.env.NODE_ENV !== 'development') {
        window.location.replace('/');
      }
    };
    const id = setInterval(handleLocalDayTick, 60000);
    const onVis = () => {
      handleLocalDayTick();
    };
    document.addEventListener('visibilitychange', onVis);
    handleLocalDayTick();
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  // Scale input font down only once text width exceeds ~15 letters (container-based max width)
  const measureInputFontSize = () => {
    if (!input) {
      setInputFontSizePx(30);
      return;
    }
    const container = inputContainerRef.current;
    const measure = inputMeasureRef.current;
    if (!container || !measure) return;
    const containerWidth = container.clientWidth;
    const textWidthAt30 = measure.offsetWidth;
    const maxContentWidth = Math.min(280, containerWidth * 0.85);
    if (textWidthAt30 > maxContentWidth && textWidthAt30 > 0) {
      const scaled = (30 * maxContentWidth) / textWidthAt30;
      setInputFontSizePx(Math.max(12, scaled));
    } else {
      setInputFontSizePx(30);
    }
  };
  useEffect(() => {
    if (!input) {
      setInputFontSizePx(30);
      return;
    }
    const raf = requestAnimationFrame(measureInputFontSize);
    const onResize = () => requestAnimationFrame(measureInputFontSize);
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, [input]);

  const handleBeholdYourWork = () => {
    const raw = localStorage.getItem(LS_DAILY.snapshot);
    if (!raw) return;
    let snap;
    try {
      snap = JSON.parse(raw);
    } catch {
      return;
    }
    const snapDay = snap.puzzleDate || snap.utcDate;
    if (snapDay !== getLocalDateString()) return;
    setLetters(snap.letters);
    setValidWords(snap.validWords || []);
    setScore(snap.score ?? 0);
    setGuessesRemaining(snap.guessesRemaining ?? 0);
    setManuallyEnded(!!snap.manuallyEnded);
    setHintWord(snap.hintWord ?? null);
    setGameOver(true);
    setRoundStarted(true);
    setShowRevealAnimation(false);
    setRevealAnimationPlayedThisRound(true);
    const invalidCount =
      typeof snap.invalidCount === 'number'
        ? snap.invalidCount
        : (snap.validWords || []).filter((w) => !w.isValid).length;
    localStorage.setItem('currentRoundMistakes_v2_4guess', String(invalidCount));
    localStorage.setItem('currentRoundScore_v2_4guess', String(snap.score ?? 0));
    const validWordsThisRound = (snap.validWords || []).filter((w) => w.isValid);
    localStorage.setItem('currentRoundLongestWords_v2_4guess', JSON.stringify(validWordsThisRound));
    setTimeout(() => {
      setStatsShowGameResultBanner(true);
      openStatsModal();
    }, 500);
  };

  const handleBegin = () => {
    const puzzleDay = getLocalDateString();
    if (readDailyCompletedUtc() === puzzleDay) return;
    if (readDailyAbandonedUtc() === puzzleDay) return;
    setShowRevealAnimation(true);
    setRevealAnimationPlayedThisRound(false);
    // Start the game after the reveal animation completes
    setTimeout(() => {
      rulesDismissedOnceRef.current = false;
    setRoundStarted(true);
      if (showRulesOnStart) {
        openRulesModal();
      } else {
        rulesDismissedOnceRef.current = true;
        // No rules modal: letters appear immediately with reveal; mark animation played after duration
        setTimeout(() => setRevealAnimationPlayedThisRound(true), 500);
      }
      // Focus the input field when the game starts (after they close rules)
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
        }
      }, 200);
    }, 500); // Match the animation duration
  };

  const toggleShowRulesOnStart = () => {
    const next = !showRulesOnStart;
    setShowRulesOnStart(next);
    try {
      localStorage.setItem('sequenceGameV2_4guessShowRulesOnStart', String(next));
    } catch (_) {}
  };

  const handleSubmit = async (e, valueFromMobile) => {
    e.preventDefault();
    if (!roundStarted || gameOver) return;
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    try {
      const currentInput = isMobile && valueFromMobile !== undefined
        ? valueFromMobile
        : isMobile
          ? ((inputRef.current && inputRef.current.value != null ? String(inputRef.current.value) : '') || (typeof inputValueRef.current === 'string' ? inputValueRef.current : '') || input)
          : input;
      const word = (typeof currentInput === 'string' ? currentInput : '').trim().toLowerCase();
      if (!word) { setError(true); setErrorMessage('Please enter a word'); setInput(''); inputValueRef.current = ''; return; }
      if (validWords.some(v => v.word === word)) { setError(true); setErrorMessage('Already guessed'); return; }
      if (word.length < 5) { setError(true); setErrorMessage('Must be 5+ letters long'); return; }
    
    if (!isSequential(word, letters)) { 
      setError(true); 
      setErrorMessage(`Word must contain '${letters}' in order`); 
      setValidWords(prev => [...prev, { word, length: 'x', bonusTime: 0, isValid: false }]);
        setInput(''); inputValueRef.current = '';
      setGuessesRemaining(prev => prev - 1);
      return; 
    }
    if (isSwearWord(word)) {
      setError(true);
      setErrorMessage('Cuss words do not count');
      return;
    }
    if (!(await isValidWord(word))) { 
      setError(true); 
        setErrorMessage('Word not found in list');
      setValidWords(prev => [...prev, { word, length: 'x', bonusTime: 0, isValid: false }]);
        setInput(''); inputValueRef.current = '';
      setGuessesRemaining(prev => prev - 1);
      return; 
    }

    const baseScore = word.length;
      setValidWords(prev => [...prev, { word, length: word.length, bonusTime: 0, isValid: true }]);
      setScore(prev => prev + baseScore);
    setLetterPopup(`+${baseScore}`);
    setTimeout(() => setLetterPopup(null), 1500);
      setInput(''); inputValueRef.current = ''; setError(false); setErrorMessage('');
    setGuessesRemaining(prev => prev - 1);
    
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
      }
    }, 0);
    } finally {
      isSubmittingRef.current = false;
    }
  };

  const handleEndGame = () => {
    // Add unused guesses as mistakes
    const unusedGuesses = guessesRemaining;
    const newValidWords = [...validWords];
    
    for (let i = 0; i < unusedGuesses; i++) {
      newValidWords.push({ word: 'unused', length: 'x', bonusTime: 0, isValid: false });
    }
    
    setValidWords(newValidWords);
    setGuessesRemaining(0);
    setManuallyEnded(true);
    setGameOver(true);
    
    // Update stats when game ends - use the updated validWords array
    const tempStats = normalizeStatsStreak({ ...stats });
    
    // Ensure all required properties exist
    tempStats.gamesPlayed = tempStats.gamesPlayed || 0;
    tempStats.gamesWon = tempStats.gamesWon || 0;
    tempStats.currentStreak = tempStats.currentStreak || 0;
    tempStats.maxStreak = tempStats.maxStreak || 0;
    tempStats.highestScores = tempStats.highestScores || [];
    tempStats.mistakes = coerceMistakesBuckets(tempStats.mistakes);
    tempStats.longestWords = tempStats.longestWords || [];
    tempStats.winScores = Array.isArray(tempStats.winScores) ? tempStats.winScores : [];
    if (!Array.isArray(tempStats.scoreDistribution) || tempStats.scoreDistribution.length !== 5) {
      tempStats.scoreDistribution = [0, 0, 0, 0, 0];
    }
    
    // Update games played (any round counts)
    tempStats.gamesPlayed += 1;
    
    // Update games won (if player found at least 1 valid word)
    const validWordCount = newValidWords.filter(word => word.isValid).length;
    const hasWon = validWordCount > 0;
    if (hasWon) {
      tempStats.gamesWon += 1;
    }
    
    // Streak: win every local calendar day (≥1 valid word); skip a day → reset to 1 on next win
    const puzzleDay = getLocalDateString();
    if (validWordCount > 0) {
      applyDailyCalendarWinStreak(tempStats, puzzleDay);
    } else {
      recordLossDate(tempStats, puzzleDay);
    }
    
    // Update highest scores (unique values only, max 3)
    if (score > 0) {
      tempStats.highestScores = normalizeHighestScoresList([...tempStats.highestScores, score]);
    }

    // Track win scores for average trend (only won games)
    if (hasWon && score > 0) {
      tempStats.winScores = [...tempStats.winScores, score];
    }

    // Bucket score into score distribution (only positive scores)
    if (score > 0) {
      const bIdx = bucketIndexForScore(score);
      tempStats.scoreDistribution[bIdx] = (tempStats.scoreDistribution[bIdx] || 0) + 1;
      localStorage.setItem('currentRoundScoreBucket_v2_4guess', String(bIdx));
    } else {
      localStorage.removeItem('currentRoundScoreBucket_v2_4guess');
    }
    
    // Update mistakes count (including unused guesses from early game ending)
    const invalidCount = newValidWords.filter(word => !word.isValid).length;
    if (tempStats.mistakes[invalidCount] !== undefined) {
      tempStats.mistakes[invalidCount]++;
    }
    
    // Store the current round's mistake count for highlighting
    localStorage.setItem('currentRoundMistakes_v2_4guess', invalidCount.toString());
    
    // Update longest words — one entry per word length (newest wins), max 3
    const validWordsThisRound = newValidWords.filter(word => word.isValid);
    validWordsThisRound.forEach(({word, length}) => {
      const existingIdx = tempStats.longestWords.findIndex(item => item.length === length);
      if (existingIdx !== -1) {
        tempStats.longestWords[existingIdx] = { word, length };
      } else {
        tempStats.longestWords.push({ word, length });
      }
    });
    tempStats.longestWords.sort((a, b) => b.length - a.length);
    tempStats.longestWords = tempStats.longestWords.slice(0, 4);
    
    // Store the current round's score for highlighting
    localStorage.setItem('currentRoundScore_v2_4guess', score.toString());
    
    // Store the current round's longest words for highlighting
    localStorage.setItem('currentRoundLongestWords_v2_4guess', JSON.stringify(validWordsThisRound));
    
    setStats(tempStats);
    localStorage.setItem('sequenceGameStats_v2_4guess', JSON.stringify(tempStats));

    saveDailyCompletionSnapshot({
      puzzleDate: getLocalDateString(),
      letters,
      validWords: newValidWords,
      score,
      guessesRemaining: 0,
      manuallyEnded: true,
      hintWord,
      invalidCount,
    });
    setDailyUiEpoch((e) => e + 1);

    // Show stats modal automatically after a brief delay (with round-result banner)
    setTimeout(() => {
      setStatsShowGameResultBanner(true);
      openStatsModal();
      const emojis = celebrationEmojisForScore(score);
      if (emojis) setCelebrationEmojis(emojis);
    }, 500);
  };

  const handleHint = async () => {
    if (!letters) return;
    if (hintWord) {
      setError(true);
      setErrorMessage(`Hint already used - ${hintWord.slice(0, 3).toUpperCase()}`);
      return;
    }
    if (!hintAvailable) {
      setError(true);
      setErrorMessage('Hint available after 30 seconds');
      return;
    }
    const word = dailyHintWord ?? await getDailyHintWord(letters, getLocalDateString());
    if (!word) return;
    if (!dailyHintWord) setDailyHintWord(word);
    const hintVal = word.slice(0, 3).toLowerCase();
    setHintWord(word);
    inputValueRef.current = hintVal;
    setInput(hintVal);
    setError(false);
    setErrorMessage('');
    setHintRevealAnimating(true);
    setTimeout(() => setHintRevealAnimating(false), 300);
  };

  const updateStats = () => {
    const newStats = normalizeStatsStreak({ ...stats });
    
    // Ensure all required properties exist
    newStats.gamesPlayed = newStats.gamesPlayed || 0;
    newStats.gamesWon = newStats.gamesWon || 0;
    newStats.currentStreak = newStats.currentStreak || 0;
    newStats.maxStreak = newStats.maxStreak || 0;
    newStats.highestScores = newStats.highestScores || [];
    newStats.mistakes = coerceMistakesBuckets(newStats.mistakes);
    newStats.longestWords = newStats.longestWords || [];
    newStats.winScores = Array.isArray(newStats.winScores) ? newStats.winScores : [];
    if (!Array.isArray(newStats.scoreDistribution) || newStats.scoreDistribution.length !== 5) {
      newStats.scoreDistribution = [0, 0, 0, 0, 0];
    }
    
    // Only update top statistics if this is a natural game completion (not manually ended)
    if (!manuallyEnded) {
      // Update games played
      newStats.gamesPlayed += 1;
      
      // Update games won (if player found at least 1 valid word)
      const validWordCount = validWords.filter(word => word.isValid).length;
      const hasWon = validWordCount > 0;
      if (hasWon) {
        newStats.gamesWon += 1;
      }
      
      const puzzleDay = getLocalDateString();
      if (validWordCount > 0) {
        applyDailyCalendarWinStreak(newStats, puzzleDay);
      } else {
        recordLossDate(newStats, puzzleDay);
      }

      // Track win scores for average trend (only won games)
      if (hasWon && score > 0) {
        newStats.winScores = [...newStats.winScores, score];
      }
    }
    
    // Always update performance stats
    // Update highest scores (unique values only, max 3)
    if (score > 0) {
      newStats.highestScores = normalizeHighestScoresList([...newStats.highestScores, score]);
    }

    // Bucket score into score distribution (only positive scores)
    if (score > 0) {
      const bIdx = bucketIndexForScore(score);
      newStats.scoreDistribution[bIdx] = (newStats.scoreDistribution[bIdx] || 0) + 1;
      localStorage.setItem('currentRoundScoreBucket_v2_4guess', String(bIdx));
    } else {
      localStorage.removeItem('currentRoundScoreBucket_v2_4guess');
    }
    
    // Update mistakes count
    const invalidCount = validWords.filter(word => !word.isValid).length;
    if (newStats.mistakes[invalidCount] !== undefined) {
      newStats.mistakes[invalidCount]++;
    }
    
    // Store the current round's mistake count for highlighting
    localStorage.setItem('currentRoundMistakes_v2_4guess', invalidCount.toString());
    
    // Update longest words — one entry per word length (newest wins), max 3
    const validWordsThisRound = validWords.filter(word => word.isValid);
    validWordsThisRound.forEach(({word, length}) => {
      const existingIdx = newStats.longestWords.findIndex(item => item.length === length);
      if (existingIdx !== -1) {
        newStats.longestWords[existingIdx] = { word, length };
      } else {
        newStats.longestWords.push({ word, length });
      }
    });
    newStats.longestWords.sort((a, b) => b.length - a.length);
    newStats.longestWords = newStats.longestWords.slice(0, 4);
    
    // Store the current round's score for highlighting
    localStorage.setItem('currentRoundScore_v2_4guess', score.toString());
    
    // Store the current round's longest words for highlighting
    localStorage.setItem('currentRoundLongestWords_v2_4guess', JSON.stringify(validWordsThisRound));
    
    setStats(newStats);
    localStorage.setItem('sequenceGameStats_v2_4guess', JSON.stringify(newStats));

    saveDailyCompletionSnapshot({
      puzzleDate: getLocalDateString(),
      letters,
      validWords,
      score,
      guessesRemaining,
      manuallyEnded,
      hintWord,
      invalidCount,
    });
    setDailyUiEpoch((e) => e + 1);
  };

  const handleInputChange = (e) => {
    if (!roundStarted || gameOver) return;
    const v = e.target.value;
    const lettersOnly = v.replace(/[^a-zA-Z]/g, '');
    const cleaned = lettersOnly.slice(0, 45);
    if (v !== lettersOnly) {
      setError(true);
      setErrorMessage('Letters only, please');
    } else {
      setError(false);
      setErrorMessage('');
    }
    inputValueRef.current = cleaned;
    setInput(cleaned);
    setShowMobileGuessList(false);
  };

  const handleKeyboardLetter = (letter) => {
    if (!roundStarted || gameOver) return;
    if (!/^[a-zA-Z]$/.test(letter)) {
      setError(true);
      setErrorMessage('Letters only, please');
      return;
    }
    const now = Date.now();
    if (lastKeyPressRef.current.key === letter && now - lastKeyPressRef.current.time < 100) return;
    lastKeyPressRef.current = { key: letter, time: now };

    const inputEl = inputRef.current;
    if (inputEl) {
      if (document.activeElement !== inputEl) inputEl.focus();
      let start = inputEl.selectionStart;
      const end = inputEl.selectionEnd || 0;
      const currentValue = inputEl.value;
      if (start === 0 && currentValue.length > 0 && document.activeElement !== inputEl) start = currentValue.length;
      else if (start === null || start === undefined) start = currentValue.length;
      const newValue = currentValue.slice(0, start) + letter + currentValue.slice(end);
      if (newValue.length > 45) {
        setError(true);
        setErrorMessage('Character limit reached (45)');
        return;
      }
      inputValueRef.current = newValue;
      setInput(newValue);
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.setSelectionRange(start + 1, start + 1);
        }
      }, 0);
    } else {
      const next = (inputValueRef.current || '') + letter;
      if (next.length > 45) {
        setError(true);
        setErrorMessage('Character limit reached (45)');
        return;
      }
      inputValueRef.current = next;
      setInput(next);
    }
    if (error) { setError(false); setErrorMessage(''); }
    setShowMobileGuessList(false);
  };
  handleKeyboardLetterRef.current = handleKeyboardLetter;

  const handleKeyboardBackspace = () => {
    if (!roundStarted || gameOver) return;
    const inputEl = inputRef.current;
    if (inputEl) {
      const start = inputEl.selectionStart || 0;
      const end = inputEl.selectionEnd || 0;
      const currentValue = inputEl.value;
      if (start !== end) {
        const newValue = currentValue.slice(0, start) + currentValue.slice(end);
        inputValueRef.current = newValue;
        setInput(newValue);
        setTimeout(() => { if (inputRef.current) inputRef.current.setSelectionRange(start, start); }, 0);
      } else if (start > 0) {
        const newValue = currentValue.slice(0, start - 1) + currentValue.slice(start);
        inputValueRef.current = newValue;
        setInput(newValue);
        setTimeout(() => { if (inputRef.current) inputRef.current.setSelectionRange(start - 1, start - 1); }, 0);
      }
    } else {
      const next = (inputValueRef.current || '').slice(0, -1);
      inputValueRef.current = next;
      setInput(next);
    }
    if (error) { setError(false); setErrorMessage(''); }
    setShowMobileGuessList(false);
  };

  const refocusInputSoon = () => {
    if (inputRef.current) {
      requestAnimationFrame(() => {
        if (inputRef.current && roundStarted && !gameOver) {
          inputRef.current.focus();
          const pos = inputRef.current.value.length;
          inputRef.current.setSelectionRange(pos, pos);
          if (isMobile) {
            setTimeout(() => {
              if (inputRef.current) {
                inputRef.current.focus();
                inputRef.current.setSelectionRange(pos, pos);
              }
            }, 50);
          }
        }
      });
    }
  };

  // On mobile, suppress native keyboard (readOnly + inputMode="none"); physical keyboards still work via keydown
  useEffect(() => {
    if (!isMobile || !roundStarted || gameOver) return;
    const onKeyDown = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Enter') {
        if (e.repeat) return; // ignore key repeat so we don't submit again with cleared input
        e.preventDefault();
        // On mobile, virtual keyboard updates inputValueRef; DOM value can be stale, so prefer ref first
        const val = (inputValueRef.current ?? inputRef.current?.value ?? input ?? '') || '';
        handleSubmit(e, val);
        return;
      }
      if (e.key === 'Backspace') {
        e.preventDefault();
        handleKeyboardBackspace();
        return;
      }
      if (/^[a-zA-Z]$/.test(e.key)) {
        e.preventDefault();
        handleKeyboardLetterRef.current?.(e.key);
      } else if (e.key.length === 1) {
        e.preventDefault();
        setError(true);
        setErrorMessage('Letters only, please');
      }
    };
    window.addEventListener('keydown', onKeyDown, { passive: false });
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isMobile, roundStarted, gameOver]);

  const clearStats = () => {
    // Clear all statistical data for this version only
    localStorage.removeItem('sequenceGameStats_v2_4guess');
    localStorage.removeItem('currentRoundScore_v2_4guess');
    localStorage.removeItem('currentRoundMistakes_v2_4guess');
    localStorage.removeItem('currentRoundLongestWords_v2_4guess');
    
    // Reset stats to initial state
    setStats({
      gamesPlayed: 0,
      gamesWon: 0,
      currentStreak: 0,
      maxStreak: 0,
      winDates: [],
      lastWinPuzzleDate: null,
      lastLossDate: null,
      highestScores: [],
      mistakes: Array.from({ length: GUESSES_PER_DAY + 1 }, () => 0),
      longestWords: [],
      winScores: [],
      scoreDistribution: [0, 0, 0, 0, 0],
    });
  };

  // Pop the score box (scale + color) when score increases
  useEffect(() => {
    if (score > prevScoreRef.current) {
      setScorePopping(true);
      const t = setTimeout(() => setScorePopping(false), 220);
      prevScoreRef.current = score;
      return () => clearTimeout(t);
    }
    prevScoreRef.current = score;
  }, [score]);

  const shapes = [
    { shape: 'circle', color: '#c85f31' },
    { shape: 'diamond', color: '#195b7c' },
    { shape: 'square', color: '#1c6d2a' }
  ];
  /** Main “provided letters” shapes — match my-app-ver4 (92px, 1.95rem letter size) */
  const size = 92;

  const openRulesModal = () => {
    rulesModalAnimTokenRef.current += 1;
    setRulesModalClosing(false);
    setRulesModalAnim({
      cardTransform: 'translate(0px, 0px) scale(1)',
      overlayOpacity: 0,
      transitionEnabled: false,
    });
    setShowRules(true);
  };

  useLayoutEffect(() => {
    if (!showRules || rulesModalClosing) return undefined;

    const token = rulesModalAnimTokenRef.current;
    const shrunk = computeIconModalShrinkStyle(
      rulesIconRef.current,
      rulesModalCardRef.current
    );

    setRulesModalAnim({
      ...shrunk,
      transitionEnabled: false,
    });

    let innerFrame = null;
    const outerFrame = requestAnimationFrame(() => {
      innerFrame = requestAnimationFrame(() => {
        if (token !== rulesModalAnimTokenRef.current) return;
        setRulesModalAnim({
          cardTransform: 'translate(0px, 0px) scale(1)',
          overlayOpacity: 1,
          transitionEnabled: true,
        });
      });
    });

    return () => {
      cancelAnimationFrame(outerFrame);
      if (innerFrame != null) cancelAnimationFrame(innerFrame);
    };
  }, [showRules, rulesModalClosing]);

  const closeRulesModal = () => {
    rulesDismissedOnceRef.current = true;
    const token = ++rulesModalAnimTokenRef.current;
    const shrunk = computeIconModalShrinkStyle(
      rulesIconRef.current,
      rulesModalCardRef.current
    );

    setRulesModalClosing(true);
    setRulesModalAnim({
      ...shrunk,
      transitionEnabled: true,
    });

    setTimeout(() => {
      if (token !== rulesModalAnimTokenRef.current) return;
      setShowRules(false);
      setRulesModalClosing(false);
      setRulesModalAnim({
        cardTransform: 'translate(0px, 0px) scale(1)',
        overlayOpacity: 1,
        transitionEnabled: false,
      });
      setTimeout(() => setRevealAnimationPlayedThisRound(true), 500);
      setTimeout(() => inputRef.current?.focus(), 100);
    }, ICON_MODAL_ANIM_MS);
  };

  const openStatsModal = () => {
    statsModalAnimTokenRef.current += 1;
    setStatsModalClosing(false);
    setStatsModalAnim({
      cardTransform: 'translate(0px, 0px) scale(1)',
      overlayOpacity: 0,
      transitionEnabled: false,
    });
    setShowStats(true);
  };

  useLayoutEffect(() => {
    if (!showStats || statsModalClosing) return undefined;

    const token = statsModalAnimTokenRef.current;
    const shrunk = computeIconModalShrinkStyle(
      statsIconRef.current,
      statsModalCardRef.current
    );

    setStatsModalAnim({
      ...shrunk,
      transitionEnabled: false,
    });

    let innerFrame = null;
    const outerFrame = requestAnimationFrame(() => {
      innerFrame = requestAnimationFrame(() => {
        if (token !== statsModalAnimTokenRef.current) return;
        setStatsModalAnim({
          cardTransform: 'translate(0px, 0px) scale(1)',
          overlayOpacity: 1,
          transitionEnabled: true,
        });
      });
    });

    return () => {
      cancelAnimationFrame(outerFrame);
      if (innerFrame != null) cancelAnimationFrame(innerFrame);
    };
  }, [showStats, statsModalClosing]);

  const closeStatsModal = () => {
    const token = ++statsModalAnimTokenRef.current;
    const shrunk = computeIconModalShrinkStyle(
      statsIconRef.current,
      statsModalCardRef.current
    );

    setStatsModalClosing(true);
    setStatsModalAnim({
      ...shrunk,
      transitionEnabled: true,
    });
    setShowClearStatsButton(false);

    setTimeout(() => {
      if (token !== statsModalAnimTokenRef.current) return;
      setShowStats(false);
      setStatsModalClosing(false);
      setStatsModalAnim({
        cardTransform: 'translate(0px, 0px) scale(1)',
        overlayOpacity: 1,
        transitionEnabled: false,
      });
    }, ICON_MODAL_ANIM_MS);
  };

  const handleRulesWizardTouchStart = (e) => {
    if (!isMobile) return;
    const t = e.touches[0];
    rulesWizardTouchStartRef.current = { x: t.clientX, y: t.clientY };
  };

  const handleRulesWizardTouchEnd = (e) => {
    if (!isMobile || !rulesWizardTouchStartRef.current) return;
    const t = e.changedTouches[0];
    const start = rulesWizardTouchStartRef.current;
    rulesWizardTouchStartRef.current = null;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    const minSwipe = 48;
    if (Math.abs(dx) < minSwipe) return;
    if (Math.abs(dy) > Math.abs(dx) * 1.15) return;
    if (dx < 0) {
      setRulesWizardStep((s) => Math.min(2, s + 1));
    } else {
      setRulesWizardStep((s) => Math.max(0, s - 1));
    }
  };

  /** Fixed footer (Contact, Report a Bug, copyright); reserve space so content sits above it */
  const footerBarVisible =
    !(isMobile && roundStarted && !gameOver) && !(showRules || rulesModalClosing);

  /** Version line is only in the outgoing email body, not shown in the modal (same layout as ver4 Timed mailto). */
  const buildContactMailBody = () => {
    const msg = contactMessage.trim();
    let bodyText = `${CONTACT_VERSION_LINE}\n\n`;
    const em = contactEmail.trim();
    if (em) {
      bodyText += `From: ${em}\n\n`;
    }
    bodyText += msg;
    return bodyText;
  };

  const closeContactModal = () => {
    setContactModalClosing(true);
    setShowContactModal(false);
    setTimeout(() => {
      setContactModalClosing(false);
      setContactEmail('');
      setContactSubject('');
      setContactMessage('');
      setContactModalMode('contact');
    }, 200);
  };

  const handleSendContact = () => {
    const msg = contactMessage.trim();
    if (!msg) return;
    const subject = encodeURIComponent(
      (contactSubject.trim() || 'Stringlish 4-Guess — contact').slice(0, 200)
    );
    const body = encodeURIComponent(buildContactMailBody());
    window.location.href = `mailto:${CONTACT_TO_EMAIL}?subject=${subject}&body=${body}`;
    closeContactModal();
  };

  const dailyHomeMeta = useMemo(() => {
    void dailyUiEpoch; // bump re-reads localStorage when daily completion/abandon changes
    const puzzleDay = getLocalDateString();
    return {
      puzzleDay,
      completedToday: readDailyCompletedUtc() === puzzleDay,
      abandonedToday: readDailyAbandonedUtc() === puzzleDay,
      puzzleNumber: getLocalStringlishNumber(),
      dateLabel: formatLocalDateLong(new Date()),
    };
  }, [dailyUiEpoch]);

  // In production the hub handles all entry points, so suppress the in-app landing
  // screen. In development (npm start) show it so the game is testable locally.
  if (!roundStarted && !gameOver && process.env.NODE_ENV !== 'development') {
    return <div className="w-full min-h-[100dvh]" />;
  }

  return (
    <div className={isMobile ? 'flex flex-col min-h-0' : ''}>
      {celebrationEmojis && (
        <FloatingEmojis
          emojis={celebrationEmojis}
          onDone={() => setCelebrationEmojis(null)}
        />
      )}
      <div
        className={
          isMobile
            ? `flex-1 min-h-0 overflow-y-auto ${
                footerBarVisible
                  ? 'pb-[5.5rem]'
                  : 'pb-[max(12px,env(safe-area-inset-bottom,0px))]'
              }`
            : footerBarVisible
              ? 'pb-[5.5rem]'
              : ''
        }
      >
    <div className={`p-6 max-w-xl mx-auto text-center space-y-6 relative overflow-hidden ${roundStarted ? 'pt-16' : ''}`}>
      <div className="flex justify-center items-center relative flex-col">
        {!roundStarted && (
          <>
            <a 
              href="https://stringlish.com"
              className="block hover:opacity-80 transition-opacity"
            >
              <img 
                src={process.env.PUBLIC_URL + "/letter-game-logo2.png"} 
                alt="Stringlish logo" 
                className="w-24 h-24 mb-4 object-contain"
                onError={(e) => {
                  e.target.style.display = 'none';
                }}
              />
            </a>
            <h1 className="text-3xl font-bold">Stringlish</h1>
            <p className="text-lg font-medium text-gray-600 mt-1 flex items-center justify-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" className="w-5 h-5 shrink-0" fill="currentColor" aria-hidden="true">
                <path d="M522.1 537.4C525.9 541.6 528 547.2 528 552.9C528 565.7 517.6 576 504.9 576L135.1 576C122.3 576 112 565.6 112 552.9C112 547.2 114.1 541.7 117.9 537.4L169.6 480L470.4 480L522.1 537.4zM320 64C443.7 64 544 164.3 544 288C544 342.8 524.3 393.1 491.5 432L148.5 432C115.7 393.1 96 342.8 96 288C96 164.3 196.3 64 320 64zM407.5 196.3C404.9 189.3 395.1 189.3 392.5 196.3L374.1 246.1L324.3 264.5C317.3 267.1 317.3 276.9 324.3 279.5L374.1 297.9L392.5 347.7C395.1 354.7 404.9 354.7 407.5 347.7L425.9 297.9L475.7 279.5C482.7 276.9 482.7 267.1 475.7 264.5L425.9 246.1L407.5 196.3zM263.5 148.3C260.9 141.3 251.1 141.3 248.5 148.3L238.7 174.7L212.3 184.5C205.3 187.1 205.3 196.9 212.3 199.5L238.7 209.3L248.5 235.7C251.1 242.7 260.9 242.7 263.5 235.7L273.3 209.3L299.7 199.5C306.7 196.9 306.7 187.1 299.7 184.5L273.3 174.7L263.5 148.3z"/>
              </svg>
              <span>4-Guess</span>
            </p>
          </>
        )}
        {!roundStarted && (
          <div className="mt-4 text-center space-y-1">
            <p className="text-base font-semibold text-gray-800">#{dailyHomeMeta.puzzleNumber}</p>
            <p className="text-sm text-gray-500">{dailyHomeMeta.dateLabel}</p>
          </div>
        )}
        {roundStarted && (
          <>
            {/* Sticky top bar: Score (left), controls (center), Give Up (right) */}
            <div className="fixed top-0 left-0 right-0 z-30 bg-white border-b border-gray-200">
              <div className="max-w-xl mx-auto px-6 py-2 flex items-center">
                <div className="flex-1 min-w-0 flex items-center">
                  <span className="tabular-nums border border-gray-300 rounded px-2 py-1 bg-gray-50">
                    <span
                      className={`inline-block text-base font-semibold ${
                        !gameOver && scorePopping ? 'score-pop' : 'text-gray-700'
                      }`}
                    >
                      Score: {score}
                    </span>
                  </span>
                </div>
                <div className="flex items-center justify-center flex-shrink-0 space-x-3">
                  <a 
                    href="https://stringlish.com"
              className="text-gray-600 hover:text-gray-800 transition-colors"
              title="Home"
            >
              <FontAwesomeIcon icon={faHouseChimney} className="text-lg" />
            </a>
            <button
                    ref={statsIconRef}
                    onClick={() => {
                      setStatsShowGameResultBanner(gameOver);
                      openStatsModal();
                    }}
              className="text-gray-600 hover:text-gray-800 transition-colors"
              title="Statistics"
            >
              <FontAwesomeIcon icon={faChartSimple} className="text-lg" />
            </button>
            <button
              ref={rulesIconRef}
              onClick={openRulesModal}
              className="text-gray-500 hover:text-gray-700 transition-colors"
              title="Rules"
            >
              <FontAwesomeIcon icon={faCircleQuestion} className="text-xl" />
            </button>
                </div>
                <div className="flex-1 min-w-0 flex items-center justify-end">
                  {!gameOver && (
                    <button
                      type="button"
                      onClick={() => setShowGiveUpConfirm(true)}
                      className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
                    >
                      Give Up?
                    </button>
                  )}
                </div>
              </div>
            </div>
            
            {/* Tooltip-style instructions */}
            {showInstructions && (
              <div className={`${isMobile ? 'fixed inset-0 z-50' : 'fixed top-20 left-1/2 transform -translate-x-1/2 z-50 mx-4'}`} onClick={isMobile ? () => setShowInstructions(false) : undefined}>
                <div className={`${isMobile ? 'fixed top-20 left-1/2 transform -translate-x-1/2 mx-4' : ''}`} onClick={isMobile ? (e) => e.stopPropagation() : undefined}>
                  <div className="bg-gray-800 text-white text-sm rounded-lg p-4 shadow-lg max-w-md w-full">
                    {/* Arrow pointing up */}
                    <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-b-4 border-transparent border-b-gray-800"></div>
                    
                    <p className="leading-relaxed">
                      Use the provided letters, in the order they appear, to create words—there can be other letters before, after and between the provided letters, as long as they remain in Sequence.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {!roundStarted ? (
        <div className="flex flex-col items-center space-y-3">
          {dailyHomeMeta.completedToday ? (
            <button
              type="button"
              onClick={handleBeholdYourWork}
              className="bg-white border border-gray-400 text-black w-52 h-16 text-xl font-semibold rounded flex items-center justify-center gap-2"
            >
              <span className="select-none" aria-hidden>🤩</span>
              Behold Your Work
            </button>
          ) : dailyHomeMeta.abandonedToday ? (
            <p className="text-sm text-gray-600 text-center max-w-xs px-2">
              You left today&apos;s puzzle unfinished. Come back tomorrow for the next one.
            </p>
          ) : (
            <button
              type="button"
              onClick={handleBegin}
              className="bg-white border border-gray-400 text-black w-52 h-16 text-xl font-semibold rounded"
            >
              BEGIN
            </button>
          )}
          <div className="flex flex-row items-center space-x-4">
            <a 
              href="https://stringlish.com"
              className="text-gray-600 hover:text-gray-800 transition-colors"
              title="Home"
            >
              <FontAwesomeIcon icon={faHouseChimney} className="text-lg" />
            </a>
            <button
              ref={statsIconRef}
              onClick={() => {
                setStatsShowGameResultBanner(false);
                openStatsModal();
              }}
              className="text-gray-600 hover:text-gray-800 transition-colors"
              title="Statistics"
            >
              <FontAwesomeIcon icon={faChartSimple} className="text-lg" />
            </button>
            <button ref={rulesIconRef} onClick={openRulesModal} className="text-gray-500 hover:text-gray-700 transition-colors" title="Rules">
              <FontAwesomeIcon icon={faCircleQuestion} className="text-xl" />
            </button>
          </div>
        </div>
      ) : (gameOver || showRules) ? null : (
        <div className={`space-y-4 ${showRevealAnimation && !revealAnimationPlayedThisRound ? 'reveal-content' : ''}`}>
          <div className="flex justify-center space-x-3 items-center">
          {letters.split('').map((char, idx) => {
            const { shape, color } = shapes[idx];
            const common = { 
              width:`${size}px`, 
              height:`${size}px`, 
              display:'flex', 
              alignItems:'center', 
              justifyContent:'center', 
              color:'white', 
              fontSize:'1.95rem', 
              fontWeight:'600',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
              transition: 'all 0.2s ease-in-out'
            };
            const style = shape==='circle' ? {
              ...common, 
              backgroundColor:color, 
              borderRadius:'50%',
              boxShadow: '0 4px 16px rgba(0, 0, 0, 0.2)'
            } : shape==='diamond' ? {
              ...common, 
              backgroundColor:color, 
              borderRadius:'12px',
              transform: 'rotate(45deg) scale(0.85)',
              boxShadow: '0 4px 16px rgba(0, 0, 0, 0.2)'
            } : {
              ...common, 
              backgroundColor:color,
              borderRadius:'12px',
              boxShadow: '0 4px 16px rgba(0, 0, 0, 0.2)'
            };
            return (
              <div key={idx} style={style} className="relative">
                {shape === 'diamond' ? (
                  <span style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '1.75rem',
                    fontWeight: 600,
                    color: 'white',
                    transform: 'rotate(-45deg) scale(1.176)', // Compensate for parent scale(0.85)
                  }}>
                    {char}
                  </span>
                ) : (
                  <span>{char}</span>
                )}
              </div>
            );
          })}
        </div>
          {/* Input section */}
          <div className="space-y-4">
                <div
                  ref={inputContainerRef}
                  className={`border-0 border-b rounded-none ${error ? 'border-red-600' : 'border-gray-200'}`}
                >
                  <div
                    className={`w-full relative ${hintRevealAnimating ? 'hint-reveal-anim' : ''}`}
                    style={{ transformOrigin: 'center center' }}
                  >
                    <span
                      ref={inputMeasureRef}
                      aria-hidden
                      className="absolute left-0 font-semibold whitespace-nowrap pointer-events-none invisible"
                      style={{ fontSize: '30px' }}
                    >
                      {input || ' '}
                    </span>
              <input 
                ref={inputRef}
                type="text" 
                value={input} 
                onChange={handleInputChange}
                      maxLength={45}
                      onPaste={(e) => {
                        const pasted = (e.clipboardData && e.clipboardData.getData('text')) || '';
                        if (input.length + pasted.length > 45) {
                          setTimeout(() => {
                            setError(true);
                            setErrorMessage('Character limit reached (45)');
                          }, 0);
                        }
                      }}
                      className="border-0 rounded-none px-0 py-2 w-full font-semibold focus:ring-0 focus:outline-none bg-transparent placeholder:font-normal placeholder:text-gray-400 text-center"
                      style={{
                        fontSize: `${inputFontSizePx}px`,
                        ...(error ? { color: '#c85f31' } : {}), caretColor: 'transparent',
                        ...(isMobile ? { WebkitTapHighlightColor: 'transparent', cursor: 'text' } : {})
                      }}
                      placeholder="start typing..."
                      autoFocus 
                disabled={!roundStarted||gameOver}
                      readOnly={isMobile}
                      inputMode={isMobile ? 'none' : undefined}
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      onTouchStart={(e) => {
                        if (isMobile && inputRef.current) {
                          e.preventDefault();
                          const inputEl = inputRef.current;
                          inputEl.removeAttribute('readonly');
                          inputEl.focus();
                          const pos = inputEl.value.length;
                          inputEl.setSelectionRange(pos, pos);
                          setTimeout(() => {
                            inputEl.setAttribute('readonly', 'readonly');
                            inputEl.focus();
                            inputEl.setSelectionRange(pos, pos);
                          }, 100);
                          setTimeout(() => {
                            inputEl.focus();
                            inputEl.setSelectionRange(pos, pos);
                          }, 200);
                        }
                      }}
                      onFocus={(e) => {
                        if (e.target) {
                          const inputEl = e.target;
                          let pos = inputEl.selectionStart;
                          if ((pos === 0 || pos === null || pos === undefined) && inputEl.value.length > 0) pos = inputEl.value.length;
                          else if (pos === null || pos === undefined) pos = inputEl.value.length;
                          setTimeout(() => inputEl.setSelectionRange(pos, pos), 0);
                          if (isMobile) {
                            setTimeout(() => { inputEl.setSelectionRange(pos, pos); inputEl.focus(); }, 10);
                            setTimeout(() => inputEl.setSelectionRange(pos, pos), 50);
                          }
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                          if (!/^[a-zA-Z]$/.test(e.key)) {
                            e.preventDefault();
                            setError(true);
                            setErrorMessage('Letters only, please');
                            return;
                          }
                          if (input.length >= 45) {
                            setError(true);
                            setErrorMessage('Character limit reached (45)');
                          }
                        }
                        if (e.key === 'Enter' && !e.repeat) {
                          e.stopPropagation();
                          handleSubmit(e, isMobile ? (inputValueRef.current ?? inputRef.current?.value ?? input ?? '') : undefined);
                        }
                      }}
                      onClick={(e) => {
                        if (isMobile && inputRef.current) {
                          const inputEl = inputRef.current;
                          const rect = inputEl.getBoundingClientRect();
                          const clickX = e.clientX - rect.left;
                          const clickPosition = Math.round(clickX / 8);
                          const newPosition = Math.max(0, Math.min(inputEl.value.length, clickPosition));
                          inputEl.setSelectionRange(newPosition, newPosition);
                          inputEl.focus();
                          setTimeout(() => inputEl.setSelectionRange(newPosition, newPosition), 10);
                          setTimeout(() => inputEl.setSelectionRange(newPosition, newPosition), 50);
                        }
                      }}
                      onBlur={() => {
                        if (roundStarted && !gameOver) {
                          setTimeout(() => {
                            if (inputRef.current && document.activeElement !== inputRef.current) {
                              inputRef.current.focus();
                            }
                          }, 150);
                        }
                      }}
                    />
                  </div>
                </div>
                {/* Player's guesses — list icon (left), dots (center), Hint (right) */}
                <div className="flex flex-col items-center">
                  <div className="flex justify-center items-center gap-2 sm:gap-3 w-full max-w-xs">
                    <button
                      ref={mobileGuessListBtnRef}
                      type="button"
                      title="Tap to view your guesses"
                      onClick={() => {
                        mobileGuessListSnapshotRef.current = validWords.slice(0, GUESSES_PER_DAY);
                        updateGuessListPopupPosition();
                        setShowMobileGuessList(true);
                      }}
                      className="flex-shrink-0 flex flex-col items-center justify-center gap-0.5 py-1 px-1.5 rounded-md text-gray-600 hover:bg-gray-50/80 hover:text-gray-800 active:bg-gray-100 active:text-gray-900 min-h-[2.75rem]"
                      aria-label="Show guessed words — tap to expand"
                    >
                      <FontAwesomeIcon icon={faList} className="text-lg shrink-0" />
                      <FontAwesomeIcon
                        icon={faChevronDown}
                        className="shrink-0 text-gray-500"
                        style={{ width: 10, height: 10, display: 'block' }}
                        aria-hidden
                      />
                    </button>
                    <div className="flex justify-center gap-2 sm:gap-3">
                      {Array.from({ length: GUESSES_PER_DAY }, (_, idx) => idx).map((idx) => {
                        const entry = validWords[idx];
                        const isEmpty = !entry || entry.word === 'unused';
                        const isCorrect = entry && entry.isValid;
                        const isCurrentGuess = isEmpty && idx === validWords.length;
                        return (
                          <div
                            key={idx}
                            className={`flex-shrink-0 w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center text-sm font-bold ${isCurrentGuess ? 'current-guess-dot' : ''}`}
                            style={{
                              backgroundColor: isEmpty ? (isCurrentGuess ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.06)') : isCorrect ? 'rgba(28, 109, 42, 0.2)' : 'rgba(200, 95, 49, 0.2)',
                              border: `2px solid ${isEmpty ? (isCurrentGuess ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.12)') : isCorrect ? '#1c6d2a' : '#c85f31'}`,
                              color: isEmpty ? 'transparent' : isCorrect ? '#1c6d2a' : '#c85f31'
                            }}
                            title={entry && entry.word !== 'unused' ? `${entry.word} (${entry.length})` : 'No guess yet'}
                          >
                            {isEmpty ? '' : isCorrect ? '✓' : '✗'}
                          </div>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      onClick={handleHint}
                      disabled={!roundStarted||gameOver}
                      className={`flex-shrink-0 relative py-1.5 px-2.5 rounded flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed overflow-visible border-0 ${
                        hintWord
                          ? 'text-white'
                          : hintAvailable
                            ? 'text-white hover:opacity-90'
                            : 'bg-white text-gray-400'
                      }`}
                      style={hintWord ? { backgroundColor: 'rgba(28, 109, 42, 0.4)' } : hintAvailable && !hintWord ? { backgroundColor: '#1c6d2a' } : undefined}
                      title={hintAvailable ? "Hint" : "Hint available in 30 seconds"}
                      aria-label={hintAvailable ? "Hint" : "Hint loading"}
                    >
                      {!hintWord && !hintAvailable && (
                        <svg
                          className="absolute inset-0 w-full h-full pointer-events-none rounded-lg"
                          viewBox="0 0 100 100"
                          preserveAspectRatio="none"
                          aria-hidden
                        >
                          <path
                            d="M 50 2 L 84 2 A 14 14 0 0 1 98 16 L 98 84 A 14 14 0 0 1 84 98 L 16 98 A 14 14 0 0 1 2 84 L 2 16 A 14 14 0 0 1 16 2 L 50 2"
                            fill="none"
                            stroke="#1c6d2a"
                            strokeWidth="8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            pathLength={1}
                            strokeDasharray="1 1"
                            style={{ strokeDashoffset: 1 - hintFillProgress / 100, transition: 'stroke-dashoffset 0.25s linear' }}
                          />
                        </svg>
                      )}
                      <span className={`relative z-10 text-sm font-medium ${hintReadyPop ? 'hint-ready-pop' : ''}`}>
                        Hint
                      </span>
                    </button>
                  </div>
                  {showMobileGuessList && createPortal(
                    <div
                      className="fixed inset-0 z-[100] bg-black/25"
                      style={{ top: 0, left: 0, right: 0, bottom: 0 }}
                      onClick={() => {
                        setShowMobileGuessList(false);
                        setGuessListPopupPosition(null);
                      }}
                      aria-hidden
                    >
                      <div
                        className={`bg-white rounded-lg shadow-lg border border-gray-200 p-4 max-h-[70vh] overflow-y-auto ${guessListPopupPosition ? 'guess-popover-panel' : ''}`}
                        style={
                          guessListPopupPosition
                            ? {
                                position: 'fixed',
                                top: guessListPopupPosition.top,
                                left: guessListPopupPosition.left,
                                width: guessListPopupPosition.width,
                                maxWidth: 'calc(100vw - 20px)',
                                transformOrigin: 'top left',
                              }
                            : {
                                position: 'fixed',
                                left: '50%',
                                top: '50%',
                                transform: 'translate(-50%, -50%)',
                                width: 'min(320px, 90vw)',
                                maxWidth: '90vw',
                              }
                        }
                        onClick={(e) => e.stopPropagation()}
                        onTouchStart={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="text-sm font-semibold text-gray-700 pt-0.5 pr-2">Your Guesses</div>
                          <button
                            type="button"
                            className="flex-shrink-0 -mr-1 -mt-1 p-1.5 rounded-md text-gray-500 hover:text-gray-800 hover:bg-gray-100 active:bg-gray-200"
                            aria-label="Close guesses"
                            onClick={() => {
                              setShowMobileGuessList(false);
                              setGuessListPopupPosition(null);
                            }}
                          >
                            <FontAwesomeIcon icon={faXmark} className="text-lg" />
                          </button>
                        </div>
                        <div className="flex flex-col gap-2">
                          {(mobileGuessListSnapshotRef.current || []).map(({ word, length, isValid }, idx) => (
                            <div key={idx} className="rounded-lg px-3 py-2 flex items-center space-x-2" style={{
                              backgroundColor: isValid ? 'rgba(28, 109, 42, 0.15)' : 'rgba(200, 95, 49, 0.15)',
                              border: isValid ? '1px solid rgba(28, 109, 42, 0.3)' : '1px solid rgba(200, 95, 49, 0.3)'
                            }}>
                              <span className="font-medium" style={{ color: isValid ? '#1c6d2a' : '#c85f31' }}>
                                {word === 'unused' ? 'No guess' : (word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())}
                              </span>
                              <span className="text-xs" style={{ color: isValid ? '#1c6d2a' : '#c85f31' }}>
                                {word === 'unused' ? '' : `(${length})`}
                              </span>
                            </div>
                          ))}
                          {(mobileGuessListSnapshotRef.current || []).length === 0 && (
                            <div className="text-gray-500 text-sm py-2">No guesses yet</div>
                          )}
                        </div>
                      </div>
                    </div>,
                    document.body
                  )}
                </div>
                {/* Error message container */}
                <div className="min-h-[1.5rem] flex items-center justify-center">
                  {error && (
                    <p
                      className="text-sm text-center px-2"
                      style={{
                        color: '#c85f31',
                        animation: 'fadeIn 0.2s ease-in-out'
                      }}
                      role="alert"
                    >
                      {errorMessage}
                    </p>
                  )}
                </div>
                {!isMobile && (
              <div className="relative inline-block">
                <button onClick={handleSubmit} style={{backgroundColor:'#195b7c'}} className="text-white px-4 py-2 rounded text-lg disabled:opacity-50" disabled={!roundStarted||gameOver}>Submit</button>
              </div>
          )}
              </div>
        </div>
      )}

      {/* Virtual Keyboard - only on mobile; fixed at bottom; scales to viewport with 8px edge margin (matches ver4) */}
      {isMobile && roundStarted && !gameOver && !showRules && (() => {
        // Use live viewport so keyboard size updates on resize / orientation / visualViewport changes
        const vw = typeof window !== 'undefined' ? (window.visualViewport ? window.visualViewport.width : window.innerWidth) : viewportWidth;
        const vh = typeof window !== 'undefined' ? (window.visualViewport ? window.visualViewport.height : window.innerHeight) : viewportHeight;
        const edgeMargin = 8;
        const originalKeyBaseWidth = 35;
        const originalGapBase = 8;
        const keyCountTopRow = 10;
        const gapCountTopRow = keyCountTopRow - 1;
        const originalDesignRowWidth = keyCountTopRow * originalKeyBaseWidth + gapCountTopRow * originalGapBase;
        const keyBaseWidth = originalKeyBaseWidth + 3;
        const keyBaseHeight = 45 + 3;
        const gapBase = (originalDesignRowWidth - keyCountTopRow * keyBaseWidth) / gapCountTopRow;
        const availableWidth = Math.max(0, vw - 2 * edgeMargin);
        const designRowWidth = originalDesignRowWidth;
        let scale = availableWidth / designRowWidth;
        let gapPx = gapBase * scale;
        const gapMax = 10;
        const gapMin = 4;
        if (gapPx > gapMax && keyCountTopRow * keyBaseWidth > 0) {
          scale = (availableWidth - gapCountTopRow * gapMax) / (keyCountTopRow * keyBaseWidth);
          gapPx = gapMax;
        }
        gapPx = Math.max(gapMin, Math.min(gapMax, Math.round(gapPx)));
        const rowGapPx = Math.round(gapPx * 1.6);
        const letterW = Math.round(keyBaseWidth * scale);
        const keyPadding = 4;
        const containerPaddingH = 8;
        const containerPaddingB = 8;
        const maxKeyboardHeight = typeof vh === 'number' && vh > 0 ? Math.min(vh * 0.4, 350) : 350;
        const nonKeyVertical = 8 + containerPaddingB + 2 * rowGapPx;
        const maxLetterHeightFromContainer = Math.floor((maxKeyboardHeight - nonKeyVertical) / 4);
        const unconstrainedLetterH = Math.round(keyBaseHeight * scale);
        const letterH = Math.max(30, Math.min(60, unconstrainedLetterH, maxLetterHeightFromContainer));
        const bottomLettersCount = 7;
        const bottomKeysTotalWidth = bottomLettersCount * letterW;
        const bottomGapCount = bottomLettersCount + 2 - 1;
        const bottomGapsTotalWidth = bottomGapCount * gapPx;
        const specialWidth = Math.max(0, Math.round((availableWidth - bottomKeysTotalWidth - bottomGapsTotalWidth) / 2));
        const submitWidth = bottomKeysTotalWidth + (bottomLettersCount - 1) * gapPx;
        const specialHeight = letterH;
        const popupScale = 1.2;
        const popupW = Math.round(letterW * popupScale);
        const popupH = Math.round(letterH * popupScale);
        const popupGap = 4;
        const keyBg = '#e5e7eb';
        const triUpper = (letters && String(letters).toUpperCase()) || '';
        // Build a map of letter → array of position colors (in order), allowing duplicates
        const mobileProvidedLetterColors = {};
        for (let i = 0; i < Math.min(3, triUpper.length); i++) {
          const c = triUpper[i];
          if (c) {
            if (!mobileProvidedLetterColors[c]) mobileProvidedLetterColors[c] = [];
            mobileProvidedLetterColors[c].push(shapes[i].color);
          }
        }
        // Returns a CSS `background` value: solid color for 1, hard-stop gradient for 2–3
        const buildKeyGradient = (colors) => {
          if (!colors || colors.length === 0) return null;
          if (colors.length === 1) return colors[0];
          const n = colors.length;
          const stops = [];
          colors.forEach((c, i) => {
            const startPct = (i / n * 100).toFixed(4) + '%';
            const endPct = ((i + 1) / n * 100).toFixed(4) + '%';
            if (i === 0) {
              stops.push(`${c} ${endPct}`);
            } else if (i === n - 1) {
              stops.push(`${c} ${startPct}`);
            } else {
              stops.push(`${c} ${startPct}`, `${c} ${endPct}`);
            }
          });
          return `linear-gradient(to right, ${stops.join(', ')})`;
        };
        const findNearestIndexByCenters = (x, widths, gap) => {
          let cursor = 0;
          let bestIndex = 0;
          let bestDist = Infinity;
          for (let i = 0; i < widths.length; i++) {
            const center = cursor + widths[i] / 2;
            const dist = Math.abs(x - center);
            if (dist < bestDist) { bestDist = dist; bestIndex = i; }
            cursor += widths[i] + gap;
          }
          return bestIndex;
        };
        const handleTopRowBackgroundPointerDown = (event) => {
          if (!roundStarted || gameOver) return;
          if (event.target && event.target.closest && event.target.closest('button')) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const x = event.clientX - rect.left;
          const letters = ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'];
          const widths = new Array(letters.length).fill(letterW);
          const idx = findNearestIndexByCenters(x, widths, gapPx);
          const letter = letters[idx] || letters[0];
          event.preventDefault();
          event.stopPropagation();
          setPressedKey(letter);
          const useCapital = mobileShiftActiveRef.current;
          handleKeyboardLetter(useCapital ? letter : letter.toLowerCase());
          if (useCapital && !mobileCapsLockRef.current) {
            mobileShiftActiveRef.current = false;
            setMobileShiftActive(false);
          }
          refocusInputSoon();
        };
        const handleTopRowPointerUpOrCancel = () => { setPressedKey(null); };
        const handleMiddleRowBackgroundPointerDown = (event) => {
          if (!roundStarted || gameOver) return;
          if (event.target && event.target.closest && event.target.closest('button')) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const x = event.clientX - rect.left;
          const letters = ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'];
          const widths = new Array(letters.length).fill(letterW);
          const idx = findNearestIndexByCenters(x, widths, gapPx);
          const letter = letters[idx] || letters[0];
          event.preventDefault();
          event.stopPropagation();
          setPressedKey(letter);
          const useCapital = mobileShiftActiveRef.current;
          handleKeyboardLetter(useCapital ? letter : letter.toLowerCase());
          if (useCapital && !mobileCapsLockRef.current) {
            mobileShiftActiveRef.current = false;
            setMobileShiftActive(false);
          }
          refocusInputSoon();
        };
        const handleMiddleRowPointerUpOrCancel = () => { setPressedKey(null); };
        const handleBottomRowBackgroundPointerDown = (event) => {
          if (!roundStarted || gameOver) return;
          if (event.target && event.target.closest && event.target.closest('button')) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const x = event.clientX - rect.left;
          const keys = [
            { type: 'shift' },
            { type: 'letter', value: 'Z' }, { type: 'letter', value: 'X' }, { type: 'letter', value: 'C' },
            { type: 'letter', value: 'V' }, { type: 'letter', value: 'B' }, { type: 'letter', value: 'N' }, { type: 'letter', value: 'M' },
            { type: 'backspace' },
          ];
          const widths = [specialWidth, letterW, letterW, letterW, letterW, letterW, letterW, letterW, specialWidth];
          const idx = findNearestIndexByCenters(x, widths, gapPx);
          const key = keys[idx] || keys[0];
          event.preventDefault();
          event.stopPropagation();
          if (key.type === 'letter') {
            const letter = key.value;
            setPressedKey(letter);
            const useCapital = mobileShiftActiveRef.current;
            handleKeyboardLetter(useCapital ? letter : letter.toLowerCase());
            if (useCapital && !mobileCapsLockRef.current) {
              mobileShiftActiveRef.current = false;
              setMobileShiftActive(false);
            }
            refocusInputSoon();
          } else if (key.type === 'shift') {
            setPressedKey('shift');
            const now = Date.now();
            if (!mobileShiftActive) {
              mobileShiftActiveRef.current = true;
              mobileCapsLockRef.current = false;
              setMobileShiftActive(true);
              setMobileCapsLock(false);
              mobileShiftOnAtRef.current = now;
            } else if (mobileCapsLock) {
              mobileShiftActiveRef.current = false;
              mobileCapsLockRef.current = false;
              setMobileShiftActive(false);
              setMobileCapsLock(false);
            } else {
              if (now - mobileShiftOnAtRef.current < 450) {
                mobileCapsLockRef.current = true;
                setMobileCapsLock(true);
              } else {
                mobileShiftActiveRef.current = false;
                setMobileShiftActive(false);
              }
            }
            refocusInputSoon();
          } else if (key.type === 'backspace') {
            setPressedKey('backspace');
            handleKeyboardBackspace();
            refocusInputSoon();
          }
        };
        const handleBottomRowPointerUpOrCancel = () => { setPressedKey(null); };
        return (
        <>
          <div style={{ marginTop: 15, minHeight: 260 }} aria-hidden />
          <div
            className={isMobile ? "" : "mt-4"}
            style={isMobile ? { position: 'fixed', bottom: 0, left: 0, right: 0, padding: `8px ${containerPaddingH}px ${containerPaddingB}px`, borderTop: '1px solid #e5e7eb', backgroundColor: '#ffffff', zIndex: 20 } : { padding: '0 10px' }}
          >
            {/* Top row: Q-P */}
            <div className="flex justify-center relative flex-nowrap" style={{ gap: gapPx, marginBottom: rowGapPx }} onPointerDown={handleTopRowBackgroundPointerDown} onPointerUp={handleTopRowPointerUpOrCancel} onPointerCancel={handleTopRowPointerUpOrCancel}>
              {['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'].map((letter) => {
                const provColors = mobileProvidedLetterColors[letter];
                const provBg = buildKeyGradient(provColors);
                const popBg = (provColors && provColors[0]) || keyBg;
                const popFg = provBg ? '#ffffff' : '#1f2937';
                return (
                <div key={letter} style={{ position: 'relative', width: letterW, height: letterH, flexShrink: 0, overflow: 'visible' }}>
                  <button
                    type="button"
                    onPointerDown={(e) => {
                      e.preventDefault(); e.stopPropagation();
                      setPressedKey(letter);
                      const useCapital = mobileShiftActiveRef.current;
                      handleKeyboardLetter(useCapital ? letter : letter.toLowerCase());
                      if (useCapital && !mobileCapsLockRef.current) { mobileShiftActiveRef.current = false; setMobileShiftActive(false); }
                      refocusInputSoon();
                    }}
                    onPointerUp={(e) => { e.preventDefault(); e.stopPropagation(); setPressedKey(null); }}
                    onPointerCancel={(e) => { e.preventDefault(); e.stopPropagation(); setPressedKey(null); }}
                    className={`font-semibold rounded-lg text-base sm:text-lg transition-colors touch-manipulation ${provBg ? 'text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-800'}`}
                    disabled={!roundStarted || gameOver}
                    style={{
                      touchAction: 'manipulation',
                      width: '100%',
                      height: '100%',
                      padding: keyPadding,
                      boxSizing: 'border-box',
                      userSelect: 'none',
                      WebkitUserSelect: 'none',
                      WebkitTapHighlightColor: 'transparent',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      minHeight: letterH,
                      position: 'relative',
                      zIndex: 2,
                      pointerEvents: 'auto',
                      ...(provBg ? { background: provBg } : {}),
                    }}
                  >
                    {pressedKey === letter ? '' : letter}
                  </button>
                  {pressedKey === letter && (
                    <>
                      <div style={{ position: 'absolute', left: 0, right: 0, bottom: '100%', height: popupGap, backgroundColor: popBg, borderTopLeftRadius: 6, borderTopRightRadius: 6, zIndex: 10 }} />
                      <div style={{ position: 'absolute', left: '50%', marginLeft: -popupW / 2, bottom: `calc(100% + ${popupGap}px)`, width: popupW, height: popupH, backgroundColor: popBg, borderRadius: 8, boxShadow: '0 2px 6px rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2em', fontWeight: 600, color: popFg, zIndex: 10, pointerEvents: 'none' }}>{letter}</div>
                    </>
                )}
              </div>
                );
              })}
            </div>
            {/* Middle row: A-L */}
            <div className="flex justify-center relative flex-nowrap" style={{ gap: gapPx, marginBottom: rowGapPx }} onPointerDown={handleMiddleRowBackgroundPointerDown} onPointerUp={handleMiddleRowPointerUpOrCancel} onPointerCancel={handleMiddleRowPointerUpOrCancel}>
              {['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'].map((letter) => {
                const provColors = mobileProvidedLetterColors[letter];
                const provBg = buildKeyGradient(provColors);
                const popBg = (provColors && provColors[0]) || keyBg;
                const popFg = provBg ? '#ffffff' : '#1f2937';
                return (
                <div key={letter} style={{ position: 'relative', width: letterW, height: letterH, flexShrink: 0, overflow: 'visible' }}>
                  <button
                    type="button"
                    onPointerDown={(e) => {
                      e.preventDefault(); e.stopPropagation();
                      setPressedKey(letter);
                      const useCapital = mobileShiftActiveRef.current;
                      handleKeyboardLetter(useCapital ? letter : letter.toLowerCase());
                      if (useCapital && !mobileCapsLockRef.current) { mobileShiftActiveRef.current = false; setMobileShiftActive(false); }
                      refocusInputSoon();
                    }}
                    onPointerUp={(e) => { e.preventDefault(); e.stopPropagation(); setPressedKey(null); }}
                    onPointerCancel={(e) => { e.preventDefault(); e.stopPropagation(); setPressedKey(null); }}
                    className={`font-semibold rounded-lg text-base sm:text-lg transition-colors touch-manipulation ${provBg ? 'text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-800'}`}
                    disabled={!roundStarted || gameOver}
                    style={{
                      touchAction: 'manipulation',
                      width: '100%',
                      height: '100%',
                      padding: keyPadding,
                      boxSizing: 'border-box',
                      userSelect: 'none',
                      WebkitUserSelect: 'none',
                      WebkitTapHighlightColor: 'transparent',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      minHeight: letterH,
                      position: 'relative',
                      zIndex: 2,
                      pointerEvents: 'auto',
                      ...(provBg ? { background: provBg } : {}),
                    }}
                  >
                    {pressedKey === letter ? '' : letter}
                  </button>
                  {pressedKey === letter && (
                    <>
                      <div style={{ position: 'absolute', left: 0, right: 0, bottom: '100%', height: popupGap, backgroundColor: popBg, borderTopLeftRadius: 6, borderTopRightRadius: 6, zIndex: 10 }} />
                      <div style={{ position: 'absolute', left: '50%', marginLeft: -popupW / 2, bottom: `calc(100% + ${popupGap}px)`, width: popupW, height: popupH, backgroundColor: popBg, borderRadius: 8, boxShadow: '0 2px 6px rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2em', fontWeight: 600, color: popFg, zIndex: 10, pointerEvents: 'none' }}>{letter}</div>
                    </>
            )}
            </div>
                );
              })}
                </div>
            {/* Bottom row: Shift + Z-M + Backspace */}
            <div className="flex justify-center relative flex-nowrap" style={{ gap: gapPx, marginBottom: rowGapPx }} onPointerDown={handleBottomRowBackgroundPointerDown} onPointerUp={handleBottomRowPointerUpOrCancel} onPointerCancel={handleBottomRowPointerUpOrCancel}>
              <div style={{ position: 'relative', width: specialWidth, height: specialHeight, flexShrink: 0 }}>
                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault(); e.stopPropagation();
                    setPressedKey('shift');
                    const now = Date.now();
                    if (!mobileShiftActive) {
                      mobileShiftActiveRef.current = true;
                      mobileCapsLockRef.current = false;
                      setMobileShiftActive(true);
                      setMobileCapsLock(false);
                      mobileShiftOnAtRef.current = now;
                    } else if (mobileCapsLock) {
                      mobileShiftActiveRef.current = false;
                      mobileCapsLockRef.current = false;
                      setMobileShiftActive(false);
                      setMobileCapsLock(false);
                    } else {
                      if (now - mobileShiftOnAtRef.current < 450) {
                        mobileCapsLockRef.current = true;
                        setMobileCapsLock(true);
                      } else {
                        mobileShiftActiveRef.current = false;
                        setMobileShiftActive(false);
                      }
                    }
                    refocusInputSoon();
                  }}
                  onPointerUp={(e) => { e.preventDefault(); e.stopPropagation(); setPressedKey(null); }}
                  onPointerCancel={(e) => { e.preventDefault(); e.stopPropagation(); setPressedKey(null); }}
                  className="bg-gray-200 hover:bg-gray-300 active:bg-gray-400 text-gray-800 font-semibold rounded-lg text-base disabled:opacity-50 touch-manipulation"
                  disabled={!roundStarted || gameOver}
                  style={{ touchAction: 'manipulation', width: '100%', height: '100%', padding: keyPadding, boxSizing: 'border-box', userSelect: 'none', WebkitUserSelect: 'none', WebkitTapHighlightColor: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: specialHeight, height: specialHeight, position: 'relative', zIndex: pressedKey === 'shift' ? 10 : 2, transform: pressedKey === 'shift' ? 'scale(1.3)' : 'scale(1)', transition: 'transform 0.1s ease-out', backgroundColor: pressedKey === 'shift' ? 'rgb(156, 163, 175)' : mobileShiftActive ? 'rgb(156, 163, 175)' : undefined }}
                  title={mobileCapsLock ? 'Caps lock on (tap to turn off)' : mobileShiftActive ? 'Next letter capital (double-tap for caps lock)' : 'Tap for one capital letter; double-tap for caps lock'}
                  aria-label={mobileCapsLock ? 'Caps lock on' : mobileShiftActive ? 'Next letter will be capital' : 'Shift'}
                >
                  <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
                    <span>⇧</span>
                    {mobileCapsLock && <span style={{ width: '1em', borderBottom: '2px solid currentColor', marginTop: '-1px' }} aria-hidden />}
                  </span>
                </button>
              </div>
              {['Z', 'X', 'C', 'V', 'B', 'N', 'M'].map((letter) => {
                const provColors = mobileProvidedLetterColors[letter];
                const provBg = buildKeyGradient(provColors);
                const popBg = (provColors && provColors[0]) || keyBg;
                const popFg = provBg ? '#ffffff' : '#1f2937';
                return (
                <div key={letter} style={{ position: 'relative', width: letterW, height: letterH, flexShrink: 0, overflow: 'visible' }}>
                  <button
                    type="button"
                    onPointerDown={(e) => {
                      e.preventDefault(); e.stopPropagation();
                      setPressedKey(letter);
                      const useCapital = mobileShiftActiveRef.current;
                      handleKeyboardLetter(useCapital ? letter : letter.toLowerCase());
                      if (useCapital && !mobileCapsLockRef.current) { mobileShiftActiveRef.current = false; setMobileShiftActive(false); }
                      refocusInputSoon();
                    }}
                    onPointerUp={(e) => { e.preventDefault(); e.stopPropagation(); setPressedKey(null); }}
                    onPointerCancel={(e) => { e.preventDefault(); e.stopPropagation(); setPressedKey(null); }}
                    className={`font-semibold rounded-lg text-base sm:text-lg transition-colors touch-manipulation ${provBg ? 'text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-800'}`}
                    disabled={!roundStarted || gameOver}
                    style={{
                      touchAction: 'manipulation',
                      width: '100%',
                      height: '100%',
                      padding: keyPadding,
                      boxSizing: 'border-box',
                      userSelect: 'none',
                      WebkitUserSelect: 'none',
                      WebkitTapHighlightColor: 'transparent',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      minHeight: letterH,
                      position: 'relative',
                      zIndex: 2,
                      pointerEvents: 'auto',
                      ...(provBg ? { background: provBg } : {}),
                    }}
                  >
                    {pressedKey === letter ? '' : letter}
                  </button>
                  {pressedKey === letter && (
                    <>
                      <div style={{ position: 'absolute', left: 0, right: 0, bottom: '100%', height: popupGap, backgroundColor: popBg, borderTopLeftRadius: 6, borderTopRightRadius: 6, zIndex: 10 }} />
                      <div style={{ position: 'absolute', left: '50%', marginLeft: -popupW / 2, bottom: `calc(100% + ${popupGap}px)`, width: popupW, height: popupH, backgroundColor: popBg, borderRadius: 8, boxShadow: '0 2px 6px rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2em', fontWeight: 600, color: popFg, zIndex: 10, pointerEvents: 'none' }}>{letter}</div>
                    </>
                  )}
                  </div>
                );
              })}
              <div style={{ position: 'relative', width: specialWidth, height: specialHeight, flexShrink: 0 }}>
                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault(); e.stopPropagation();
                    setPressedKey('backspace');
                    handleKeyboardBackspace();
                    refocusInputSoon();
                    backspaceHoldTimeoutRef.current = setTimeout(() => {
                      backspaceHoldIntervalRef.current = setInterval(() => handleKeyboardBackspace(), 50);
                    }, 300);
                  }}
                  onPointerUp={(e) => {
                    e.preventDefault(); e.stopPropagation(); setPressedKey(null);
                    if (backspaceHoldTimeoutRef.current) { clearTimeout(backspaceHoldTimeoutRef.current); backspaceHoldTimeoutRef.current = null; }
                    if (backspaceHoldIntervalRef.current) { clearInterval(backspaceHoldIntervalRef.current); backspaceHoldIntervalRef.current = null; }
                  }}
                  onPointerCancel={(e) => {
                    e.preventDefault(); e.stopPropagation(); setPressedKey(null);
                    if (backspaceHoldTimeoutRef.current) { clearTimeout(backspaceHoldTimeoutRef.current); backspaceHoldTimeoutRef.current = null; }
                    if (backspaceHoldIntervalRef.current) { clearInterval(backspaceHoldIntervalRef.current); backspaceHoldIntervalRef.current = null; }
                  }}
                  className="bg-gray-200 hover:bg-gray-300 active:bg-gray-400 text-gray-800 font-semibold rounded-lg text-base disabled:opacity-50 touch-manipulation"
                  disabled={!roundStarted || gameOver}
                  style={{ touchAction: 'manipulation', width: '100%', height: '100%', padding: keyPadding, boxSizing: 'border-box', userSelect: 'none', WebkitUserSelect: 'none', WebkitTapHighlightColor: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: specialHeight, height: specialHeight, position: 'relative', zIndex: pressedKey === 'backspace' ? 10 : 2, transform: pressedKey === 'backspace' ? 'scale(1.3)' : 'scale(1)', transition: 'transform 0.1s ease-out', backgroundColor: pressedKey === 'backspace' ? 'rgb(156, 163, 175)' : undefined }}
                >
                  ⌫
                </button>
              </div>
            </div>
            {/* Submit: span from Z to M, same height as keys; only clickable within button */}
            <div className="w-full mt-0.5 flex justify-center">
              <button
                type="button"
                onPointerDown={(e) => {
                  e.preventDefault(); e.stopPropagation();
                  setPressedKey('submit');
                  mobileShiftActiveRef.current = false;
                  mobileCapsLockRef.current = false;
                  setMobileShiftActive(false);
                  setMobileCapsLock(false);
                  const val = (inputRef.current?.value ?? inputValueRef.current ?? input) ?? '';
                  handleSubmit(e, val);
                  refocusInputSoon();
                }}
                onPointerUp={(e) => { e.preventDefault(); e.stopPropagation(); setPressedKey(null); }}
                onPointerCancel={(e) => { e.preventDefault(); e.stopPropagation(); setPressedKey(null); }}
                className="bg-gray-200 hover:bg-gray-300 active:bg-gray-400 text-black rounded-lg text-base font-semibold disabled:opacity-50 touch-manipulation"
                disabled={!roundStarted || gameOver}
                style={{
                  touchAction: 'manipulation',
                  userSelect: 'none',
                  WebkitUserSelect: 'none',
                  WebkitTapHighlightColor: 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  position: 'relative',
                  zIndex: pressedKey === 'submit' ? 10 : 2,
                  transform: pressedKey === 'submit' ? 'scale(1.02)' : 'scale(1)',
                  transition: 'transform 0.1s ease-out',
                  width: submitWidth,
                  height: letterH,
                  minHeight: letterH,
                  backgroundColor: pressedKey === 'submit' ? 'rgb(156, 163, 175)' : undefined,
                }}
              >
                Submit
              </button>
            </div>
          </div>
        </>
        );
              })()}
              
      {roundStarted && gameOver && (
        <>
          <div className={`mb-4 ${showRevealAnimation ? 'reveal-content' : ''}`}>
            <div className="flex justify-center space-x-3 items-center">
              {letters.split('').map((char, idx) => {
                const { shape, color } = shapes[idx];
                const common = {
                  width: `${size}px`,
                  height: `${size}px`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'white',
                  fontSize: '1.95rem',
                  fontWeight: '600',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                  transition: 'all 0.2s ease-in-out'
                };
                const style = shape === 'circle' ? {
                  ...common,
                  backgroundColor: color,
                  borderRadius: '50%',
                  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.2)'
                } : shape === 'diamond' ? {
                  ...common,
                  backgroundColor: color,
                  borderRadius: '12px',
                  transform: 'rotate(45deg) scale(0.85)',
                  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.2)'
                } : {
                  ...common,
                  backgroundColor: color,
                  borderRadius: '12px',
                  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.2)'
                };
                return (
                  <div key={idx} style={style} className="relative">
                    {shape === 'diamond' ? (
                      <span style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '1.75rem',
                        fontWeight: 600,
                        color: 'white',
                        transform: 'rotate(-45deg) scale(1.176)',
                      }}>
                        {char}
                      </span>
                    ) : (
                      <span>{char}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <div className={`text-center ${showRevealAnimation ? 'reveal-content' : ''}`}>
            <div className="flex flex-col items-center">
              <div className="flex flex-wrap justify-center gap-2 max-w-md">
                {validWords.map(({word,length,isValid}, idx) => (
                  <div key={idx} className="rounded-lg px-3 py-1 flex items-center space-x-1" style={{
                    backgroundColor: isValid ? 'rgba(28, 109, 42, 0.15)' : 'rgba(200, 95, 49, 0.15)', 
                    border: isValid ? '1px solid rgba(28, 109, 42, 0.3)' : '1px solid rgba(200, 95, 49, 0.3)'
                  }}>
                    <span className="font-medium" style={{
                      color: isValid ? '#1c6d2a' : '#c85f31',
                      fontSize: 'calc(0.875rem * 0.7 + 6pt * 0.7)'
                    }}>
                      {word === 'unused' ? 'No guess' : (word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())}
                    </span>
                    <span style={{
                      color: isValid ? '#1c6d2a' : '#c85f31',
                      fontSize: 'calc(0.75rem * 0.7 + 6pt * 0.7)'
                    }}>
                      {word === 'unused' ? '(0)' : `(${length})`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          {/* Possible answers — collapsed by default (matches my-app-ver4); lengths shown per answer */}
          <div className={`w-full min-w-0 max-w-md mx-auto text-left ${showRevealAnimation ? 'reveal-content' : ''}`}>
            <details className="group rounded-md border border-gray-200/80 px-3 py-2.5 open:border-gray-200/90 open:bg-white/50 transition-colors">
              <summary
                className="flex cursor-pointer list-none items-center justify-between gap-2 text-left [&::-webkit-details-marker]:hidden"
                style={{ fontSize: 'calc(0.875rem * 0.576 + 6pt * 0.576)' }}
              >
                <span className="font-medium text-gray-500">Possible answers</span>
                <FontAwesomeIcon
                  icon={faChevronDown}
                  className="text-gray-400 text-[10px] shrink-0 transition-transform duration-200 group-open:rotate-180"
                  aria-hidden
                />
              </summary>
              <div className="mt-2.5 border-t border-gray-100/90 pt-2.5">
                <PossibleAnswersFromCsv
                  letters={letters}
                  max={4}
                  puzzleDate={getLocalDateString()}
                  className="justify-start"
                />
              </div>
            </details>
          </div>
          <div className={`flex flex-col items-center space-y-3 ${showRevealAnimation ? 'reveal-content' : ''}`}>
            <a
              href="https://stringlish.com"
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-semibold rounded border border-gray-400 bg-white text-black"
            >
              <FontAwesomeIcon icon={faHouseChimney} className="text-base shrink-0" />
              Home
            </a>
          </div>
        </>
      )}

      {/* Give Up confirmation modal */}
      {showGiveUpConfirm && roundStarted && !gameOver && (
        <div
          className="fixed top-0 left-0 right-0 bottom-0 bg-black bg-opacity-50 flex items-center justify-center z-[10000]"
          style={{ width: '100vw', height: '100vh', margin: 0, padding: 0 }}
        >
          <div className="bg-white rounded-lg w-full max-w-xs sm:max-w-sm md:max-w-md mx-4 sm:mx-6 shadow-xl">
            <div className="p-4 sm:p-6 pb-3 border-b border-gray-200">
              <h2 className="text-lg font-bold text-center">Are You Sure?</h2>
            </div>
            <div className="px-4 sm:px-6 py-4 text-sm text-gray-700 text-center">
              Don&apos;t do something you may regret...dig deep-you got this!
            </div>
            <div className="flex justify-between gap-3 px-4 sm:px-6 pb-4">
              <button
                type="button"
                onClick={() => setShowGiveUpConfirm(false)}
                className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                No, Keep Playing
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowGiveUpConfirm(false);
                  handleEndGame();
                }}
                className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-gray-800"
              >
                Yes, End Game
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Statistics Modal */}
      {(showStats || statsModalClosing) && (
        <div
          className="fixed top-0 left-0 right-0 bottom-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]"
          style={{
            width: '100vw',
            height: '100vh',
            margin: 0,
            padding: 0,
            opacity: statsModalAnim.overlayOpacity,
            transition: statsModalAnim.transitionEnabled
              ? `opacity ${ICON_MODAL_ANIM_MS}ms ease-out`
              : 'none',
          }}
        >
          <div
            ref={statsModalCardRef}
            className="bg-white rounded-lg p-4 sm:p-6 w-full max-w-xs sm:max-w-sm md:max-w-md mx-4 sm:mx-6 max-h-[85vh] sm:max-h-[90vh] overflow-y-auto"
            style={{
              transform: statsModalAnim.cardTransform,
              transformOrigin: 'center center',
              transition: statsModalAnim.transitionEnabled
                ? `transform ${ICON_MODAL_ANIM_MS}ms ease-out`
                : 'none',
            }}
          >
                          {/* Header */}
              <div className="flex justify-between items-center mb-2">
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowClearStatsButton((v) => !v)}
                    className="border-0 bg-transparent p-0.5 -m-0.5 text-gray-600 cursor-default outline-none focus:outline-none focus-visible:outline-none active:outline-none focus:ring-0 ring-0 [-webkit-tap-highlight-color:transparent]"
                    aria-label="Toggle Clear Stats visibility (testing)"
                  >
                    <FontAwesomeIcon icon={faChartSimple} className="text-lg" />
                  </button>
                  Statistics
                </h2>
                <div className="flex items-center space-x-2">
                  {showClearStatsButton && (
                  <button 
                      type="button"
                    onClick={clearStats}
                    className="text-xs text-red-500 hover:text-red-700 px-2 py-1 border border-red-300 rounded"
                  >
                    Clear Stats
                  </button>
                  )}
                  <button
                    type="button"
                    onClick={closeStatsModal}
                    className="text-gray-500 hover:text-gray-700 text-lg sm:text-xl font-bold"
                  >
                    ×
                  </button>
                </div>
              </div>
            
            {/* Game Result Message — only after a finished round / game-over screen (not home or mid-game stats) */}
            {statsShowGameResultBanner &&
              (() => {
                const raw = localStorage.getItem('currentRoundMistakes_v2_4guess');
                const roundScore = parseInt(
                  localStorage.getItem('currentRoundScore_v2_4guess') || '0',
                  10
                );
                let message = null;
                let leftEmoji = '';
                let rightEmoji = '';
                let className = 'text-lg font-semibold';
                if (roundScore === 0) {
                  message = 'Better Luck Next Time!';
                  leftEmoji = rightEmoji = '🍀';
                  className += ' text-gray-600';
                } else if (roundScore <= 9) {
                  message = 'Getting There!';
                  leftEmoji = rightEmoji = '😏';
                  className += ' text-green-700';
                } else if (roundScore <= 19) {
                  message = 'Nicely Done!';
                  leftEmoji = rightEmoji = '😊';
                  className += ' text-green-700';
                } else if (roundScore <= 29) {
                  message = 'Great Job!';
                  leftEmoji = rightEmoji = '🤩';
                  className += ' text-green-700';
                } else if (roundScore <= 39) {
                  message = 'Stupendous!';
                  leftEmoji = rightEmoji = '😍';
                  className += ' text-green-700';
                } else {
                  message = 'Perfect!';
                  leftEmoji = '🥳';
                  rightEmoji = '🎉';
                  className += ' text-green-700';
                }
                const winScores = Array.isArray(stats.winScores) ? stats.winScores : [];
                const showTrend = roundScore > 0 && winScores.length >= 2;
                const prevScores = winScores.slice(0, -1);
                const avgScore = showTrend
                  ? Math.round(prevScores.reduce((s, n) => s + n, 0) / prevScores.length)
                  : 0;
                const scoreDiff = showTrend ? Math.abs(roundScore - avgScore) : 0;
                const scoreHigher = showTrend ? roundScore >= avgScore : false;
                return (
                  <div className="text-center mb-4 p-4 bg-gray-50 rounded-lg">
                    <div className={`flex flex-wrap justify-center items-center gap-2 ${className}`}>
                      <span className="text-xl leading-none" aria-hidden>{leftEmoji}</span>
                      <span>{message}</span>
                      <span className="text-xl leading-none" aria-hidden>{rightEmoji}</span>
                    </div>
                    <p className="mt-2 text-base font-semibold text-center mb-1">
                      <span className="text-gray-600">Final Score:</span>{' '}
                      <span className="tabular-nums" style={{ color: '#1c6d2a' }}>
                        {Number.isFinite(roundScore) ? roundScore : 0}
                      </span>
                    </p>
                    {showTrend && (
                      <p className="text-sm text-center text-gray-600">
                        <span className="font-medium">
                          {scoreDiff} {scoreHigher ? 'higher' : 'lower'}
                        </span>{' '}
                        than average
                      </p>
                    )}
                  </div>
                );
              })()}
            
            {/* Stats Grid */}
            <div className="grid grid-cols-4 gap-2 mb-3">
              <div className="text-center">
                <div className="text-xl sm:text-2xl font-bold">{stats.gamesPlayed}</div>
                <div className="text-xs text-gray-600 leading-tight">
                  <span className="block">Games Played</span>
                </div>
              </div>
              <div className="text-center">
                <div className="text-xl sm:text-2xl font-bold">
                  {stats.gamesPlayed > 0 ? Math.round((stats.gamesWon / stats.gamesPlayed) * 100) : 0}
                </div>
                <div className="text-xs text-gray-600">Win %</div>
              </div>
              <div className="text-center">
                <div className="text-xl sm:text-2xl font-bold">{stats.currentStreak}</div>
                <div className="text-xs text-gray-600 leading-tight">
                  <span className="block">Current</span>
                  <span className="block">Streak</span>
                </div>
              </div>
              <div className="text-center">
                <div className="text-xl sm:text-2xl font-bold">{stats.maxStreak || 0}</div>
                <div className="text-xs text-gray-600 leading-tight">
                  <span className="block">Max</span>
                  <span className="block">Streak</span>
                </div>
              </div>
            </div>
            
            {/* Score Distribution */}
            <div className="mb-3 sm:mb-6">
              <h3 className="text-sm font-semibold mb-2 flex justify-center items-center gap-1.5">
                Score Distribution
              </h3>
              <div className="grid grid-cols-[max-content_1fr] gap-x-2.5 gap-y-1 items-center">
                {(() => {
                  const sd =
                    Array.isArray(stats.scoreDistribution) && stats.scoreDistribution.length === 5
                      ? stats.scoreDistribution.map((n) => Math.max(0, Math.floor(Number(n) || 0)))
                      : [0, 0, 0, 0, 0];
                  let lastB = NaN;
                  try {
                    const raw = localStorage.getItem('currentRoundScoreBucket_v2_4guess');
                    if (raw != null) lastB = parseInt(raw, 10);
                  } catch (_) {}
                  const maxC = Math.max(...sd, 1);
                  return SCORE_DISTRIBUTION_TIERS.map(({ emoji, label }, idx) => {
                    const count = sd[idx] || 0;
                    const isHighlight = !Number.isNaN(lastB) && lastB === idx;
                    const barWidth = count > 0 ? (count / maxC) * 100 : 10;
                    return (
                      <React.Fragment key={idx}>
                        <div className="flex items-center gap-1 justify-end">
                          {emoji ? (
                            <span className="text-xl leading-none select-none" aria-hidden>{emoji}</span>
                          ) : (
                            <span className="w-6 shrink-0" />
                          )}
                          <div className="text-right leading-none">
                            <div className="text-xs font-medium text-gray-400 whitespace-nowrap">{label}</div>
                          </div>
                        </div>
                        <div className="min-w-0 bg-gray-300 rounded-full h-5 relative overflow-hidden">
                          {count > 0 && (
                            <div
                              className={`absolute left-0 top-0 h-full rounded-r-full ${isHighlight ? 'bg-green-600' : 'bg-gray-500'}`}
                              style={{
                                width: `${barWidth}%`,
                                backgroundColor: isHighlight ? '#1c6d2a' : undefined,
                              }}
                            />
                          )}
                          <span className="absolute right-2 top-0 bottom-0 flex items-center text-xs font-medium text-white">{count}</span>
                        </div>
                      </React.Fragment>
                    );
                  });
                })()}
              </div>
            </div>
            
            {/* Longest Words */}
            <div className="mb-3 mt-4">
              <h3 className="text-sm font-semibold mb-2 text-center">
                Longest Words
              </h3>
              <div className="flex gap-4">
                {[[1, 2], [3, 4]].map((pair, colIdx) => (
                  <div key={colIdx} className="flex-1 space-y-0.5">
                    {pair.map((position) => {
                      const longestWord = stats.longestWords && stats.longestWords[position - 1];
                      const currentRoundWords = JSON.parse(localStorage.getItem('currentRoundLongestWords_v2_4guess') || '[]');
                      const isCurrentRound = longestWord && currentRoundWords.some(word =>
                        word.word === longestWord.word && word.length === longestWord.length
                      );
                      return (
                        <div key={position} className="flex items-center gap-1 min-w-0 leading-tight">
                          <span className="text-xs text-gray-400 tabular-nums shrink-0">{position}.</span>
                          <span
                            className={`text-xs min-w-0 leading-tight ${isCurrentRound ? 'font-semibold' : 'text-gray-700'}`}
                            style={{ color: isCurrentRound ? '#1c6d2a' : undefined }}
                          >
                            {longestWord ? `${longestWord.word.charAt(0).toUpperCase() + longestWord.word.slice(1).toLowerCase()} (${longestWord.length})` : '—'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>

            {/* Share button - same green as gameplay square (#1c6d2a) */}
            <div className="mt-4 pt-3 border-t border-gray-200">
              <button
                type="button"
                onClick={async () => {
                  const d = new Date();
                  const month = d.toLocaleDateString('en-US', { month: 'long' });
                  const day = d.getDate();
                  const year = d.getFullYear();
                  const score = localStorage.getItem('currentRoundScore_v2_4guess') || '0';
                  const text = `Stringlish 🔮 4-Guess\nScore: ${score}\n${month} ${day}, ${year}\nSee if you can beat me at:\nhttps://stringlish.com/`;
                  if (typeof navigator.share === 'function') {
                    try {
                      await navigator.share({ text });
                    } catch (err) {
                      if (err.name !== 'AbortError') {
                        try {
                          await navigator.clipboard.writeText(text);
                        } catch (_) {}
                      }
                    }
                  } else {
                    try {
                      await navigator.clipboard.writeText(text);
                    } catch (_) {}
                  }
                }}
                className="w-full py-3 px-4 rounded-lg font-semibold text-white flex items-center justify-center gap-2"
                style={{ backgroundColor: '#1c6d2a' }}
              >
                Share <span className="ml-2"><FontAwesomeIcon icon={faShareNodes} /></span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rules Modal — 3-step wizard */}
      {(showRules || rulesModalClosing) && (
        <div
          className="fixed top-0 left-0 right-0 bottom-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]"
          style={{
            width: '100vw',
            height: '100vh',
            margin: 0,
            padding: 0,
            opacity: rulesModalAnim.overlayOpacity,
            transition: rulesModalAnim.transitionEnabled
              ? `opacity ${ICON_MODAL_ANIM_MS}ms ease-out`
              : 'none',
          }}
        >
          <div
            ref={rulesModalCardRef}
            className="bg-white rounded-lg w-full max-w-xs sm:max-w-sm md:max-w-md mx-4 sm:mx-6 flex flex-col max-h-[min(90vh,90dvh)] overflow-hidden shadow-xl"
            style={{
              transform: rulesModalAnim.cardTransform,
              transformOrigin: 'center center',
              transition: rulesModalAnim.transitionEnabled
                ? `transform ${ICON_MODAL_ANIM_MS}ms ease-out`
                : 'none',
            }}
          >
            {/* Sticky header — close (×) on final step only */}
            <div className="flex items-center justify-between flex-shrink-0 p-4 sm:p-6 pb-3 border-b border-gray-200 bg-white z-10 gap-2">
              <h2 className="text-lg font-bold text-left flex items-center gap-2 flex-1 min-w-0">
                <FontAwesomeIcon icon={faCircleQuestion} className="text-gray-600 flex-shrink-0" />
                How to Play
              </h2>
              {rulesWizardStep === 2 && (
              <button 
                  type="button"
                  onClick={closeRulesModal}
                  className="flex-shrink-0 text-gray-500 hover:text-gray-700 text-lg sm:text-xl font-bold leading-none p-1 -mr-1"
                  aria-label="Close"
              >
                ×
              </button>
              )}
            </div>
            {/* Scrollable step body — swipe left/right on mobile to change steps */}
            <div
              className="flex-1 min-h-0 overflow-y-auto text-left touch-pan-y"
              style={{ touchAction: isMobile ? 'pan-y' : undefined }}
              onTouchStart={handleRulesWizardTouchStart}
              onTouchEnd={handleRulesWizardTouchEnd}
            >
              <div
                key={rulesWizardStep}
                className={`px-4 sm:px-6 py-4 rules-wizard-slide-${rulesWizardSlideDir} text-base text-gray-800 leading-relaxed`}
              >
              {rulesWizardStep === 0 && (
                <div>
                  <RulesWizardLinShapes />
                  <ul className="list-none space-y-4 pl-0">
                    <li className="flex gap-2 items-start">
                      <span className="flex-shrink-0 select-none leading-snug" aria-hidden>🧠</span>
                      <span>Create words using 3 provided letters</span>
                    </li>
                    <li className="flex gap-2 items-start">
                      <span className="flex-shrink-0 select-none leading-snug" aria-hidden>🔤</span>
                      <span>Keep them in the same order shown</span>
                    </li>
                    <li className="flex gap-2 items-start">
                      <span className="flex-shrink-0 select-none leading-snug" aria-hidden>🤹</span>
                      <span>Add extra letters before, after, or between</span>
                    </li>
                  </ul>
                </div>
              )}
              {rulesWizardStep === 1 && (
                <div>
                  <RulesWizardLinShapes />
                  <div className="mb-2 text-sm text-gray-500 italic">Example guesses</div>
                  <RulesExampleGuess valid label="Valid">
                    <span>P</span>
                    <div style={{ width: 24, height: 24, background: '#c85f31', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 600, fontSize: '0.95rem', boxShadow: '0 1px 3px rgba(0,0,0,0.10)' }}>L</div>
                    <span>A</span>
                    <span>C</span>
                    <div style={{ width: 24, height: 24, background: '#195b7c', borderRadius: 6, transform: 'rotate(45deg) scale(0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 600, fontSize: '0.95rem', boxShadow: '0 1px 3px rgba(0,0,0,0.10)' }}>
                      <span style={{ transform: 'rotate(-45deg) scale(1.176)', display: 'inline-block', width: '100%', textAlign: 'center' }}>I</span>
                    </div>
                    <div style={{ width: 24, height: 24, background: '#1c6d2a', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 600, fontSize: '0.95rem', boxShadow: '0 1px 3px rgba(0,0,0,0.10)' }}>N</div>
                    <span>G</span>
                  </RulesExampleGuess>
                  <RulesExampleGuess valid={false} label="Invalid (provided letters not in order)">
                    <div style={{ width: 24, height: 24, background: '#1c6d2a', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 600, fontSize: '0.95rem', boxShadow: '0 1px 3px rgba(0,0,0,0.10)' }}>N</div>
                    <span>A</span>
                    <div style={{ width: 24, height: 24, background: '#195b7c', borderRadius: 6, transform: 'rotate(45deg) scale(0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 600, fontSize: '0.95rem', boxShadow: '0 1px 3px rgba(0,0,0,0.10)' }}>
                      <span style={{ transform: 'rotate(-45deg) scale(1.176)', display: 'inline-block', width: '100%', textAlign: 'center' }}>I</span>
                    </div>
                    <div style={{ width: 24, height: 24, background: '#c85f31', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 600, fontSize: '0.95rem', boxShadow: '0 1px 3px rgba(0,0,0,0.10)' }}>L</div>
                    <span>S</span>
                  </RulesExampleGuess>
                  <RulesExampleGuess valid label="Valid">
                    <div style={{ width: 24, height: 24, background: '#c85f31', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 600, fontSize: '0.95rem', boxShadow: '0 1px 3px rgba(0,0,0,0.10)' }}>L</div>
                    <div style={{ width: 24, height: 24, background: '#195b7c', borderRadius: 6, transform: 'rotate(45deg) scale(0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 600, fontSize: '0.95rem', boxShadow: '0 1px 3px rgba(0,0,0,0.10)' }}>
                      <span style={{ transform: 'rotate(-45deg) scale(1.176)', display: 'inline-block', width: '100%', textAlign: 'center' }}>I</span>
                    </div>
                    <div style={{ width: 24, height: 24, background: '#1c6d2a', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 600, fontSize: '0.95rem', boxShadow: '0 1px 3px rgba(0,0,0,0.10)' }}>N</div>
                    <span>K</span>
                    <span>S</span>
                  </RulesExampleGuess>
                </div>
              )}
              {rulesWizardStep === 2 && (
                <ul className="list-none space-y-4 pl-0">
                  <li className="flex gap-2 items-start">
                    <span className="flex-shrink-0 select-none leading-snug" aria-hidden>🔮</span>
                    <span>{GUESSES_PER_DAY} guesses per game</span>
                  </li>
                  <li className="flex gap-2 items-start">
                    <span className="flex-shrink-0 select-none leading-snug" aria-hidden>🔥</span>
                    <span>+1 point per letter</span>
                  </li>
                  <li className="flex gap-2 items-start">
                    <span className="flex-shrink-0 select-none leading-snug" aria-hidden>🤬</span>
                    <span>Proper nouns and cuss words do not count</span>
                  </li>
                  <li className="flex gap-2 items-start">
                    <span className="flex-shrink-0 select-none leading-snug" aria-hidden>🎉</span>
                    <span className="font-medium">Guess at least 1 valid word to win!</span>
                  </li>
                </ul>
              )}
              </div>
            </div>
            {/* Progress dots + step actions */}
            <div className="flex-shrink-0 border-t border-gray-200 bg-white">
              <div className="flex justify-center items-center gap-2 py-3 px-4" role="tablist" aria-label="How to play steps">
                {[0, 1, 2].map((i) => (
                  <button
                    key={i}
                    type="button"
                    role="tab"
                    aria-selected={rulesWizardStep === i}
                    aria-label={`Step ${i + 1} of 3`}
                    onClick={() => setRulesWizardStep(i)}
                    className={`rounded-full transition-all focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-gray-400 ${
                      rulesWizardStep === i ? 'w-2.5 h-2.5 bg-gray-800' : 'w-2 h-2 bg-gray-300 hover:bg-gray-400'
                    }`}
                  />
                ))}
              </div>
              <div className="flex justify-between gap-3 px-4 pb-4">
                <button
                  type="button"
                  onClick={() => setRulesWizardStep((s) => Math.max(0, s - 1))}
                  disabled={rulesWizardStep === 0}
                  className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50"
                >
                  Back
                </button>
                {rulesWizardStep < 2 ? (
                  <button
                    type="button"
                    onClick={() => setRulesWizardStep((s) => Math.min(2, s + 1))}
                    className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-gray-800"
                  >
                    Next
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={closeRulesModal}
                    className="px-5 py-2.5 rounded-lg bg-gray-900 text-white text-base font-medium hover:bg-gray-800"
                  >
                    Let&apos;s Go!
                  </button>
                )}
              </div>
              {rulesWizardStep === 2 && (
                <div className="border-t border-gray-200 p-4 sm:p-6 pt-3 bg-gray-50/80">
                  <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={showRulesOnStart}
                      onChange={toggleShowRulesOnStart}
                      className="w-4 h-4 rounded border-gray-300"
                    />
                    Show Rules on Game Start
                  </label>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
    </div>

      <style>{`
        @keyframes float-up {0%{opacity:1;transform:translate(-50%,0)}100%{opacity:0;transform:translate(-50%,-40px)}}
        .animate-float-up{animation:float-up 1.5s ease-out}
        
        @keyframes reveal-from-top {
          0% {
            opacity: 0;
            transform: translateY(-30px);
          }
          100% {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        .reveal-content {
          animation: reveal-from-top 0.5s ease-out forwards;
        }
        
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes modal-fade-in {
          0% {
            opacity: 0;
          }
          100% {
            opacity: 1;
          }
        }
        
        .modal-fade-in {
          animation: modal-fade-in 0.2s ease-out forwards;
        }
        
        @keyframes modal-fade-out {
          0% { opacity: 1; }
          100% { opacity: 0; }
        }
        .modal-fade-out {
          animation: modal-fade-out 0.2s ease-out forwards;
        }

        @keyframes rulesWizardSlideInNext {
          from {
            opacity: 0.65;
            transform: translateX(22px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
        @keyframes rulesWizardSlideInPrev {
          from {
            opacity: 0.65;
            transform: translateX(-22px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
        .rules-wizard-slide-next {
          animation: rulesWizardSlideInNext 0.32s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;
        }
        .rules-wizard-slide-prev {
          animation: rulesWizardSlideInPrev 0.32s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;
        }
        
        @keyframes dotDisappear {
          0% {
            transform: scale(1);
            opacity: 1;
          }
          50% {
            transform: scale(1.5);
            opacity: 0.8;
          }
          100% {
            transform: scale(0);
            opacity: 0;
          }
        }
        
        @keyframes hintReveal {
          0% { transform: scale(1); }
          50% { transform: scale(1.2); }
          100% { transform: scale(1); }
        }
        .hint-reveal-anim {
          animation: hintReveal 0.3s ease-out;
        }
        @keyframes hintReadyPop {
          0% { transform: scale(1); }
          50% { transform: scale(1.1); }
          100% { transform: scale(1); }
        }
        .hint-ready-pop {
          animation: hintReadyPop 0.2s ease-out;
        }
        @keyframes scorePop {
          0% {
            transform: scale(1);
            color: #374151;
          }
          50% {
            transform: scale(1.08);
            color: #1c6d2a;
          }
          100% {
            transform: scale(1);
            color: #374151;
          }
        }
        .score-pop {
          animation: scorePop 0.22s ease-out;
        }
        @keyframes currentGuessFade {
          0% { background-color: rgba(0,0,0,0.06); border-color: rgba(0,0,0,0.12); }
          100% { background-color: rgba(0,0,0,0.18); border-color: rgba(0,0,0,0.35); }
        }
        .current-guess-dot {
          animation: currentGuessFade 0.35s ease-out forwards;
        }
        @keyframes guessPopoverExpand {
          from {
            opacity: 0;
            transform: scale(0.94) translateY(-6px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
        .guess-popover-panel {
          animation: guessPopoverExpand 0.22s cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }
      `}</style>
      
      {/* Contact — same shell as Rules modal: sticky header / scroll body / sticky footer; version line only in mailto body */}
      {(showContactModal || contactModalClosing) && (
        <div
          className={`fixed top-0 left-0 right-0 bottom-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] ${contactModalClosing ? 'modal-fade-out' : 'modal-fade-in'}`}
          style={{ width: '100vw', height: '100vh', margin: 0, padding: 0 }}
          onClick={closeContactModal}
          role="presentation"
        >
          <div
            className="bg-white rounded-lg w-full max-w-xs sm:max-w-sm md:max-w-md mx-4 sm:mx-6 flex flex-col max-h-[min(90vh,90dvh)] overflow-hidden shadow-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-labelledby="contact-modal-title"
            aria-modal="true"
          >
            <div className="flex items-center justify-between flex-shrink-0 p-4 sm:p-6 pb-3 border-b border-gray-200 bg-white z-10">
              <h2 id="contact-modal-title" className="text-lg font-bold text-left flex items-center gap-2">
                <FontAwesomeIcon
                  icon={contactModalMode === 'bug' ? faBug : faEnvelope}
                  className="text-gray-600"
                  aria-hidden
                />
                {contactModalMode === 'bug' ? 'Report a Bug' : 'Contact'}
              </h2>
              <button
                type="button"
                onClick={closeContactModal}
                className="text-gray-500 hover:text-gray-700 text-lg sm:text-xl font-bold leading-none p-1 -mr-1 -mt-1"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto text-left px-4 sm:px-6 py-4 space-y-4">
              <div>
                <label htmlFor="contact-email" className="block text-sm font-medium text-gray-700 mb-1">
                  Your email
                </label>
                <input
                  id="contact-email"
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  placeholder="you@example.com"
                  autoComplete="email"
                />
              </div>
              <div>
                <label htmlFor="contact-subject" className="block text-sm font-medium text-gray-700 mb-1">
                  Subject
                </label>
                <input
                  id="contact-subject"
                  type="text"
                  value={contactSubject}
                  onChange={(e) => setContactSubject(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  placeholder="What is this about?"
                />
              </div>
              <div>
                <label htmlFor="contact-message" className="block text-sm font-medium text-gray-700 mb-1">
                  Message
                </label>
                <textarea
                  id="contact-message"
                  value={contactMessage}
                  onChange={(e) => setContactMessage(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm min-h-[140px] resize-y"
                  placeholder="Your message…"
                />
              </div>
            </div>
            <div className="flex-shrink-0 border-t border-gray-200 bg-white p-4 sm:px-6 flex flex-row justify-between items-center gap-3 w-full">
              <button
                type="button"
                onClick={closeContactModal}
                className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSendContact}
                disabled={!contactMessage.trim()}
                className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}

      {footerBarVisible && (
        <footer
          className="text-center flex flex-col items-center gap-1.5 fixed bottom-0 left-0 right-0 z-[15] bg-white border-t border-gray-200 pt-2 pb-[max(8px,env(safe-area-inset-bottom,0px))]"
        >
          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1">
            <button
              type="button"
              onClick={() => {
                setContactModalMode('contact');
                setContactModalClosing(false);
                setShowContactModal(true);
              }}
              className="text-sm text-gray-500 hover:text-gray-700 underline underline-offset-2"
            >
              Contact
            </button>
            <button
              type="button"
              onClick={() => {
                setContactModalMode('bug');
                setContactModalClosing(false);
                setShowContactModal(true);
              }}
              className="text-sm text-gray-500 hover:text-gray-700 underline underline-offset-2"
            >
              Report a Bug
            </button>
          </div>
          <p className="text-gray-500 italic text-sm leading-tight">© 2026 Davis English. All Rights Reserved.</p>
        </footer>
      )}
    </div>
  );
}
