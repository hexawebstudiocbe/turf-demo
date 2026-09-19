const express = require('express');
const router = express.Router();
const turfController = require('../controllers/turfController');

router.get('/', turfController.getTurf);
router.get('/reviews', turfController.getReviews);
router.post('/reviews', turfController.createReview);

module.exports = router;
