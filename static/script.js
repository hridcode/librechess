let engine = typeof STOCKFISH === "function" ? STOCKFISH() : new Worker('/static/stockfish-19-single.js');
//let evaler = typeof STOCKFISH === "function" ? STOCKFISH() : new Worker('/static/stockfish-19-single.js');

const board = new Chessboard('main-board', {
    'position': 'start',
    'pieceTheme': '/static/pieces/{piece}.png'
});

let game = new Chess();

const pgn = `[Event "GM Daniel Naroditsky Memorial 2026"]
[Site "https://lichess.org/game/TUROxKrM"]
[Date "2026.11.09"]
[Round "-"]
[White "hrid_chess"]
[Black "blighty-almighty"]
[Result "1-0"]
[GameId "TUROxKrM"]
[UTCDate "2026.11.09"]
[UTCTime "22:47:02"]
[WhiteElo "1323"]
[BlackElo "1651"]
[WhiteRatingDiff "+10"]
[BlackRatingDiff "-9"]
[letiant "Standard"]
[TimeControl "60+0"]
[ECO "B23"]
[Opening "Sicilian Defense: Closed"]
[Termination "Normal"]

1. e4 c5 2. Nc3 e6 3. d3 a6 4. Be3 Qc7 5. Nf3 Nc6 6. g3 Bd6 7. Qe2 b5 8. O-O-O Bb7 9. Nb1 Rc8 10. c4 Ne5 11. Nxe5 Bxe5 12. cxb5 c4 13. dxc4 axb5 14. Qc2 Ba6 15. Bd2 Nf6 16. Bd3 O-O 17. cxb5 Bxb2+ 18. Kxb2 Qe5+ 19. Bc3 Rxc3 20. Qxc3 Qxc3+ 21. Kxc3 Bb7 22. Kc2 d5 23. exd5 Nxd5 24. Bc4 Nb4+ 25. Kc3 Nd5+ 26. Bxd5 Bxd5 27. Kd4 Rc8 28. Kd3 Rc4 29. Rc1 Rxc1 30. Rxc1 1-0
`;

game.load_pgn(pgn);

let evaluations = [];

let evaluation = {
    'bestMove': {
        'move': '',
        'scoreType': 'numerical',
        'scoreValue': 0
    },
    'bestMove2': {
        'move': '',
        'scoreType': 'numerical',
        'scoreValue': 0
    },
};

engine.onmessage = function(event) {
    let line = event.data;
    //let match = line.match(/^bestmove ([a-h][1-8])([a-h][1-8])([qrbn])? ponder ([a-h][1-8])([a-h][1-8])([qrbn])?/);
    let match = line.match(/^info depth (\d+) .*\bmultipv (\d+) \bscore (\w+) (-?\d+) .*\bnps (\d+) .*\bpv (\w+) /);
    if (match) {
        //console.log(line);
        let depth = parseInt(match[1]);
        let multipv = parseInt(match[2]);
        let score = parseInt(match[4]);
        let nps = parseInt(match[5]);
        let move = match[6];

        if (depth !== 12) {
            return;
        }

        let moveDict = multipv === 1 ? evaluation.bestMove : evaluation.bestMove2;
        moveDict.move = move;

        if (match[3] == 'cp') {
            moveDict.scoreType = 'numerical';
            moveDict.scoreValue = score / 100.0;
        } else {
            moveDict.scoreType = 'mate';
            moveDict.scoreValue = score;
        }
    }
    //console.log(event.data);
}

function uciCmd(cmd, which) {
    (engine || which).postMessage(cmd);
}

uciCmd('uci');
uciCmd('setoption name MultiPV value 2');

function getMoves() {
    let moves = '';
    let history = game.history({verbose: true});
    
    for (let i = 0; i < history.length; ++i) {
        let move = history[i];
        moves += ' ' + move.from + move.to + (move.promotion ? move.promotion : '');
    }
    
    return moves;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function evaluatePosition(setup, depth = 12) {
    evaluation = {
        'bestMove': {
            'move': '',
            'scoreType': 'numerical',
            'scoreValue': 0
        },
        'bestMove2': {
            'move': '',
            'scoreType': 'numerical',
            'scoreValue': 0
        },
    };
    if (setup.moves) {
        uciCmd('position startpos moves' + setup.moves);
    } else if (setup.fen) {
        uciCmd('position fen ' + setup.fen);
    }
    uciCmd('go depth ' + depth);
    while (!evaluation.bestMove.move && !evaluation.bestMove2.move) {
        await sleep(10);
    }
    evaluations.push(evaluation);
    return evaluations.slice(-1)[0];
}

async function evaluateGame(moves) {
    let testGame = new Chess();

    evaluations = [];

    let moveList = moves.split(' ').filter(x => x);
    let results = [];

    let parseMove = (move) => [move.slice(0, 2), move.slice(2)];

    for (let moveIndex in moveList) {
        let moveMade = moveIndex === 0 ? "" : moveList[moveIndex - 1];
        
        if (moveMade) {
            let [moveFrom, moveTo] = parseMove(moveMade);
            testGame.move({
                from: moveFrom,
                to: moveTo
            });
        }
        let move = await evaluatePosition({fen: testGame.fen()});
        move.played = moveList[moveIndex];
        move.bestMove.scoreValue *= (moveIndex % 2 === 0) ? 1 : -1;
        move.bestMove2.scoreValue *= (moveIndex % 2 === 0) ? 1 : -1;
        
        let [moveFrom, moveTo] = parseMove(move.played);
        testGame.move({
            from: moveFrom,
            to: moveTo
        });
        let nextMove = await evaluatePosition({fen: testGame.fen()});
        move.evaluation = nextMove.bestMove.scoreType === "mate" ? Math.sign(nextMove.bestMove.scoreValue) * Infinity: (nextMove.bestMove.scoreValue *= (moveIndex % 2 === 0) ? 1 : -1);
        testGame.undo();

        results.push(move);
    }

    return results;
}

function winPercentage(score) {
    return Math.abs(score) === Infinity ? 0.5 + 0.5 * Math.sign(score) : 1 / (1 + Math.pow(Math.E, -0.3 * score));
}

async function gradeGame(moves) {
    let gameEvaluation = await evaluateGame(moves);
    let moveResults = [];
    for (let moveIndex in gameEvaluation) {
        let move = gameEvaluation[moveIndex];
        let lastMove = moveIndex === 0 ? null : gameEvaluation[moveIndex - 1];

        let newMove = {
            'move': '',
            'category': 0,
            'best': ''
        };

        `
        Categories:
        - 0: Blunder
        - 1: Mistake
        - 2: Inaccuracy
        - 3: Good
        - 4: Excellent
        - 5: Best
        - 6: Great
        - 7: Brilliant
        - 8: Miss
        `

        //console.log(move);

        newMove.move = move.played;
        newMove.best = move.bestMove.move;

        let percentageChange = Math.max(0, winPercentage(lastMove ? lastMove.evaluation : 0.5) - winPercentage(move.evaluation));
        
        if (percentageChange === 0) {
            newMove.category = 5;
        } else if (percentageChange > 0 && percentageChange <= 0.02) {
            newMove.category = 4;
        } else if (percentageChange > 0.02 && percentageChange <= 0.05) {
            newMove.category = 3;
        } else if (percentageChange > 0.05 && percentageChange <= 0.1) {
            newMove.category = 2;
        } else if (percentageChange > 0.1 && percentageChange <= 0.2) {
            newMove.category = 1;
        } else if (percentageChange > 0.2 && percentageChange <= 1) {
            newMove.category = 0;
        }

        moveResults.push(newMove);
    }

    return moveResults;
}

console.log(gradeGame(getMoves()));