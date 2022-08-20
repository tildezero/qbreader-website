const database = require('./database');
const Player = require('./Player');
const quizbowl = require('./quizbowl');

class Room {
    constructor(name) {
        this.name = name;

        this.players = {};
        this.sockets = {};

        this.buzzTimeout = null;
        this.buzzedIn = false;
        this.paused = false;
        this.questionNumber = 0;
        this.questionProgress = 0; // 0 = not started, 1 = reading, 2 = answer revealed
        this.tossup = {};
        this.wordIndex = 0;
        this.queryingQuestion = false;

        this.query = {
            difficulties: [4, 5], 
            packetNumbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24], 
            setName: '2022 PACE NSC', 
            categories: [], 
            subcategories: []
        };

        this.settings = {
            rebuzz: true,
            public: true,
            readingSpeed: 50,
            selectBySetName: false
        };
    }

    connection(socket, userId, username) {
        console.log(`User with userId ${userId} and username ${username} connected in room ${this.name}`);

        socket.on('message', message => {
            message = JSON.parse(message);
            this.message(message, userId);
        });

        socket.on('close', () => {
            this.sendSocketMessage({
                type: 'give-answer',
                userId: userId,
                username: username,
                givenAnswer: '',
                directive: 'reject',
                score: -5,
                celerity: this.players[userId].celerity.correct.average
            });

            this.message({
                type: 'leave',
                userId: userId,
                username: username
            }, userId);

            this.updateQuestion();
            this.players[userId].updateStats(-5, 0);
        });

        this.sockets[userId] = socket;

        const isNew = !(userId in this.players);
        if (isNew) {
            this.createPlayer(userId);
        }
        this.players[userId].updateUsername(username);

        socket.send(JSON.stringify({
            type: 'connection-acknowledged',
            userId: userId,

            players: this.players,

            buzzedIn: this.buzzedIn,
            tossup: this.tossup,
            questionProgress: this.questionProgress,

            difficulties: this.query.difficulties,
            packetNumbers: this.query.packetNumbers,
            setName: this.query.setName,
            validCategories: this.query.categories,
            validSubcategories: this.query.subcategories,

            rebuzz: this.settings.rebuzz,
            public: this.settings.public,
            readingSpeed: this.settings.readingSpeed,
            selectBySetName: this.settings.selectBySetName
        }));

        if (this.questionProgress > 0 && this.tossup?.question) {
            socket.send(JSON.stringify({
                type: 'update-question',
                word: this.tossup.question.split(' ').slice(0, this.wordIndex).join(' ')
            }));
        }

        if (this.questionProgress === 2 && this.tossup?.answer) {
            socket.send(JSON.stringify({
                type: 'update-answer',
                answer: this.tossup.answer
            }));
        }

        this.sendSocketMessage({
            type: 'join',
            isNew: isNew,
            userId: userId,
            username: username,
        });
    }

    async message(message, userId) {
        let type = message.type || '';
        if (type === 'buzz') {
            this.buzz(userId);
        }

        if (type === 'change-username' || type === 'join') {
            this.sendSocketMessage({
                type: 'change-username',
                userId: userId,
                oldUsername: this.players[userId].username,
                newUsername: message.username
            });
            this.players[userId].username = message.username;
        }

        if (type === 'chat') {
            this.chat(userId, message.message);
        }

        if (type === 'clear-stats') {
            this.players[userId].clearStats();
            this.sendSocketMessage(message);
        }

        if (type === 'difficulties') {
            this.query.difficulties = message.value;
            this.sendSocketMessage(message);
        }

        if (type === 'give-answer') {
            this.giveAnswer(userId, message.givenAnswer, message.celerity);
        }

        if (type === 'leave') {
            // this.deletePlayer(userId);
            delete this.sockets[userId];
            this.sendSocketMessage(message);
        }

        if (type === 'next' || type === 'skip') {
            this.next(userId);
        }

        if (type === 'start') {
            this.start(userId);
        }

        if (type === 'packet-number') {
            this.query.packetNumbers = message.value;
            this.questionNumber = 0;
            this.sendSocketMessage(message);
        }

        if (type === 'pause') {
            this.pause(userId);
        }

        if (type === 'reading-speed') {
            this.settings.readingSpeed = message.value;
            this.sendSocketMessage(message);
        }

        if (type === 'set-name') {
            this.query.setName = message.value;
            this.questionNumber = 0;
            this.sendSocketMessage(message);
        }

        if (type === 'toggle-rebuzz') {
            this.settings.rebuzz = message.rebuzz;
            this.sendSocketMessage(message);
        }

        if (type === 'toggle-select-by-set-name') {
            this.settings.selectBySetName = message.selectBySetName;
            this.query.setName = message.setName;
            this.questionNumber = 0;
            this.sendSocketMessage(message);
        }

        if (type === 'toggle-visibility') {
            this.settings.public = message.public;
            this.sendSocketMessage(message);
        }

        if (type === 'update-categories') {
            this.query.categories = message.categories;
            this.query.subcategories = message.subcategories;
            this.sendSocketMessage(message);
        }
    }

    async advanceQuestion() {
        this.queryingQuestion = true;
        this.wordIndex = 0;
        this.buzzedIn = false;
        this.paused = false;

        if (this.settings.selectBySetName) {
            this.tossup = await database.getNextQuestion(
                this.query.setName,
                this.query.packetNumbers,
                this.questionNumber,
                this.query.categories,
                this.query.subcategories
            );
            if (Object.keys(this.tossup).length === 0) {
                this.sendSocketMessage({
                    type: 'end-of-set'
                });
                return false;
            } else {
                this.questionNumber = this.tossup.questionNumber;
                this.query.packetNumbers = this.query.packetNumbers.filter(packetNumber => packetNumber >= this.tossup.packetNumber);
            }
        } else {
            this.tossup = await database.getRandomQuestion(
                'tossup',
                this.query.difficulties,
                this.query.categories,
                this.query.subcategories
            );
            if (Object.keys(this.tossup).length === 0) {
                this.sendSocketMessage({
                    type: 'no-questions-found'
                });
                return false;
            }
        }

        this.questionProgress = 1;

        return true;
    }

    buzz(userId) {
        if (this.buzzedIn) {
            this.sendSocketMessage({
                type: 'lost-buzzer-race',
                userId: userId,
                username: this.players[userId].username
            });
        } else {
            this.buzzedIn = true;
            clearTimeout(this.buzzTimeout);
            this.sendSocketMessage({
                type: 'buzz',
                userId: userId,
                username: this.players[userId].username
            });

            this.sendSocketMessage({
                type: 'update-question',
                word: '(#)'
            });
        }
    }

    chat(userId, message) {
        this.sendSocketMessage({
            type: 'chat',
            userId: userId,
            username: this.players[userId].username,
            message: message
        });
    }

    createPlayer(userId) {
        this.players[userId] = new Player(userId);
    }

    deletePlayer(userId) {
        this.sendSocketMessage({
            type: 'leave',
            userId: userId,
            username: this.players[userId].username
        });

        delete this.players[userId];
    }

    giveAnswer(userId, givenAnswer, celerity) {
        if (Object.keys(this.tossup).length === 0) return;
        this.buzzedIn = false;
        let endOfQuestion = (this.wordIndex === this.tossup.question.split(' ').length);
        let inPower = this.tossup.question.includes('(*)') && !this.tossup.question.split(' ').slice(0, this.wordIndex).join(' ').includes('(*)');
        let [directive, points] = quizbowl.scoreTossup(this.tossup.answer, givenAnswer, inPower, endOfQuestion);

        if (directive === 'accept') {
            this.revealQuestion();
            this.questionProgress = 2;
            this.players[userId].updateStats(points, celerity);
            Object.values(this.players).forEach(player => { player.tuh++; });
        } else if (directive === 'reject') {
            this.updateQuestion();
            this.players[userId].updateStats(points, celerity);
        }

        this.sendSocketMessage({
            type: 'give-answer',
            userId: userId,
            username: this.players[userId].username,
            givenAnswer: givenAnswer,
            directive: directive,
            score: points,
            celerity: this.players[userId].celerity.correct.average
        });
    }

    next(userId) {
        if (this.queryingQuestion) return;
        clearTimeout(this.buzzTimeout);
        this.revealQuestion();
        this.advanceQuestion().then((successful) => {
            this.queryingQuestion = false;
            if (successful) {
                this.sendSocketMessage({
                    type: 'next',
                    userId: userId,
                    username: this.players[userId].username,
                    tossup: this.tossup
                });
                this.updateQuestion();
            }
        });
    }

    pause(userId) {
        this.paused = !this.paused;

        if (this.paused) {
            clearTimeout(this.buzzTimeout);
        } else {
            this.updateQuestion();
        }

        this.sendSocketMessage({
            type: 'pause',
            paused: this.paused,
            userId: userId,
            username: this.players[userId].username
        });
    }

    revealQuestion() {
        if (Object.keys(this.tossup).length === 0) return;
        let remainingQuestion = this.tossup.question.split(' ').slice(this.wordIndex).join(' ');
        this.sendSocketMessage({
            type: 'update-question',
            word: remainingQuestion
        });

        this.sendSocketMessage({
            type: 'update-answer',
            answer: this.tossup.answer
        });

        this.wordIndex = this.tossup.question.split(' ').length;
    }

    sendSocketMessage(message) {
        for (const socket of Object.values(this.sockets)) {
            socket.send(JSON.stringify(message));
        }
    }

    start(userId) {
        if (this.queryingQuestion) return;
        clearTimeout(this.buzzTimeout);
        this.advanceQuestion().then((successful) => {
            this.queryingQuestion = false;
            if (successful) {
                this.sendSocketMessage({
                    type: 'start',
                    userId: userId,
                    username: this.players[userId].username,
                    tossup: this.tossup
                });
                this.updateQuestion();
            }
        });
    }

    updateQuestion() {
        clearTimeout(this.buzzTimeout);
        if (Object.keys(this.tossup).length === 0) return;
        let questionSplit = this.tossup.question.split(' ');
        if (this.wordIndex >= questionSplit.length) {
            return;
        }

        let word = questionSplit[this.wordIndex];
        this.wordIndex++;

        // calculate time needed before reading next word
        let time = Math.log(word.length) + 1;
        if ((word.endsWith('.') && word.charCodeAt(word.length - 2) > 96 && word.charCodeAt(word.length - 2) < 123)
            || word.slice(-2) === '.\u201d' || word.slice(-2) === '!\u201d' || word.slice(-2) === '?\u201d')
            time += 2;
        else if (word.endsWith(',') || word.slice(-2) === ',\u201d')
            time += 0.75;
        else if (word === "(*)")
            time = 0;

        this.sendSocketMessage({
            type: 'update-question',
            word: word
        });

        this.buzzTimeout = setTimeout(() => {
            this.updateQuestion();
        }, time * 0.9 * (125 - this.settings.readingSpeed));
    }
}

module.exports = Room;