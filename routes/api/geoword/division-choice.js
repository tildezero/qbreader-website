import { getDivisionChoice } from '../../../database/geoword.js';
import { getUserId } from '../../../database/users.js';
import { checkToken } from '../../../server/authentication.js';

import { Router } from 'express';

const router = Router();

router.get('/', async (req, res) => {
    const { username, token } = req.session;
    if (!checkToken(username, token)) {
        delete req.session;
        res.redirect('/geoword/login');
        return;
    }

    const { packetName } = req.query;
    const user_id = await getUserId(username);
    const division = await getDivisionChoice(packetName, user_id);

    res.json({ division });
});

export default router;
