// Required dependencies: react, @fortawesome/react-fontawesome, @fortawesome/free-solid-svg-icons
// Tailwind CSS is used for styling (optional, or replace with your own CSS)
// Drop this file into your React project and import/use <WordPuzzleGame />
import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCircleInfo, faChartSimple, faCheckCircle, faTimesCircle, faCircleQuestion, faHouseChimney, faList, faShareNodes } from '@fortawesome/free-solid-svg-icons';
import words from 'an-array-of-english-words';

const GUESSES_PER_DAY = 5;

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

async function getRandomLetters() {
  const data = await loadTripletsData();
  if (!data || data.length === 0) {
    return 'THE'; // only if CSV failed to load or is empty; letters still conceptually from CSV column B
  }
  const filteredData = data.filter(item => item.frequency >= 10);
  const pool = filteredData.length > 0 ? filteredData : data;
  const selected = pool[Math.floor(Math.random() * pool.length)];
  return selected.letters;
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

async function isValidWord(word) {
  // Reject hyphenated words
  if (word.includes('-')) return false;
  
  // Reject swear words and inappropriate content
  const swearWords = [
    'fuck', 'shit', 'bitch', 'ass', 'damn', 'hell', 'crap', 'piss', 'cock', 'dick', 'pussy', 'cunt',
    'fucking', 'shitting', 'bitching', 'asshole', 'damned', 'hellish', 'crappy', 'pissing',
    'fucker', 'shitty', 'bitchy', 'asshat', 'damnit', 'hellfire', 'crapper', 'pisser',
    'motherfucker', 'bullshit', 'horseshit', 'dumbass', 'jackass', 'smartass', 'badass',
    'fuckin', 'shitty', 'bitchin', 'asswipe', 'damnit', 'hellish', 'crappy', 'pissy'
  ];
  
  const lowerWord = word.toLowerCase();
  if (swearWords.includes(lowerWord)) return false;
  
  try {
    const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${word}`);
    if (!response.ok) return false;
    const data = await response.json();
    return Array.isArray(data) && data[0]?.word?.toLowerCase() === word.toLowerCase();
  } catch {
    return false;
  }
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

// Get single possible answer for hint system (from CSV when available)
async function getOnePossibleAnswer(letters) {
  const answers = await getPossibleAnswersFromCsv(letters, 20);
  if (!answers || answers.length === 0) return null;
  return answers[Math.floor(Math.random() * answers.length)];
}

// Get possible answers from CSV columns C-L for the chosen triplet (for game over display and hint source).
// Triplets always come from the CSV (getRandomLetters), so the row always exists and has answers.
async function getPossibleAnswersFromCsv(letters, max = 5) {
  const data = await loadTripletsData();
  if (!data || !letters || letters.length !== 3) return [];
  const normalized = letters.toUpperCase();
  const entry = data.find(item => item.letters === normalized);
  if (!entry || !entry.answers || entry.answers.length === 0) return [];
  const list = entry.answers.filter(a => a && a.trim());
  const shuffled = [...list].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(max, shuffled.length));
}

// Component to display possible answers from CSV (game over). ensureIncluded (hint word) is always
// shown first and counts toward max, so the hint always appears in the list.
function PossibleAnswersFromCsv({ letters, max = 5, ensureIncluded }) {
  const [answers, setAnswers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      const result = await getPossibleAnswersFromCsv(letters, max + 5); // get extra so we have enough after reserving for hint
      if (!isMounted) return;
      const normalized = (w) => (w || '').trim().toUpperCase();
      let rest = (result || []).map(normalized).filter(Boolean);
      const included = ensureIncluded && typeof ensureIncluded === 'string' ? normalized(ensureIncluded) : null;
      let display;
      if (included) {
        rest = rest.filter((w) => w !== included);
        display = [included, ...rest].slice(0, max);
      } else {
        display = rest.slice(0, max);
      }
      setAnswers(display);
      setLoading(false);
    })();
    return () => { isMounted = false; };
  }, [letters, max, ensureIncluded]);

  if (loading) return <div className="text-xs text-gray-400">Loading...</div>;
  if (answers.length === 0) return <div className="text-xs text-gray-400">No answers found</div>;
  const toTitleCase = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  return (
    <div className="text-xs text-gray-700">
      {answers.map(toTitleCase).join(', ')}
    </div>
  );
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
  const [letterPopup, setLetterPopup] = useState(null);
  const [showRevealAnimation, setShowRevealAnimation] = useState(false);
  const [revealAnimationPlayedThisRound, setRevealAnimationPlayedThisRound] = useState(false);
  const [showAllWords, setShowAllWords] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [stats, setStats] = useState({
    gamesPlayed: 0,
    gamesWon: 0,
    currentStreak: 0,
    maxStreak: 0,
    highestScores: [],
    mistakes: [0, 0, 0, 0, 0, 0], // Count of games with 0, 1, 2, 3, 4, 5 mistakes
    longestWords: [] // Array of {word, length} objects, sorted by length descending
  });
  const [showRules, setShowRules] = useState(false);
  const [rulesModalClosing, setRulesModalClosing] = useState(false);
  const [statsModalClosing, setStatsModalClosing] = useState(false);
  const [showRulesOnStart, setShowRulesOnStart] = useState(() => {
    try {
      const stored = localStorage.getItem('sequenceGameV2_5guessShowRulesOnStart');
      return stored !== 'false';
    } catch (_) {
      return true;
    }
  });
  const rulesDismissedOnceRef = useRef(false);
  const hintTimerStartedThisRoundRef = useRef(false);
  const [hintWord, setHintWord] = useState(null);
  const [hintRevealAnimating, setHintRevealAnimating] = useState(false);
  const [hintAvailable, setHintAvailable] = useState(false);
  const [hintFillProgress, setHintFillProgress] = useState(0);
  const [hintReadyPop, setHintReadyPop] = useState(false);
  const [needsScrollForKeyboard, setNeedsScrollForKeyboard] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 375));
  const [pressedKey, setPressedKey] = useState(null);
  const [mobileShiftActive, setMobileShiftActive] = useState(false);
  const [mobileCapsLock, setMobileCapsLock] = useState(false);
  const [showMobileGuessList, setShowMobileGuessList] = useState(false);
  const mobileShiftOnAtRef = useRef(0);
  const mobileShiftActiveRef = useRef(false);
  const mobileCapsLockRef = useRef(false);
  const mobileGuessListSnapshotRef = useRef([]); // snapshot when opening to avoid re-render loops
  const hintUnlockTimeoutRef = useRef(null);
  const hintFillIntervalRef = useRef(null);
  const inputRef = useRef(null);
  const inputValueRef = useRef('');
  const handleKeyboardLetterRef = useRef(null);
  const inputContainerRef = useRef(null);
  const inputMeasureRef = useRef(null);
  const contentAboveKeyboardRef = useRef(null);
  const lastKeyPressRef = useRef({ key: null, time: 0 });
  const backspaceHoldTimeoutRef = useRef(null);
  const backspaceHoldIntervalRef = useRef(null);
  const isSubmittingRef = useRef(false);
  const KEYBOARD_BOTTOM_OFFSET = 10;
  const KEYBOARD_HEIGHT_ESTIMATE = 280;
  const KEYBOARD_GAP_MIN = 0;

  useEffect(() => {
    (async () => {
      setLetters(await getRandomLetters());
    })();
    // Load stats from localStorage - version specific
    const savedStats = localStorage.getItem('sequenceGameStats_v2_5guess');
    if (savedStats) {
      setStats(JSON.parse(savedStats));
    }
    
    // Detect mobile/tablet (show virtual keyboard for phones and tablets) and track viewport for keyboard scaling
    const checkMobile = () => {
      const w = window.innerWidth;
      setIsMobile(w <= 1024);
      setViewportWidth(w);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    if (!roundStarted) return;
    if (guessesRemaining <= 0 && !manuallyEnded) {
      // Add delay to allow final dot animation to complete
      setTimeout(() => {
        setGameOver(true);
        // Update stats when game ends
        updateStats();
        // Show stats modal automatically after a brief delay
        setTimeout(() => setShowStats(true), 500);
      }, 600); // Slightly longer than the dot animation duration
    }
  }, [guessesRemaining, roundStarted, manuallyEnded]);

  // When mobile + keyboard shown: allow scroll if content would overlap keyboard (debounced to avoid re-render loops)
  useEffect(() => {
    if (!isMobile || !roundStarted || gameOver) {
      setNeedsScrollForKeyboard(false);
      return;
    }
    let rafId = null;
    let timeoutId = null;
    const lastValueRef = { current: null };
    const checkOverlap = () => {
      const el = contentAboveKeyboardRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const contentBottom = rect.bottom;
      const keyboardTop = window.innerHeight - KEYBOARD_BOTTOM_OFFSET - KEYBOARD_HEIGHT_ESTIMATE;
      const threshold = keyboardTop - KEYBOARD_GAP_MIN;
      const next = contentBottom > threshold;
      if (lastValueRef.current !== next) {
        lastValueRef.current = next;
        setNeedsScrollForKeyboard(next);
      }
    };
    const scheduleCheck = () => {
      if (rafId != null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = null;
        ensureObserver();
        checkOverlap();
      });
    };
    const debouncedCheck = () => {
      if (timeoutId != null) clearTimeout(timeoutId);
      timeoutId = setTimeout(scheduleCheck, 80);
    };
    let ro;
    const roCb = () => { debouncedCheck(); };
    const ensureObserver = () => {
      if (!ro && contentAboveKeyboardRef.current) {
        ro = new ResizeObserver(roCb);
        ro.observe(contentAboveKeyboardRef.current);
      }
    };
    scheduleCheck();
    timeoutId = setTimeout(() => { ensureObserver(); scheduleCheck(); }, 100);
    window.addEventListener('resize', debouncedCheck);
    return () => {
      if (rafId != null) cancelAnimationFrame(rafId);
      if (timeoutId != null) clearTimeout(timeoutId);
      if (ro) ro.disconnect();
      window.removeEventListener('resize', debouncedCheck);
    };
  }, [isMobile, roundStarted, gameOver]);

  // Keep inputValueRef in sync with input state so mobile Submit has source of truth
  useEffect(() => {
    inputValueRef.current = input;
  }, [input]);

  // Close mobile guess list when round/game state changes
  useEffect(() => {
    if (gameOver || !roundStarted) setShowMobileGuessList(false);
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

  const handleBegin = () => {
    setShowRevealAnimation(true);
    setRevealAnimationPlayedThisRound(false);
    // Start the game after the reveal animation completes
    setTimeout(() => {
      rulesDismissedOnceRef.current = false;
      setRoundStarted(true);
      if (showRulesOnStart) {
        setShowRules(true);
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
      localStorage.setItem('sequenceGameV2_5guessShowRulesOnStart', String(next));
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
      if (validWords.some(v => v.word === word)) { setError(true); setErrorMessage('Already guessed'); setInput(''); inputValueRef.current = ''; return; }

      if (!isSequential(word, letters)) {
        setError(true);
        setErrorMessage(`Word must contain '${letters}' in order`);
        setValidWords(prev => [...prev, { word, length: 'x', bonusTime: 0, isValid: false }]);
        setInput(''); inputValueRef.current = '';
        setGuessesRemaining(prev => prev - 1);
        return;
      }
      if (!(await isValidWord(word))) {
        setError(true);
        setErrorMessage('Not a valid English word');
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
    const tempStats = { ...stats };
    
    // Ensure all required properties exist
    tempStats.gamesPlayed = tempStats.gamesPlayed || 0;
    tempStats.gamesWon = tempStats.gamesWon || 0;
    tempStats.currentStreak = tempStats.currentStreak || 0;
    tempStats.maxStreak = tempStats.maxStreak || 0;
    tempStats.highestScores = tempStats.highestScores || [];
    tempStats.mistakes = tempStats.mistakes || [0, 0, 0, 0, 0, 0];
    tempStats.longestWords = tempStats.longestWords || [];
    
    // Update games played (any round counts)
    tempStats.gamesPlayed += 1;
    
    // Update games won (if player found at least 1 valid word)
    const validWordCount = newValidWords.filter(word => word.isValid).length;
    const hasWon = validWordCount > 0;
    if (hasWon) {
      tempStats.gamesWon += 1;
    }
    
    // Update streak (count rounds with at least 1 valid word)
    if (validWordCount > 0) {
      tempStats.currentStreak += 1;
      // Update max streak if current streak is higher
      if (tempStats.currentStreak > tempStats.maxStreak) {
        tempStats.maxStreak = tempStats.currentStreak;
      }
    } else {
      tempStats.currentStreak = 0;
    }
    
    // Update highest scores
    if (score > 0) {
      tempStats.highestScores.push(score);
      tempStats.highestScores.sort((a, b) => b - a);
      tempStats.highestScores = tempStats.highestScores.slice(0, 5);
    }
    
    // Update mistakes count (including unused guesses from early game ending)
    const invalidCount = newValidWords.filter(word => !word.isValid).length;
    if (tempStats.mistakes[invalidCount] !== undefined) {
      tempStats.mistakes[invalidCount]++;
    }
    
    // Store the current round's mistake count for highlighting
    localStorage.setItem('currentRoundMistakes_v2_5guess', invalidCount.toString());
    
    // Update longest words
    const validWordsThisRound = newValidWords.filter(word => word.isValid);
    validWordsThisRound.forEach(({word, length}) => {
      // Check if this exact word already exists to avoid duplicates
      const wordExists = tempStats.longestWords.some(item => item.word === word);
      if (!wordExists) {
        // Add the new word
        tempStats.longestWords.push({ word, length });
      }
    });
    
    // Sort by length descending, then by recency (newer words first for same length)
    tempStats.longestWords.sort((a, b) => {
      if (b.length !== a.length) {
        return b.length - a.length; // Sort by length first
      }
      // For same length, newer words (added later) should appear first
      return -1;
    });
    tempStats.longestWords = tempStats.longestWords.slice(0, 5);
    
    // Store the current round's score for highlighting
    localStorage.setItem('currentRoundScore_v2_5guess', score.toString());
    
    // Store the current round's longest words for highlighting
    localStorage.setItem('currentRoundLongestWords_v2_5guess', JSON.stringify(validWordsThisRound));
    
    setStats(tempStats);
    localStorage.setItem('sequenceGameStats_v2_5guess', JSON.stringify(tempStats));
    
    // Show stats modal automatically after a brief delay
    setTimeout(() => setShowStats(true), 500);
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
    const word = await getOnePossibleAnswer(letters);
    if (!word) return;
    const hintVal = word.slice(0, 3).toLowerCase();
    setHintWord(word);
    inputValueRef.current = hintVal;
    setInput(hintVal);
    setError(false);
    setErrorMessage('');
    setHintRevealAnimating(true);
    setTimeout(() => setHintRevealAnimating(false), 300);
  };

  const resetGame = () => {
    // If game was started but not finished, reset streak to 0
    if (roundStarted && !gameOver) {
          const newStats = { ...stats };
    newStats.currentStreak = 0;
    setStats(newStats);
    localStorage.setItem('sequenceGameStats_v2_5guess', JSON.stringify(newStats));
    }
    
    setRoundStarted(false);
    setShowRevealAnimation(false);
    setShowAllWords(false);
    setShowStats(false);
    setShowInstructions(false);
    (async () => setLetters(await getRandomLetters()))();
    setInput(''); inputValueRef.current = ''; setValidWords([]); setScore(0);
    setError(false); setErrorMessage(''); setGuessesRemaining(GUESSES_PER_DAY);
    setGameOver(false); setLetterPopup(null); setManuallyEnded(false);
    setHintWord(null);
    setHintAvailable(false);
    setHintFillProgress(0);
    setHintReadyPop(false);
    clearHintTimers();
  };

  const updateStats = () => {
    const newStats = { ...stats };
    
    // Ensure all required properties exist
    newStats.gamesPlayed = newStats.gamesPlayed || 0;
    newStats.gamesWon = newStats.gamesWon || 0;
    newStats.currentStreak = newStats.currentStreak || 0;
    newStats.maxStreak = newStats.maxStreak || 0;
    newStats.highestScores = newStats.highestScores || [];
    newStats.mistakes = newStats.mistakes || [0, 0, 0, 0, 0, 0];
    newStats.longestWords = newStats.longestWords || [];
    
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
      
      // Update streak (count rounds with at least 1 valid word)
      if (validWordCount > 0) {
        newStats.currentStreak += 1;
        // Update max streak if current streak is higher
        if (newStats.currentStreak > newStats.maxStreak) {
          newStats.maxStreak = newStats.currentStreak;
        }
      } else {
        newStats.currentStreak = 0;
      }
    }
    
    // Always update performance stats
    // Update highest scores
    if (score > 0) {
      newStats.highestScores.push(score);
      newStats.highestScores.sort((a, b) => b - a);
      newStats.highestScores = newStats.highestScores.slice(0, 5);
    }
    
    // Update mistakes count
    const invalidCount = validWords.filter(word => !word.isValid).length;
    if (newStats.mistakes[invalidCount] !== undefined) {
      newStats.mistakes[invalidCount]++;
    }
    
    // Store the current round's mistake count for highlighting
    localStorage.setItem('currentRoundMistakes_v2_5guess', invalidCount.toString());
    
    // Update longest words
    const validWordsThisRound = validWords.filter(word => word.isValid);
    validWordsThisRound.forEach(({word, length}) => {
      // Check if this exact word already exists to avoid duplicates
      const wordExists = newStats.longestWords.some(item => item.word === word);
      if (!wordExists) {
        // Add the new word
        newStats.longestWords.push({ word, length });
      }
    });
    
    // Sort by length descending, then by recency (newer words first for same length)
    newStats.longestWords.sort((a, b) => {
      if (b.length !== a.length) {
        return b.length - a.length; // Sort by length first
      }
      // For same length, newer words (added later) should appear first
      return -1;
    });
    newStats.longestWords = newStats.longestWords.slice(0, 5);
    
    // Store the current round's score for highlighting
    localStorage.setItem('currentRoundScore_v2_5guess', score.toString());
    
    // Store the current round's longest words for highlighting
    localStorage.setItem('currentRoundLongestWords_v2_5guess', JSON.stringify(validWordsThisRound));
    
    setStats(newStats);
    localStorage.setItem('sequenceGameStats_v2_5guess', JSON.stringify(newStats));
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
    localStorage.removeItem('sequenceGameStats_v2_5guess');
    localStorage.removeItem('currentRoundScore_v2_5guess');
    localStorage.removeItem('currentRoundMistakes_v2_5guess');
    localStorage.removeItem('currentRoundLongestWords_v2_5guess');
    
    // Reset stats to initial state
    setStats({
      gamesPlayed: 0,
      gamesWon: 0,
      currentStreak: 0,
      maxStreak: 0,
      highestScores: [],
      mistakes: [0, 0, 0, 0, 0, 0],
      longestWords: []
    });
  };

  const shapes = [
    { shape: 'circle', color: '#c85f31' },
    { shape: 'diamond', color: '#195b7c' },
    { shape: 'square', color: '#1c6d2a' }
  ];
  const size = 80;

  return (
    <div className={isMobile ? (needsScrollForKeyboard ? "min-h-[100dvh] flex flex-col" : "h-[100dvh] max-h-[100dvh] flex flex-col overflow-hidden") : ""}>
      <div className={isMobile ? `flex-1 min-h-0 ${needsScrollForKeyboard ? "overflow-y-auto pb-[5px]" : "overflow-hidden pb-[320px]"}` : ""}>
    <div className="p-6 max-w-xl mx-auto text-center space-y-6 relative overflow-hidden">
      <div className="flex justify-center items-center relative flex-col">
        {!roundStarted && (
          <>
            <a 
              href="https://davisenglish.github.io/sequence-game-home/"
              className="block hover:opacity-80 transition-opacity"
            >
              <img 
                src={process.env.PUBLIC_URL + "/letter-game-logo2.png"} 
                alt="Sequence Game Logo" 
                className="w-24 h-24 mb-4 object-contain"
                onError={(e) => {
                  e.target.style.display = 'none';
                }}
              />
            </a>
            <h1 className="text-3xl font-bold">Sequence</h1>
          </>
        )}
        {!roundStarted && (
          <p className="text-gray-500 italic mt-4 text-center">
            Make words.<br />
            Tickle your brain.
          </p>
        )}
        {roundStarted && (
          <div className="flex items-center w-full">
            <div className="flex-1 min-w-0" />
            <div className="flex items-center justify-center flex-shrink-0 space-x-3">
              <a 
                href="https://davisenglish.github.io/sequence-game-home/"
                className="text-gray-600 hover:text-gray-800 transition-colors"
                title="Home"
              >
                <FontAwesomeIcon icon={faHouseChimney} className="text-lg" />
              </a>
              <button 
                onClick={() => setShowStats(true)}
                className="text-gray-600 hover:text-gray-800 transition-colors"
                title="Statistics"
              >
                <FontAwesomeIcon icon={faChartSimple} className="text-lg" />
              </button>
              <button 
                onClick={() => setShowRules(true)}
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
                  onClick={handleEndGame}
                  className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
                >
                  Give Up?
                </button>
              )}
            </div>
          </div>
        )}
        {roundStarted && (
          <>
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
        <button onClick={handleBegin} className="bg-white border border-gray-400 text-black w-52 h-16 text-xl font-semibold rounded">BEGIN : 5-GUESS</button>
          <div className="flex flex-row items-center space-x-4">
            <a 
              href="https://davisenglish.github.io/sequence-game-home/"
              className="text-gray-600 hover:text-gray-800 transition-colors"
              title="Home"
            >
              <FontAwesomeIcon icon={faHouseChimney} className="text-lg" />
            </a>
            <button onClick={() => setShowStats(true)} className="text-gray-600 hover:text-gray-800 transition-colors" title="Statistics">
              <FontAwesomeIcon icon={faChartSimple} className="text-lg" />
            </button>
            <button onClick={() => setShowRules(true)} className="text-gray-500 hover:text-gray-700 transition-colors" title="Rules">
              <FontAwesomeIcon icon={faCircleQuestion} className="text-xl" />
            </button>
          </div>
        </div>
      ) : (gameOver || showRules) ? null : (
        <div className={`space-y-4 ${showRevealAnimation && !revealAnimationPlayedThisRound ? 'reveal-content' : ''}`}>
          {/* Provided letters */}
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
              fontSize:'1.75rem', 
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
              <div key={idx} style={style} className="hover:scale-105 transition-transform duration-200 relative">
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
          {/* Score */}
          <div className="mt-1">
            <div className="relative inline-block font-bold text-center">
              <div className="text-lg leading-tight">
                Score: {score}
              </div>
              {letterPopup && (
                <span className="absolute inset-0 flex items-center justify-center text-green-600 font-bold animate-float-up" style={{fontSize:'12pt'}}>{letterPopup}</span>
              )}
            </div>
          </div>
          {/* Input section */}
          <div ref={contentAboveKeyboardRef} className="space-y-4">
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
                {/* Player's guesses - dots + list + Hint (just below text entry) */}
                <div className="flex flex-col items-center">
                  <div className="flex justify-center items-center gap-2 sm:gap-3 w-full max-w-xs">
                    <div className="flex justify-center gap-2 sm:gap-3">
                      {[0, 1, 2, 3, 4].map((idx) => {
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
                      onClick={() => {
                        mobileGuessListSnapshotRef.current = validWords.slice(0, 5);
                        setShowMobileGuessList(true);
                      }}
                      className="flex-shrink-0 p-1 flex items-center justify-center text-gray-600 hover:text-gray-800 active:text-gray-900"
                      aria-label="Show guessed words"
                    >
                      <FontAwesomeIcon icon={faList} className="text-lg" />
                    </button>
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
                          className="absolute inset-0 w-full h-full pointer-events-none rounded-[inherit]"
                          viewBox="0 0 100 100"
                          preserveAspectRatio="none"
                          aria-hidden
                        >
                          <path
                            d="M 50 2 L 84 2 A 14 14 0 0 1 98 16 L 98 84 A 14 14 0 0 1 84 98 L 16 98 A 14 14 0 0 1 2 84 L 2 16 A 14 14 0 0 1 16 2 L 50 2"
                            fill="none"
                            stroke="#1c6d2a"
                            strokeWidth="5"
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
                      className="fixed inset-0 z-[100]"
                      style={{ top: 0, left: 0, right: 0, bottom: 0 }}
                      onClick={() => setShowMobileGuessList(false)}
                      aria-hidden
                    >
                      <div
                        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg shadow-lg border border-gray-200 p-4 max-w-[90vw] max-h-[70vh] overflow-y-auto"
                        onClick={(e) => e.stopPropagation()}
                        onTouchStart={(e) => e.stopPropagation()}
                      >
                        <div className="text-sm font-semibold text-gray-700 mb-2">Your Guesses</div>
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

      {/* Virtual Keyboard - only on mobile; always fixed at bottom of screen; scales to viewport with 8px edge margin */}
      {isMobile && roundStarted && !gameOver && !showRules && (() => {
        const edgeMargin = 8;
        const keyBaseWidth = 35;
        const gapBase = 8;
        const keyCountTopRow = 10;
        const gapCountTopRow = keyCountTopRow - 1;
        const availableWidth = Math.max(0, viewportWidth - 2 * edgeMargin);
        const designRowWidth = keyCountTopRow * keyBaseWidth + gapCountTopRow * gapBase; // 422

        // First compute scale assuming gaps scale linearly with keys
        let scale = availableWidth / designRowWidth;
        let gapPx = gapBase * scale;

        const gapMax = 10;
        const gapMin = 4;

        // If the scaled gap would exceed our desired maximum, recompute scale so that:
        // rowWidth = keyCountTopRow * (keyBaseWidth * scale) + gapCountTopRow * gapMax ~= availableWidth
        if (gapPx > gapMax && keyCountTopRow * keyBaseWidth > 0) {
          scale = (availableWidth - gapCountTopRow * gapMax) / (keyCountTopRow * keyBaseWidth);
          gapPx = gapMax;
        }

        // Final clamped / rounded gap
        gapPx = Math.max(gapMin, Math.min(gapMax, Math.round(gapPx)));

        const letterW = Math.round(keyBaseWidth * scale);
        const letterH = Math.min(60, Math.round(45 * scale));

        // Make bottom row (Shift + Z-M + Backspace) span the same usable width
        // as the top row, so Shift/Backspace outer edges are also ~8px from viewport.
        const bottomLettersCount = 7; // Z, X, C, V, B, N, M
        const bottomKeysTotalWidth = bottomLettersCount * letterW;
        const bottomGapCount = bottomLettersCount + 2 - 1; // 7 letters + 2 specials = 9 keys -> 8 gaps
        const bottomGapsTotalWidth = bottomGapCount * gapPx;
        const specialWidth = Math.max(
          0,
          Math.round((availableWidth - bottomKeysTotalWidth - bottomGapsTotalWidth) / 2)
        );
        const submitWidth = bottomKeysTotalWidth + (bottomLettersCount - 1) * gapPx;
        const specialHeight = Math.min(60, Math.round(45 * scale));
        const keyPadding = 4; // 20% less than 5
        const containerPaddingH = 8; // 20% less than 23; matches edge margin
        const containerPaddingB = 8;   // 20% less than 10
        return (
        <>
          <div style={{ marginTop: 15, minHeight: 260 }} aria-hidden />
          <div
            className={isMobile ? "" : "mt-4"}
            style={isMobile
              ? {
                  position: 'fixed',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  padding: `8px ${containerPaddingH}px ${containerPaddingB}px`,
                  borderTop: '1px solid #e5e7eb', // same gray as Rules modal divider
                  backgroundColor: '#ffffff',
                  zIndex: 20,
                }
              : { padding: '0 10px' }}
          >
            {/* Top row: Q-P — letter keys scale with viewport */}
            <div className="flex justify-center relative flex-nowrap" style={{ gap: gapPx, marginBottom: gapPx }}>
              {['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'].map((letter) => (
                <div key={letter} style={{ position: 'relative', width: letterW, height: letterH, flexShrink: 0 }}>
                  <button
                    type="button"
                    onPointerDown={(e) => {
                      e.preventDefault(); e.stopPropagation();
                      setPressedKey(letter);
                      const useCapital = mobileShiftActiveRef.current;
                      handleKeyboardLetter(useCapital ? letter : letter.toLowerCase());
                      if (useCapital && !mobileCapsLockRef.current) {
                        mobileShiftActiveRef.current = false;
                        setMobileShiftActive(false);
                      }
                      refocusInputSoon();
                    }}
                    onPointerUp={(e) => { e.preventDefault(); e.stopPropagation(); setPressedKey(null); }}
                    onPointerCancel={(e) => { e.preventDefault(); e.stopPropagation(); setPressedKey(null); }}
                    className="bg-gray-200 hover:bg-gray-300 active:bg-gray-400 text-gray-800 font-semibold rounded-lg text-base sm:text-lg transition-colors touch-manipulation"
                    disabled={!roundStarted||gameOver}
                    style={{ touchAction: 'manipulation', width: '100%', height: '100%', padding: keyPadding, boxSizing: 'border-box', userSelect: 'none', WebkitUserSelect: 'none', WebkitTapHighlightColor: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: letterH, position: 'relative', zIndex: pressedKey === letter ? 10 : 2, transform: pressedKey === letter ? 'scale(1.3)' : 'scale(1)', transition: 'transform 0.1s ease-out' }}
                  >
                    {letter}
                  </button>
                </div>
              ))}
            </div>
            {/* Middle row: A-L */}
            <div className="flex justify-center relative flex-nowrap" style={{ gap: gapPx, marginBottom: gapPx }}>
              {['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'].map((letter) => (
                <div key={letter} style={{ position: 'relative', width: letterW, height: letterH, flexShrink: 0 }}>
                  <button
                    type="button"
                    onPointerDown={(e) => {
                      e.preventDefault(); e.stopPropagation();
                      setPressedKey(letter);
                      const useCapital = mobileShiftActiveRef.current;
                      handleKeyboardLetter(useCapital ? letter : letter.toLowerCase());
                      if (useCapital && !mobileCapsLockRef.current) {
                        mobileShiftActiveRef.current = false;
                        setMobileShiftActive(false);
                      }
                      refocusInputSoon();
                    }}
                    onPointerUp={(e) => { e.preventDefault(); e.stopPropagation(); setPressedKey(null); }}
                    onPointerCancel={(e) => { e.preventDefault(); e.stopPropagation(); setPressedKey(null); }}
                    className="bg-gray-200 hover:bg-gray-300 active:bg-gray-400 text-gray-800 font-semibold rounded-lg text-base sm:text-lg transition-colors touch-manipulation"
                    disabled={!roundStarted||gameOver}
                    style={{ touchAction: 'manipulation', width: '100%', height: '100%', padding: keyPadding, boxSizing: 'border-box', userSelect: 'none', WebkitUserSelect: 'none', WebkitTapHighlightColor: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: letterH, position: 'relative', zIndex: pressedKey === letter ? 10 : 2, transform: pressedKey === letter ? 'scale(1.3)' : 'scale(1)', transition: 'transform 0.1s ease-out' }}
                  >
                    {letter}
                  </button>
                </div>
              ))}
            </div>
            {/* Bottom row: Shift + Z-M + Backspace */}
            <div className="flex justify-center relative flex-nowrap" style={{ gap: gapPx, marginBottom: gapPx }}>
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
                  disabled={!roundStarted||gameOver}
                  style={{ touchAction: 'manipulation', width: '100%', height: '100%', padding: keyPadding, boxSizing: 'border-box', userSelect: 'none', WebkitUserSelect: 'none', WebkitTapHighlightColor: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: specialHeight, height: specialHeight, position: 'relative', zIndex: pressedKey === 'shift' ? 10 : 2, transform: pressedKey === 'shift' ? 'scale(1.3)' : 'scale(1)', transition: 'transform 0.1s ease-out', backgroundColor: mobileShiftActive ? 'rgb(156, 163, 175)' : undefined }}
                  title={mobileCapsLock ? 'Caps lock on (tap to turn off)' : mobileShiftActive ? 'Next letter capital (double-tap for caps lock)' : 'Tap for one capital letter; double-tap for caps lock'}
                  aria-label={mobileCapsLock ? 'Caps lock on' : mobileShiftActive ? 'Next letter will be capital' : 'Shift'}
                >
                  <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
                    <span>⇧</span>
                    {mobileCapsLock && <span style={{ width: '1em', borderBottom: '2px solid currentColor', marginTop: '-1px' }} aria-hidden />}
                  </span>
                </button>
              </div>
              {['Z', 'X', 'C', 'V', 'B', 'N', 'M'].map((letter) => (
                <div key={letter} style={{ position: 'relative', width: letterW, height: letterH, flexShrink: 0 }}>
                  <button
                    type="button"
                    onPointerDown={(e) => {
                      e.preventDefault(); e.stopPropagation();
                      setPressedKey(letter);
                      const useCapital = mobileShiftActiveRef.current;
                      handleKeyboardLetter(useCapital ? letter : letter.toLowerCase());
                      if (useCapital && !mobileCapsLockRef.current) {
                        mobileShiftActiveRef.current = false;
                        setMobileShiftActive(false);
                      }
                      refocusInputSoon();
                    }}
                    onPointerUp={(e) => { e.preventDefault(); e.stopPropagation(); setPressedKey(null); }}
                    onPointerCancel={(e) => { e.preventDefault(); e.stopPropagation(); setPressedKey(null); }}
                    className="bg-gray-200 hover:bg-gray-300 active:bg-gray-400 text-gray-800 font-semibold rounded-lg text-base sm:text-lg transition-colors touch-manipulation"
                    disabled={!roundStarted||gameOver}
                    style={{ touchAction: 'manipulation', width: '100%', height: '100%', padding: keyPadding, boxSizing: 'border-box', userSelect: 'none', WebkitUserSelect: 'none', WebkitTapHighlightColor: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: letterH, position: 'relative', zIndex: pressedKey === letter ? 10 : 2, transform: pressedKey === letter ? 'scale(1.3)' : 'scale(1)', transition: 'transform 0.1s ease-out' }}
                  >
                    {letter}
                  </button>
                </div>
              ))}
              <div style={{ position: 'relative', width: specialWidth, height: specialHeight, flexShrink: 0 }}>
                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault(); e.stopPropagation(); setPressedKey('backspace'); handleKeyboardBackspace(); refocusInputSoon();
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
                  disabled={!roundStarted||gameOver}
                  style={{ touchAction: 'manipulation', width: '100%', height: '100%', padding: keyPadding, boxSizing: 'border-box', userSelect: 'none', WebkitUserSelect: 'none', WebkitTapHighlightColor: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: specialHeight, height: specialHeight, position: 'relative', zIndex: pressedKey === 'backspace' ? 10 : 2, transform: pressedKey === 'backspace' ? 'scale(1.3)' : 'scale(1)', transition: 'transform 0.1s ease-out' }}
                >
                  ⌫
                </button>
              </div>
            </div>
            {/* Submit: span from Z to M (same width as inner letter keys of bottom row), same height as keys */}
            <div className="w-full mt-0.5 flex justify-center">
              <button
                type="button"
                onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); setPressedKey('submit'); mobileShiftActiveRef.current = false; mobileCapsLockRef.current = false; setMobileShiftActive(false); setMobileCapsLock(false); const val = (inputRef.current?.value ?? inputValueRef.current ?? input) ?? ''; handleSubmit(e, val); refocusInputSoon(); }}
                onPointerUp={(e) => { e.preventDefault(); e.stopPropagation(); setPressedKey(null); }}
                onPointerCancel={(e) => { e.preventDefault(); e.stopPropagation(); setPressedKey(null); }}
                className="text-white rounded-lg text-base font-semibold disabled:opacity-50 touch-manipulation"
                disabled={!roundStarted||gameOver}
                style={{ backgroundColor: '#195b7c', touchAction: 'manipulation', userSelect: 'none', WebkitUserSelect: 'none', WebkitTapHighlightColor: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', zIndex: pressedKey === 'submit' ? 10 : 2, transform: pressedKey === 'submit' ? 'scale(1.02)' : 'scale(1)', transition: 'transform 0.1s ease-out', width: submitWidth, height: letterH, minHeight: letterH }}
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
          <div className={`mt-4 ${showRevealAnimation ? 'reveal-content' : ''}`}>
            <div className="relative inline-block font-bold text-center">
              <div className="text-2xl">
                Final Score: {score}
              </div>
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
                    <span className="font-medium text-sm" style={{color: isValid ? '#1c6d2a' : '#c85f31'}}>
                      {word === 'unused' ? 'No guess' : (word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())}
                    </span>
                    <span className="text-xs" style={{color: isValid ? '#1c6d2a' : '#c85f31'}}>
                      {word === 'unused' ? '(0)' : `(${length})`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          {/* Possible Answers from CSV (columns C-L), with hint word included if used */}
          <div className={`text-center ${showRevealAnimation ? 'reveal-content' : ''}`}>
            <div className="text-xs text-gray-500">
              <div className="font-medium mb-1">Possible Answers:</div>
              <PossibleAnswersFromCsv letters={letters} max={5} ensureIncluded={hintWord} />
            </div>
          </div>
          <div className={`flex flex-col items-center space-y-3 ${showRevealAnimation ? 'reveal-content' : ''}`}>
            <button onClick={resetGame} className="bg-white border border-gray-400 text-black w-52 h-16 text-xl font-semibold rounded">NEW GAME</button>
          </div>
        </>
      )}

      {/* Statistics Modal */}
      {(showStats || statsModalClosing) && (
        <div className={`fixed top-0 left-0 right-0 bottom-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] ${statsModalClosing ? 'modal-fade-out' : 'modal-fade-in'}`} style={{ width: '100vw', height: '100vh', margin: 0, padding: 0 }}>
          <div className="bg-white rounded-lg p-4 sm:p-6 w-full max-w-xs sm:max-w-sm md:max-w-md mx-4 sm:mx-6 max-h-[85vh] sm:max-h-[90vh] overflow-y-auto">
                          {/* Header */}
              <div className="flex justify-between items-center mb-2">
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <FontAwesomeIcon icon={faChartSimple} className="text-gray-600" />
                  Statistics
                </h2>
                <div className="flex items-center space-x-2">
                  <button 
                    onClick={clearStats}
                    className="text-xs text-red-500 hover:text-red-700 px-2 py-1 border border-red-300 rounded"
                  >
                    Clear Stats
                  </button>
                  <button 
                    onClick={() => {
                      setStatsModalClosing(true);
                      setShowStats(false);
                      setTimeout(() => setStatsModalClosing(false), 200);
                    }}
                    className="text-gray-500 hover:text-gray-700 text-lg sm:text-xl font-bold"
                  >
                    ×
                  </button>
              </div>
            </div>
            
            {/* Game Result Message */}
            {(() => {
              const raw = localStorage.getItem('currentRoundMistakes_v2_5guess');
              const currentRoundMistakes = raw != null ? parseInt(raw, 10) : 5;
              const correctCount = Math.min(5, Math.max(0, 5 - currentRoundMistakes));
              let message = null;
              let className = 'text-lg font-semibold';
              if (correctCount === 0) {
                message = 'Better Luck Next Time!';
                className += ' text-gray-600';
              } else if (correctCount <= 2) {
                message = 'Nicely Done!';
                className += ' text-green-700';
              } else if (correctCount <= 4) {
                message = 'Great Job!';
                className += ' text-green-700';
              } else {
                message = 'Perfect!';
                className += ' text-green-700';
              }
              return (
                <div className="text-center mb-4 p-4 bg-gray-50 rounded-lg">
                  <div className={className}>{message}</div>
                </div>
              );
            })()}
            
            {/* Stats Grid */}
            <div className="grid grid-cols-4 gap-2 mb-3">
              <div className="text-center">
                <div className="text-xl sm:text-2xl font-bold">{stats.gamesPlayed}</div>
                <div className="text-xs text-gray-600">Played</div>
              </div>
              <div className="text-center">
                <div className="text-xl sm:text-2xl font-bold">
                  {(stats.mistakes && stats.mistakes[0]) || 0}
                </div>
                <div className="text-xs text-gray-600">Perfect Games</div>
              </div>
              <div className="text-center">
                <div className="text-xl sm:text-2xl font-bold">{stats.currentStreak}</div>
                <div className="text-xs text-gray-600">Streak</div>
              </div>
              <div className="text-center">
                <div className="text-xl sm:text-2xl font-bold">{stats.maxStreak || 0}</div>
                <div className="text-xs text-gray-600">Max Streak</div>
              </div>
            </div>
            
            {/* High Scores */}
            <div className="mb-3">
              <h3 className="text-sm font-semibold mb-1">High Scores</h3>
              <div className="space-y-2">
                {[1, 2, 3, 4, 5].map((position) => {
                  const score = (stats.highestScores && stats.highestScores[position - 1]) || 0;
                  const currentRoundScore = parseInt(localStorage.getItem('currentRoundScore_v2_5guess') || '0');
                  const isCurrentRound = score === currentRoundScore && score > 0;
                  const maxScore = Math.max(...(stats.highestScores || []), 1);
                  const barWidth = score > 0 ? (score / maxScore) * 100 : 10;
                  
                  return (
                    <div key={position} className="flex items-center">
                      <div className="flex-1 bg-gray-300 rounded-full h-3 relative">
                        {score > 0 && (
                          <div 
                            className={`h-3 rounded-full ${isCurrentRound ? 'bg-green-600' : 'bg-gray-500'}`}
                            style={{ 
                              width: `${barWidth}%`,
                              backgroundColor: isCurrentRound ? '#1c6d2a' : undefined
                            }}
                          ></div>
                        )}
                        <span className="absolute right-2 -top-0.5 text-xs font-medium text-white">
                          {score}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            
            {/* Two-column layout for Correct Answers and Longest Words */}
            <div className="grid grid-cols-2 gap-4 mb-3">
              {/* Correct Answers (5–0: games with 5 correct down to 0 correct) */}
              <div>
                <h3 className="text-sm font-semibold mb-1 text-left">Correct Answers</h3>
                <div className="space-y-0.5">
                  {[5, 4, 3, 2, 1, 0].map((correctCount) => {
                    const mistakeCount = 5 - correctCount;
                    const count = (stats.mistakes && stats.mistakes[mistakeCount]) || 0;
                    const currentRoundMistakes = parseInt(localStorage.getItem('currentRoundMistakes_v2_5guess') || '0');
                    const currentRoundCorrect = 5 - currentRoundMistakes;
                    const isCurrentRound = correctCount === currentRoundCorrect;
                    const maxCount = Math.max(...(stats.mistakes || []), 1);
                    const barWidth = count > 0 ? (count / maxCount) * 100 : 10;
                    
                    return (
                      <div key={correctCount} className="flex items-center space-x-3">
                        <span className="text-sm font-medium w-4">{correctCount}</span>
                        <div className="flex-1 bg-gray-300 rounded-full h-3 relative">
                          {count > 0 && (
                            <div 
                              className={`h-3 rounded-full ${isCurrentRound ? 'bg-green-600' : 'bg-gray-500'}`}
                              style={{ 
                                width: `${barWidth}%`,
                                backgroundColor: isCurrentRound ? '#1c6d2a' : undefined
                              }}
                            ></div>
                          )}
                          <span className="absolute right-2 -top-0.5 text-xs font-medium text-white">
                            {count}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              
              {/* Longest Words */}
              <div>
                <h3 className="text-sm font-semibold mb-1 text-left">Longest Words</h3>
                <div className="space-y-0.5">
                  {[1, 2, 3, 4, 5].map((position) => {
                    const longestWord = (stats.longestWords && stats.longestWords[position - 1]);
                    const currentRoundWords = JSON.parse(localStorage.getItem('currentRoundLongestWords_v2_5guess') || '[]');
                    const isCurrentRound = longestWord && currentRoundWords.some(word => 
                      word.word === longestWord.word && word.length === longestWord.length
                    );
                    
                    return (
                      <div key={position} className="flex items-center min-w-0">
                        <span 
                          className={`text-xs min-w-0 ${isCurrentRound ? 'font-semibold' : 'text-gray-700'}`}
                          style={{ color: isCurrentRound ? '#1c6d2a' : undefined }}
                        >
                          {longestWord ? `${longestWord.word.charAt(0).toUpperCase() + longestWord.word.slice(1).toLowerCase()} (${longestWord.length})` : '—'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Share button - same green as gameplay square (#1c6d2a) */}
            <div className="mt-4 pt-3 border-t border-gray-200">
              <button
                type="button"
                onClick={async () => {
                  const d = new Date();
                  const mm = String(d.getMonth() + 1).padStart(2, '0');
                  const dd = String(d.getDate()).padStart(2, '0');
                  const yy = String(d.getFullYear()).slice(-2);
                  const score = localStorage.getItem('currentRoundScore_v2_5guess') || '0';
                  const text = `Stringlish, ${mm}/${dd}/${yy} - Total Score: ${score}. See if you can beat me at https://www.stringlish.com/`;
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

      {/* Rules Modal */}
      {(showRules || rulesModalClosing) && (
        <div className={`fixed top-0 left-0 right-0 bottom-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] ${rulesModalClosing ? 'modal-fade-out' : 'modal-fade-in'}`} style={{ width: '100vw', height: '100vh', margin: 0, padding: 0 }}>
          <div className="bg-white rounded-lg w-full max-w-xs sm:max-w-sm md:max-w-md mx-4 sm:mx-6 flex flex-col max-h-[90vh] overflow-hidden">
            {/* Header - sticky at top */}
            <div className="flex justify-between items-center flex-shrink-0 p-4 sm:p-6 pb-2 border-b border-gray-200">
              <h2 className="text-lg font-bold text-left flex items-center gap-2">
                <FontAwesomeIcon icon={faCircleQuestion} className="text-gray-600" />
                Rules
              </h2>
              <button 
                onClick={() => {
                  rulesDismissedOnceRef.current = true;
                  setRulesModalClosing(true);
                  setShowRules(false);
                  setTimeout(() => {
                    setRulesModalClosing(false);
                    setTimeout(() => setRevealAnimationPlayedThisRound(true), 500);
                    setTimeout(() => inputRef.current?.focus(), 100);
                  }, 200);
                }}
                className="text-gray-500 hover:text-gray-700 text-lg sm:text-xl font-bold"
              >
                ×
              </button>
            </div>
            {/* Scrollable body */}
            <div className="flex-1 min-h-0 overflow-y-auto text-left px-4 sm:px-6 py-2">
            <div className="mb-4 text-base font-medium">Use the provided letters to create words.</div>
            <ul className="mb-3 text-xs list-disc pl-5 space-y-1">
              <li>Provided letters must be used in the order they appear.</li>
              <li>There can be letters before, after and between the provided letters, as long as they remain in order.</li>
              <li>You get 5 guesses per round, but be careful! Incorrect words will cost you a guess.</li>
              <li>+1 point per letter in each word.</li>
              <li>Proper nouns and names are not valid words.</li>
            </ul>
            <div className="mb-1 mt-2 text-base font-semibold">Example</div>
            <div className="mb-1 text-xs font-medium">Provided Letters:</div>
            {/* LIN example, small */}
            <div className="flex space-x-1 mb-2" style={{ transform: 'scale(0.7)', transformOrigin: 'left' }}>
              <div style={{ width: 36, height: 36, background: '#c85f31', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 600, fontSize: '1.25rem', boxShadow: '0 2px 6px rgba(0,0,0,0.12)' }}>L</div>
              <div style={{ width: 36, height: 36, background: '#195b7c', borderRadius: 8, transform: 'rotate(45deg) scale(0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 600, fontSize: '1.25rem', boxShadow: '0 2px 6px rgba(0,0,0,0.12)' }}>
                <span style={{ transform: 'rotate(-45deg) scale(1.176)', display: 'inline-block', width: '100%', textAlign: 'center' }}>I</span>
              </div>
              <div style={{ width: 36, height: 36, background: '#1c6d2a', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 600, fontSize: '1.25rem', boxShadow: '0 2px 6px rgba(0,0,0,0.12)' }}>N</div>
            </div>
            <div className="mb-1 text-xs font-medium">Possible Answers:</div>
            {/* PLAIN example */}
            <div className="flex items-center space-x-1 mb-1">
              <span>P</span>
              <div style={{ width: 24, height: 24, background: '#c85f31', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 600, fontSize: '0.95rem', boxShadow: '0 1px 3px rgba(0,0,0,0.10)' }}>L</div>
              <span>A</span>
              <div style={{ width: 24, height: 24, background: '#195b7c', borderRadius: 6, transform: 'rotate(45deg) scale(0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 600, fontSize: '0.95rem', boxShadow: '0 1px 3px rgba(0,0,0,0.10)' }}>
                <span style={{ transform: 'rotate(-45deg) scale(1.176)', display: 'inline-block', width: '100%', textAlign: 'center' }}>I</span>
              </div>
              <div style={{ width: 24, height: 24, background: '#1c6d2a', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 600, fontSize: '0.95rem', boxShadow: '0 1px 3px rgba(0,0,0,0.10)' }}>N</div>
            </div>
            <div className="flex items-center mb-3 text-xs" style={{ color: '#1c6d2a' }}>
              <FontAwesomeIcon icon={faCheckCircle} className="mr-1" /> Valid word—nonconsecutive provided letters.
            </div>
            {/* LINK example */}
            <div className="flex items-center space-x-1 mb-1">
              <div style={{ width: 24, height: 24, background: '#c85f31', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 600, fontSize: '0.95rem', boxShadow: '0 1px 3px rgba(0,0,0,0.10)' }}>L</div>
              <div style={{ width: 24, height: 24, background: '#195b7c', borderRadius: 6, transform: 'rotate(45deg) scale(0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 600, fontSize: '0.95rem', boxShadow: '0 1px 3px rgba(0,0,0,0.10)' }}>
                <span style={{ transform: 'rotate(-45deg) scale(1.176)', display: 'inline-block', width: '100%', textAlign: 'center' }}>I</span>
              </div>
              <div style={{ width: 24, height: 24, background: '#1c6d2a', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 600, fontSize: '0.95rem', boxShadow: '0 1px 3px rgba(0,0,0,0.10)' }}>N</div>
              <span>K</span>
            </div>
            <div className="flex items-center mb-3 text-xs" style={{ color: '#1c6d2a' }}>
              <FontAwesomeIcon icon={faCheckCircle} className="mr-1" /> Valid word—consecutive provided letters.
            </div>
            {/* NAIL (invalid) example */}
            <div className="flex items-center space-x-1 mb-1">
              <div style={{ width: 24, height: 24, background: '#1c6d2a', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 600, fontSize: '0.95rem', boxShadow: '0 1px 3px rgba(0,0,0,0.10)' }}>N</div>
              <span>A</span>
              <div style={{ width: 24, height: 24, background: '#195b7c', borderRadius: 6, transform: 'rotate(45deg) scale(0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 600, fontSize: '0.95rem', boxShadow: '0 1px 3px rgba(0,0,0,0.10)' }}>
                <span style={{ transform: 'rotate(-45deg) scale(1.176)', display: 'inline-block', width: '100%', textAlign: 'center' }}>I</span>
              </div>
              <div style={{ width: 24, height: 24, background: '#c85f31', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 600, fontSize: '0.95rem', boxShadow: '0 1px 3px rgba(0,0,0,0.10)' }}>L</div>
            </div>
            <div className="flex items-center mb-1 text-xs" style={{ color: '#992108' }}>
              <FontAwesomeIcon icon={faTimesCircle} className="mr-1" /> Invalid word—letters appear out of order from provided letters.
            </div>
            </div>
            {/* Footer - sticky at bottom */}
            <div className="flex-shrink-0 border-t border-gray-200 p-4 sm:p-6 pt-3">
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
        @keyframes currentGuessFade {
          0% { background-color: rgba(0,0,0,0.06); border-color: rgba(0,0,0,0.12); }
          100% { background-color: rgba(0,0,0,0.18); border-color: rgba(0,0,0,0.35); }
        }
        .current-guess-dot {
          animation: currentGuessFade 0.35s ease-out forwards;
        }
      `}</style>
      
      {!(isMobile && roundStarted && !gameOver) && (
        <footer
          className={`text-center ${isMobile ? "" : "py-4 mt-8"}`}
          style={isMobile ? { position: 'fixed', bottom: 0, left: 0, right: 0, paddingTop: 5, paddingBottom: 5, zIndex: 15, background: 'white' } : undefined}
        >
          <p className="text-gray-500 italic text-sm">© 2026 Davis English. All Rights Reserved.</p>
        </footer>
      )}
    </div>
  );
}
