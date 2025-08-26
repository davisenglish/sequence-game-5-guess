// Required dependencies: react, @fortawesome/react-fontawesome, @fortawesome/free-solid-svg-icons
// Tailwind CSS is used for styling (optional, or replace with your own CSS)
// Drop this file into your React project and import/use <WordPuzzleGame />
import React, { useState, useEffect, useRef } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faStopwatch, faCircleInfo, faChartSimple, faCheckCircle, faTimesCircle, faCircleQuestion, faHouseChimney } from '@fortawesome/free-solid-svg-icons';
import words from 'an-array-of-english-words';

const GUESSES_PER_DAY = 5;
const TIME_BONUS_THRESHOLD = 10; // seconds for time bonus

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

async function getRandomLetters() {
  const candidates = PREPROCESSED_WORDS;
  const maxAttempts = 1000;
  // 75% chance to use hard mode
  const hardMode = Math.random() < 0.75;
  const minCount = hardMode ? 3 : 5;
  const minWordLength = hardMode ? 8 : 4;
  const sampleSize = 10000;
  const forbiddenThirdLetters = new Set(['S', 'G', 'D']);

  const filtered = candidates.filter(w => w.length >= minWordLength);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const word = filtered[Math.floor(Math.random() * filtered.length)];
    // Pick three increasing indices
    const idx1 = Math.floor(Math.random() * (word.length - 2));
    const idx2 = idx1 + 1 + Math.floor(Math.random() * (word.length - idx1 - 1));
    const idx3 = idx2 + 1 + Math.floor(Math.random() * (word.length - idx2 - 1));
    if (idx3 >= word.length) continue;
    const seq = word[idx1] + word[idx2] + word[idx3];
    // Enforce third letter restriction
    if (forbiddenThirdLetters.has(seq[2])) continue;
    // Skip if sequence is consecutive in the word
    if (word.includes(seq)) continue;
    // Memoized count of words containing these letters in order
    if (sequenceCountCache[seq]) {
      if (sequenceCountCache[seq] >= minCount) return seq;
      continue;
    }
    // Sample a subset for performance
    const sample = filtered.length > sampleSize
      ? Array.from({length: sampleSize}, () => filtered[Math.floor(Math.random() * filtered.length)])
      : filtered;
    const regex = new RegExp(seq.split('').join('.*'), 'i');
    const count = sample.filter(w => regex.test(w)).length;
    sequenceCountCache[seq] = count;
    if (count >= minCount) {
      return seq;
    }
  }
  // Fallback: random unique letters if no sequence found (should be rare)
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let letters = '';
  while (letters.length < 3) {
    const randomLetter = alphabet[Math.floor(Math.random() * alphabet.length)];
    if (letters.length === 2 && forbiddenThirdLetters.has(randomLetter)) continue;
    if (!letters.includes(randomLetter)) letters += randomLetter;
  }
  return letters;
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

export default function WordPuzzleGame() {
  const [letters, setLetters] = useState('');
  const [roundStarted, setRoundStarted] = useState(false);
  const [input, setInput] = useState('');
  const [validWords, setValidWords] = useState([]); // { word, letters, bonusTime }
  const [error, setError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [guessesRemaining, setGuessesRemaining] = useState(GUESSES_PER_DAY);
  const [gameOver, setGameOver] = useState(false);
  const [manuallyEnded, setManuallyEnded] = useState(false);
  const [score, setScore] = useState(0);
  const [letterPopup, setLetterPopup] = useState(null);
  const [timePopup, setTimePopup] = useState(null);
  const [firstAnswerTime, setFirstAnswerTime] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [showRevealAnimation, setShowRevealAnimation] = useState(false);
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
  const startTimeRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    (async () => {
      setLetters(await getRandomLetters());
    })();
    // Load stats from localStorage
    const savedStats = localStorage.getItem('sequenceGameStats');
    if (savedStats) {
      setStats(JSON.parse(savedStats));
    }
    
    // Detect mobile device
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
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

  // Timer for elapsed time (for time bonus progress bar)
  useEffect(() => {
    if (!roundStarted || gameOver) return;
    const timer = setInterval(() => {
      setElapsed((performance.now() - startTimeRef.current) / 1000);
    }, 100);
    return () => clearInterval(timer);
  }, [roundStarted, gameOver]);

  const handleBegin = () => {
    setShowRevealAnimation(true);
    // Start the game after the reveal animation completes
    setTimeout(() => {
    setRoundStarted(true);
    startTimeRef.current = performance.now();
      // Focus the input field when the game starts
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
        }
      }, 100); // Small delay to ensure the input field is rendered
    }, 500); // Match the animation duration
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!roundStarted || gameOver) return;
    const word = input.trim().toLowerCase();
    if (!word) { setError(true); setErrorMessage('Please enter a word'); return; }
    if (validWords.some(v => v.word === word)) { setError(true); setErrorMessage('Already guessed'); setInput(''); return; }
    
    // Update elapsed time
    const currentElapsed = (performance.now() - startTimeRef.current) / 1000;
    setElapsed(currentElapsed);
    
    if (!isSequential(word, letters)) { 
      setError(true); 
      setErrorMessage(`Word must contain '${letters}' in order`); 
      setValidWords(prev => [...prev, { word, length: 'x', bonusTime: 0, isValid: false }]);
      setInput(''); 
      setGuessesRemaining(prev => prev - 1);
      return; 
    }
    if (!(await isValidWord(word))) { 
      setError(true); 
      setErrorMessage('Not a valid English word'); 
      setValidWords(prev => [...prev, { word, length: 'x', bonusTime: 0, isValid: false }]);
      setInput(''); 
      setGuessesRemaining(prev => prev - 1);
      return; 
    }

    const baseScore = word.length;
    const timeBonus = currentElapsed <= TIME_BONUS_THRESHOLD ? 3 : 0;
    if (firstAnswerTime === null) {
      setFirstAnswerTime(currentElapsed);
    }
    // Store word, its length, and bonusTime for clarity
    setValidWords(prev => [...prev, { word, length: word.length, bonusTime: timeBonus, isValid: true }]);
    setScore(prev => prev + baseScore + timeBonus);
    setLetterPopup(`+${baseScore}`);
    setTimeout(() => setLetterPopup(null), 1500);
    if (timeBonus) {
      setTimePopup(`+${timeBonus}`);
      setTimeout(() => setTimePopup(null), 1500);
    }
    setInput(''); setError(false); setErrorMessage('');
    // Decrease guesses remaining
    setGuessesRemaining(prev => prev - 1);
    
    // Keep focus on the input field
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
      }
    }, 0);
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
    localStorage.setItem('currentRoundMistakes', invalidCount.toString());
    
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
    localStorage.setItem('currentRoundScore', score.toString());
    
    // Store the current round's longest words for highlighting
    localStorage.setItem('currentRoundLongestWords', JSON.stringify(validWordsThisRound));
    
    setStats(tempStats);
    localStorage.setItem('sequenceGameStats', JSON.stringify(tempStats));
    
    // Show stats modal automatically after a brief delay
    setTimeout(() => setShowStats(true), 500);
  };

  const resetGame = () => {
    // If game was started but not finished, reset streak to 0
    if (roundStarted && !gameOver) {
      const newStats = { ...stats };
      newStats.currentStreak = 0;
      setStats(newStats);
      localStorage.setItem('sequenceGameStats', JSON.stringify(newStats));
    }
    
    setRoundStarted(false);
    setShowRevealAnimation(false);
    setShowAllWords(false);
    setShowStats(false);
    setShowInstructions(false);
    (async () => setLetters(await getRandomLetters()))();
    setInput(''); setValidWords([]); setScore(0);
    setError(false); setErrorMessage(''); setGuessesRemaining(GUESSES_PER_DAY);
    setGameOver(false); setLetterPopup(null); setTimePopup(null); setFirstAnswerTime(null); setElapsed(0); setManuallyEnded(false);
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
    localStorage.setItem('currentRoundMistakes', invalidCount.toString());
    
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
    localStorage.setItem('currentRoundScore', score.toString());
    
    // Store the current round's longest words for highlighting
    localStorage.setItem('currentRoundLongestWords', JSON.stringify(validWordsThisRound));
    
    setStats(newStats);
    localStorage.setItem('sequenceGameStats', JSON.stringify(newStats));
  };

  const handleInputChange = (e) => {
    if (!roundStarted || gameOver) return;
    setInput(e.target.value);
    if (error) { setError(false); setErrorMessage(''); }
  };

  const clearStats = () => {
    // Clear all statistical data
    localStorage.removeItem('sequenceGameStats');
    localStorage.removeItem('currentRoundScore');
    localStorage.removeItem('currentRoundMistakes');
    localStorage.removeItem('currentRoundLongestWords');
    
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
    <div className="p-6 max-w-xl mx-auto text-center space-y-6 relative overflow-hidden">
      <div className="flex justify-center items-center relative flex-col">
        {!roundStarted && (
          <>
            <img 
              src={process.env.PUBLIC_URL + "/letter-game-logo2.png"} 
              alt="Sequence Game Logo" 
              className="w-24 h-24 mb-4 object-contain"
              onError={(e) => {
                e.target.style.display = 'none';
              }}
            />
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
          <div className="flex items-center space-x-3">
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
          </div>
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
      ) : (
        <div className={`flex justify-center space-x-3 items-center ${showRevealAnimation ? 'reveal-content' : ''}`}>
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
      )}

      {roundStarted && !gameOver && (
        <div className={`flex items-center justify-center space-x-2 ${showRevealAnimation ? 'reveal-content' : ''}`}>
          <span className="text-sm font-medium text-gray-700">Guesses Remaining:</span>
          <div className="flex space-x-1">
            {[...Array(GUESSES_PER_DAY)].map((_, index) => (
              <div
                key={index}
                className={`w-3 h-3 rounded-full transition-all duration-300 ${
                  index < guessesRemaining 
                    ? 'bg-gray-400' 
                    : 'bg-transparent scale-0'
                }`}
                style={{
                  animation: (index === guessesRemaining && guessesRemaining < GUESSES_PER_DAY) || (index === 0 && guessesRemaining === 0)
                    ? 'dotDisappear 0.5s ease-out' 
                    : 'none'
                }}
              />
            ))}
          </div>
        </div>
      )}

      {roundStarted && (
        <div className={`space-y-4 ${showRevealAnimation ? 'reveal-content' : ''}`}>
          {gameOver ? (
            <div></div>
          ) : (
            <>
              <input 
                ref={inputRef}
                type="text" 
                value={input} 
                onChange={handleInputChange}
                className={`border rounded px-4 py-2 w-full text-lg ${error?'border-red-600 text-red-600':''}`}
                placeholder="Enter word..." 
                disabled={!roundStarted||gameOver}
                onKeyDown={e=>e.key==='Enter'&&handleSubmit(e)} 
              />
              {error&&<p className="text-red-600">{errorMessage}</p>}
              <div className="relative inline-block">
                <button onClick={handleSubmit} style={{backgroundColor:'#195b7c'}} className="text-white px-4 py-2 rounded text-lg disabled:opacity-50" disabled={!roundStarted||gameOver}>Submit</button>
              </div>
            </>
          )}
        </div>
      )}

      {roundStarted && (
        <>
          <div className={`mt-4 ${showRevealAnimation ? 'reveal-content' : ''}`}>
            <div className="relative inline-block font-bold text-center">
              <div className={gameOver ? 'text-2xl' : 'text-lg'}>
                {gameOver ? 'Final Score' : 'Total Score'}: {score}
              </div>
              {letterPopup && (
                <span className="absolute inset-0 flex items-center justify-center text-green-600 font-bold animate-float-up" style={{fontSize:'12pt'}}>{letterPopup}</span>
              )}
            </div>
            {!gameOver && (
              <div className={`text-sm text-gray-600 mt-2 flex justify-center items-center space-x-1 relative transition-all duration-300 ${elapsed > TIME_BONUS_THRESHOLD ? 'h-0 mt-0 opacity-0 overflow-hidden' : 'h-6'}`}>
                {/* Time Bonus Progress Bar */}
                <div className={`absolute left-1/2 transform -translate-x-1/2 w-32 bg-gray-300 rounded-full h-6 opacity-60 transition-opacity duration-300 overflow-hidden ${elapsed > TIME_BONUS_THRESHOLD ? 'opacity-0' : ''}`}>
                  <div 
                    className="h-full transition-all duration-1000 ease-linear rounded-full"
                    style={{
                      backgroundColor: '#c85f31',
                      opacity: 0.6,
                      width: `${Math.max(0, Math.min(100, ((TIME_BONUS_THRESHOLD - elapsed) / TIME_BONUS_THRESHOLD) * 100))}%`
                    }}
                  ></div>
                </div>
                <span className={`relative z-10 transition-opacity duration-300 ${elapsed > TIME_BONUS_THRESHOLD ? 'opacity-0' : ''}`}>Time Bonus</span>
                <FontAwesomeIcon icon={faStopwatch} className={`relative z-10 transition-opacity duration-300 ${elapsed > TIME_BONUS_THRESHOLD ? 'opacity-0' : ''}`} />
                {timePopup && (
                  <span className="absolute flex items-center justify-center text-green-600 font-bold animate-float-up" style={{fontSize:'9pt', marginLeft: '4px'}}>{timePopup}</span>
                )}
              </div>
            )}
            </div>
          <div className={`text-center ${showRevealAnimation ? 'reveal-content' : ''}`}>
            {/* Compact word display - shows last 3 words with total count */}
            <div className="flex flex-col items-center space-y-2">
            {gameOver && firstAnswerTime !== null && (
                <div className="text-sm text-gray-600 mb-2">
                  Fastest Answer: {firstAnswerTime.toFixed(3)}s
                </div>
              )}
              {gameOver && validWords.length === 0 && (() => {
                const possible = findPossibleAnswers(letters);
                return possible.length > 0 ? (
                  <div className="mt-3 flex flex-col items-center">
                    <span className="text-xs text-gray-500">Possible Answers:</span>
                    <span className="text-xs text-gray-500 mt-0.5">{possible.join(', ')}</span>
                  </div>
                ) : null;
              })()}
              
              {/* Show all words in chronological order, building from top-left to bottom-right */}
              <div className="flex flex-wrap justify-center gap-2 max-w-md">
                {validWords.map(({word,length,bonusTime,isValid}, idx) => (
                  <div key={idx} className="rounded-lg px-3 py-1 flex items-center space-x-1" style={{
                    backgroundColor: isValid ? 'rgba(28, 109, 42, 0.15)' : 'rgba(200, 95, 49, 0.15)', 
                    border: isValid ? '1px solid rgba(28, 109, 42, 0.3)' : '1px solid rgba(200, 95, 49, 0.3)'
                  }}>
                    <span className="font-medium text-sm" style={{color: isValid ? '#1c6d2a' : '#c85f31'}}>
                      {word === 'unused' ? 'no guess' : word}
                    </span>
                    <span className="text-xs" style={{color: isValid ? '#1c6d2a' : '#c85f31'}}>
                      {word === 'unused' ? '(0)' : `(${length})`}
                    </span>
                    {bonusTime>0 && isValid && (
                      <span className="flex items-center text-xs font-bold" style={{color: '#1c6d2a'}}>
                        <span>+{bonusTime}</span>
                        <FontAwesomeIcon icon={faStopwatch} className="text-xs" />
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className={`flex flex-col items-center space-y-3 ${showRevealAnimation ? 'reveal-content' : ''}`}>
            {gameOver ? (
              <button onClick={resetGame} className="bg-white border border-gray-400 text-black w-52 h-16 text-xl font-semibold rounded">NEW GAME</button>
            ) : (
              <button onClick={handleEndGame} className="bg-white border border-gray-400 text-black w-52 h-16 text-xl font-semibold rounded">END GAME</button>
            )}
          </div>
        </>
      )}

      {/* Statistics Modal */}
      {showStats && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] modal-fade-in" style={{ top: '-100vh', left: '-100vw', right: '-100vw', bottom: '-100vh', width: '300vw', height: '300vh' }}>
          <div className="bg-white rounded-lg p-3 w-full max-w-xs sm:max-w-sm md:max-w-md mx-4 sm:mx-6 max-h-[75vh] overflow-y-auto">
                          {/* Header */}
              <div className="flex justify-between items-center mb-2">
                <h2 className="text-lg font-bold">Statistics</h2>
                <div className="flex items-center space-x-2">
                  <button 
                    onClick={clearStats}
                    className="text-xs text-red-500 hover:text-red-700 px-2 py-1 border border-red-300 rounded"
                  >
                    Clear Stats
                  </button>
                  <button 
                    onClick={() => setShowStats(false)}
                    className="text-gray-500 hover:text-gray-700 text-lg sm:text-xl font-bold"
                  >
                    ×
                  </button>
                </div>
              </div>
            
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
            
            {/* Highest Scores */}
            <div className="mb-3">
              <h3 className="text-sm font-semibold mb-1">Highest Scores</h3>
              <div className="space-y-0.5">
                {[1, 2, 3, 4, 5].map((position) => {
                  const score = (stats.highestScores && stats.highestScores[position - 1]) || 0;
                  const currentRoundScore = parseInt(localStorage.getItem('currentRoundScore') || '0');
                  const isCurrentRound = score === currentRoundScore && score > 0;
                  const maxScore = Math.max(...(stats.highestScores || []), 1);
                  const barWidth = score > 0 ? (score / maxScore) * 100 : 10;
                  
                  return (
                    <div key={position} className="flex items-center space-x-3">
                      <span className="text-sm font-medium w-4">{position}</span>
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
            
            {/* Two-column layout for Mistakes and Longest Words */}
            <div className="grid grid-cols-2 gap-4 mb-3">
              {/* Mistakes */}
              <div>
                <h3 className="text-sm font-semibold mb-1 text-left">Mistakes</h3>
                <div className="space-y-0.5">
                  {[0, 1, 2, 3, 4, 5].map((mistakeCount) => {
                    const count = (stats.mistakes && stats.mistakes[mistakeCount]) || 0;
                    const currentRoundMistakes = parseInt(localStorage.getItem('currentRoundMistakes') || '0');
                    const isCurrentRound = mistakeCount === currentRoundMistakes;
                    const maxCount = Math.max(...(stats.mistakes || []), 1);
                    const barWidth = count > 0 ? (count / maxCount) * 100 : 10;
                    
                    return (
                      <div key={mistakeCount} className="flex items-center space-x-3">
                        <span className="text-sm font-medium w-4">{mistakeCount}</span>
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
                    const currentRoundWords = JSON.parse(localStorage.getItem('currentRoundLongestWords') || '[]');
                    const isCurrentRound = longestWord && currentRoundWords.some(word => 
                      word.word === longestWord.word && word.length === longestWord.length
                    );
                    
                    return (
                      <div key={position} className="flex items-center space-x-2">
                        <span className="text-sm font-medium w-4">{position}.</span>
                        <span 
                          className={`text-sm ${isCurrentRound ? 'font-semibold' : 'text-gray-700'}`}
                          style={{ color: isCurrentRound ? '#1c6d2a' : undefined }}
                        >
                          {longestWord ? `${longestWord.word} (${longestWord.length})` : '—'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Rules Modal */}
      {showRules && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] modal-fade-in" style={{ top: '-100vh', left: '-100vw', right: '-100vw', bottom: '-100vh', width: '300vw', height: '300vh' }}>
          <div
            className="bg-white rounded-lg p-4 sm:p-6 w-full max-w-xs sm:max-w-sm md:max-w-md mx-4 sm:mx-6"
            style={{
              maxHeight: '90vh',
              overflow: 'visible',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              boxSizing: 'border-box',
              textAlign: 'left',
              // Responsive scaling for mobile
              transform: 'scale(1)',
              ...(window.innerWidth < 400 ? { transform: 'scale(0.92)' } : {}),
              ...(window.innerHeight < 600 ? { maxHeight: '80vh', transform: 'scale(0.92)' } : {}),
            }}
          >
            {/* Header */}
            <div className="flex justify-between items-center mb-4 sm:mb-6">
              <h2 className="text-xl sm:text-2xl font-bold text-left">Rules</h2>
              <button 
                onClick={() => setShowRules(false)}
                className="text-gray-500 hover:text-gray-700 text-lg sm:text-xl font-bold"
              >
                ×
              </button>
            </div>
            <div className="mb-4 text-base font-medium">Use the provided letters to create words.</div>
            <ul className="mb-3 text-sm list-disc pl-5 space-y-1">
              <li>There can be letters before, after and between the provided letters, as long as they remain in order.</li>
              <li>You get 5 guesses per round, but be careful! Incorrect words will cost you a guess.</li>
              <li>+1 point per letter in each word & +3 point time bonus for answers in the first 10 seconds.</li>
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
              <FontAwesomeIcon icon={faCheckCircle} className="mr-1" /> Valid word—nonconsecutive provided letters
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
              <div style={{ width: 24, height: 24, background: '#c85f31', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 600, fontSize: '0.95rem', boxShadow: '0 1px 3px rgba(0,0,0,0.10)' }}>L</div>
            </div>
            <div className="flex items-center mb-1 text-xs" style={{ color: '#992108' }}>
              <FontAwesomeIcon icon={faTimesCircle} className="mr-1" /> Invalid word—letters appear out of order from provided letters.
            </div>
          </div>
        </div>
      )}


      <style>{`
        @keyframes float-up {0%{opacity:1;transform:translate(-50%,0)}100%{opacity:0;transform:translate(-50%,-40px)}}
        .animate-float-up{animation:float-up 1.5s ease-out}
        @keyframes time-shake{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
        .animate-time-shake{animation:time-shake 0.5s infinite}
        
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
      `}</style>
      
      {/* Footer */}
      <footer className="text-center py-4 mt-8">
        <p className="text-gray-500 italic text-sm">© 2025 Davis English. All Rights Reserved.</p>
      </footer>
    </div>
  );
}
