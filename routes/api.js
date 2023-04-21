const express = require('express');
const router = express.Router();

const database = require('../server/database');
const { checkAnswer } = require('../server/scorer');

const rateLimit = require('express-rate-limit');

const apiLimiter = rateLimit({
    windowMs: 1000, // 4 seconds
    max: 20, // Limit each IP to 20 requests per `window`
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Apply the rate limiting middleware to API calls only
router.use(apiLimiter);


// DO NOT DECODE THE ROOM NAMES - THEY ARE SAVED AS ENCODED


router.get('/check-answer', (req, res) => {
    const answerline = req.query.answerline;
    const givenAnswer = req.query.givenAnswer;
    const [directive, directedPrompt] = checkAnswer(answerline, givenAnswer);
    res.send(JSON.stringify([directive, directedPrompt]));
});


router.get('/num-packets', async (req, res) => {
    const numPackets = await database.getNumPackets(req.query.setName);
    if (numPackets === 0) {
        res.statusCode = 404;
    }
    res.send(numPackets.toString());
});


router.get('/packet', async (req, res) => {
    const setName = req.query.setName;
    const packetNumber = parseInt(req.query.packetNumber);
    const packet = await database.getPacket({ setName, packetNumber });
    if (packet.tossups.length === 0 && packet.bonuses.length === 0) {
        res.statusCode = 404;
    }
    res.send(JSON.stringify(packet));
});


router.get('/packet-bonuses', async (req, res) => {
    const setName = req.query.setName;
    const packetNumber = parseInt(req.query.packetNumber);
    const packet = await database.getPacket({ setName, packetNumber, questionTypes: ['bonuses'] });
    if (packet.bonuses.length === 0) {
        res.statusCode = 404;
    }
    res.send(JSON.stringify(packet));
});


router.get('/packet-tossups', async (req, res) => {
    const setName = req.query.setName;
    const packetNumber = parseInt(req.query.packetNumber);
    const packet = await database.getPacket({ setName, packetNumber, questionTypes: ['tossups'] });
    if (packet.tossups.length === 0) {
        res.statusCode = 404;
    }
    res.send(JSON.stringify(packet));
});


router.get('/query', async (req, res) => {
    req.query.randomize = (req.query.randomize === 'true');
    req.query.regex = (req.query.regex === 'true');
    req.query.ignoreDiacritics = (req.query.ignoreDiacritics === 'true');

    if (!['tossup', 'bonus', 'all'].includes(req.query.questionType)) {
        res.status(400).send('Invalid question type specified.');
        return;
    }

    if (!['all', 'question', 'answer'].includes(req.query.searchType)) {
        res.status(400).send('Invalid search type specified.');
        return;
    }

    if (req.query.difficulties) {
        req.query.difficulties = req.query.difficulties
            .split(',')
            .map((difficulty) => parseInt(difficulty));
    }

    if (req.query.categories) {
        req.query.categories = req.query.categories.split(',');
    }

    if (req.query.subcategories) {
        req.query.subcategories = req.query.subcategories.split(',');
    }

    if (!req.query.tossupPagination) {
        req.query.tossupPagination = 1;
    }

    if (!req.query.bonusPagination) {
        req.query.bonusPagination = 1;
    }

    if (!isFinite(req.query.tossupPagination) || !isFinite(req.query.bonusPagination)) {
        res.status(400).send('Invalid pagination specified.');
        return;
    }

    if (!req.query.maxReturnLength || isNaN(req.query.maxReturnLength)) {
        req.query.maxReturnLength = database.DEFAULT_QUERY_RETURN_LENGTH;
    }

    const maxPagination = Math.floor(4000 / (req.query.maxReturnLength || 25));

    req.query.tossupPagination = Math.min(parseInt(req.query.tossupPagination), maxPagination);
    req.query.bonusPagination = Math.min(parseInt(req.query.bonusPagination), maxPagination);
    req.query.tossupPagination = Math.max(req.query.tossupPagination, 1);
    req.query.bonusPagination = Math.max(req.query.bonusPagination, 1);

    const queryResult = await database.getQuery(req.query);
    res.send(JSON.stringify(queryResult));
});


router.get('/random-name', (req, res) => {
    res.send(database.getRandomName());
});


router.post('/random-question', async (req, res) => {
    if (!['tossup', 'bonus'].includes(req.body.questionType)) {
        res.status(400).send('Invalid question type specified.');
        return;
    }

    if (typeof req.body.difficulties === 'string') {
        req.body.difficulties = parseInt(req.body.difficulties);
    }

    if (typeof req.body.difficulties === 'number') {
        req.body.difficulties = [req.body.difficulties];
    }

    if (typeof req.body.categories === 'string') {
        req.body.categories = [req.body.categories];
    }

    if (typeof req.body.subcategories === 'string') {
        req.body.subcategories = [req.body.subcategories];
    }

    const questions = await database.getRandomQuestions(req.body);
    if (questions.length > 0) {
        res.send(JSON.stringify(questions));
    } else {
        res.sendStatus(404);
    }
});


router.post('/report-question', async (req, res) => {
    const _id = req.body._id;
    const reason = req.body.reason ?? '';
    const description = req.body.description ?? '';
    const successful = await database.reportQuestion(_id, reason, description);
    if (successful) {
        res.sendStatus(200);
    } else {
        res.sendStatus(500);
    }
});


router.get('/set-list', (req, res) => {
    const setList = database.getSetList(req.query.setName);
    res.send(setList);
});


module.exports = router;
