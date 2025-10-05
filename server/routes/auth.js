const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');
const { validateRegistration, validateLogin } = require('../middleware/validation');
const { register, login, getProfile, getAllUsers } = require('../controllers/authController');

// Public routes
router.post('/register', authLimiter, validateRegistration, register);
router.post('/login', authLimiter, validateLogin, login);

// Protected routes
router.get('/profile', auth, getProfile);
router.get('/users', auth, getAllUsers);

module.exports = router;
